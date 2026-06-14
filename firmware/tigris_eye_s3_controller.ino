/*
 * ============================================================
 *   Tigris eye Controller Module - ESP32-S3
 *   Main Controller: Sensors, Servo, Obstacle Avoidance
 * ============================================================
 *
 * Components:
 *   - ESP32-S3 (main controller)
 *   - TDS Sensor (Analog) on GPIO1
 *   - Turbidity Sensor V1.0 (Analog) on GPIO2
 *   - VL53L0X TOF Laser Distance Sensor (I2C on GPIO4/GPIO5)
 *   - Servo Motor (Rudder) on GPIO14
 * 
 * IMPORTANT: This module does NOT use camera. Camera is handled
 *            by a separate ESP32-CAM node.
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <VL53L0X.h>
#include <Wire.h>
#include <ESP32Servo.h>

// ==================== CONFIGURATION ====================

#define WIFI_SSID       "MSR3"
#define WIFI_PASSWORD   "60006000"
#define SERVER_HOST     "smartboat-production.up.railway.app"
#define SERVER_PORT     443
#define WS_PATH         "/ws"

// ==================== PIN DEFINITIONS ====================

#define TDS_PIN             1       // Analog input for TDS
#define TURBIDITY_PIN       2       // Analog input for Turbidity
#define SERVO_PIN           14      // Servo PWM
#define I2C_SDA             4       // I2C SDA
#define I2C_SCL             5       // I2C SCL

// ==================== CONSTANTS ====================

#define TDS_SAMPLE_COUNT       30
#define TURBIDITY_SAMPLE_COUNT 30
#define TOF_SAMPLE_COUNT       10

#define OBSTACLE_DANGER_CM     30
#define OBSTACLE_WARNING_CM    60
#define OBSTACLE_SAFE_CM      150

#define SERVO_CENTER           90
#define SERVO_LEFT_MAX         30
#define SERVO_RIGHT_MAX        150
#define SERVO_AVOID_HARD       45
#define SERVO_AVOID_SOFT       65

#define SENSOR_INTERVAL_MS     1000
#define WS_RECONNECT_MS        5000
#define WIFI_RETRY_MS          500

// ==================== GLOBAL OBJECTS ====================

WebSocketsClient webSocket;
VL53L0X tofSensor;
Servo rudderServo;

// ==================== STATE VARIABLES ====================

unsigned long lastSensorRead   = 0;
bool tofReady                  = false;
bool wsConnected               = false;
bool avoidDirectionLeft        = true;
float currentTDS               = 0;
float currentTurbidity         = 0;
float currentDistance           = 0;
int currentRudderAngle         = SERVO_CENTER;
int wsReconnectAttempts        = 0;
unsigned long bootTime         = 0;

// ==================== HELPER: Print separator ====================

void printSection(const char* title) {
    Serial.println();
    Serial.println("╔══════════════════════════════════════════╗");
    Serial.printf("  %s\n", title);
    Serial.println("╚══════════════════════════════════════════╝");
}

void printStatus(const char* label, bool success) {
    if (success) {
        Serial.printf("  [OK] %s\n", label);
    } else {
        Serial.printf("  [FAIL] %s\n", label);
    }
}

void printDetailF(const char* label, float value) {
    Serial.printf("       %s: %.2f\n", label, value);
}

// ==================== TDS SENSOR ====================

float readTDS() {
    int samples[TDS_SAMPLE_COUNT];
    for (int i = 0; i < TDS_SAMPLE_COUNT; i++) {
        samples[i] = analogRead(TDS_PIN);
        delay(2);
    }
    
    for (int i = 0; i < TDS_SAMPLE_COUNT - 1; i++) {
        for (int j = i + 1; j < TDS_SAMPLE_COUNT; j++) {
            if (samples[i] > samples[j]) {
                int temp = samples[i];
                samples[i] = samples[j];
                samples[j] = temp;
            }
        }
    }
    
    float avgVoltage = 0;
    for (int i = 2; i < TDS_SAMPLE_COUNT - 2; i++) {
        avgVoltage += samples[i];
    }
    avgVoltage /= (TDS_SAMPLE_COUNT - 4);
    
    float voltage = avgVoltage * 3.3 / 4095.0;
    float temperature = 25.0;
    float compensationCoefficient = 1.0 + 0.02 * (temperature - 25.0);
    float compensationVoltage = voltage / compensationCoefficient;
    float tdsValue = (133.42 * compensationVoltage * compensationVoltage * compensationVoltage
                    - 255.86 * compensationVoltage * compensationVoltage
                    + 857.39 * compensationVoltage) * 0.5;
    
    if (tdsValue < 0) tdsValue = 0;
    
    return tdsValue;
}

// ==================== TURBIDITY SENSOR ====================

float readTurbidity() {
    int samples[TURBIDITY_SAMPLE_COUNT];
    for (int i = 0; i < TURBIDITY_SAMPLE_COUNT; i++) {
        samples[i] = analogRead(TURBIDITY_PIN);
        delay(2);
    }
    
    for (int i = 0; i < TURBIDITY_SAMPLE_COUNT - 1; i++) {
        for (int j = i + 1; j < TURBIDITY_SAMPLE_COUNT; j++) {
            if (samples[i] > samples[j]) {
                int temp = samples[i];
                samples[i] = samples[j];
                samples[j] = temp;
            }
        }
    }
    
    float avgValue = 0;
    for (int i = 2; i < TURBIDITY_SAMPLE_COUNT - 2; i++) {
        avgValue += samples[i];
    }
    avgValue /= (TURBIDITY_SAMPLE_COUNT - 4);
    
    float voltage = avgValue * 3.3 / 4095.0;
    float ntu = -1120.4 * voltage * voltage + 5742.3 * voltage - 4352.9;
    
    if (ntu < 0) ntu = 0;
    if (ntu > 3000) ntu = 3000;
    
    return ntu;
}

// ==================== TOF VL53L0X ====================

float readTOF() {
    if (!tofReady) {
        return 999;
    }
    
    float sum = 0;
    int validCount = 0;
    
    for (int i = 0; i < TOF_SAMPLE_COUNT; i++) {
        uint16_t dist = tofSensor.readRangeSingleMillimeters();
        if (dist < 8000 && dist > 10) {
            sum += dist;
            validCount++;
        }
        delay(5);
    }
    
    if (validCount == 0) return 999;
    return (sum / validCount) / 10.0;
}

// ==================== SERVO RUDDER CONTROL ====================

void setRudderAngle(int angle) {
    angle = constrain(angle, SERVO_LEFT_MAX, SERVO_RIGHT_MAX);
    currentRudderAngle = angle;
    rudderServo.write(angle);
}

void handleObstacleAvoidance(float distance) {
    if (distance < OBSTACLE_DANGER_CM) {
        if (avoidDirectionLeft) {
            setRudderAngle(SERVO_AVOID_HARD);
        } else {
            setRudderAngle(180 - SERVO_AVOID_HARD);
        }
    } else if (distance < OBSTACLE_WARNING_CM) {
        if (avoidDirectionLeft) {
            setRudderAngle(SERVO_AVOID_SOFT);
        } else {
            setRudderAngle(180 - SERVO_AVOID_SOFT);
        }
    } else if (distance < OBSTACLE_SAFE_CM) {
        int offset = map((int)distance, OBSTACLE_WARNING_CM, OBSTACLE_SAFE_CM, 25, 0);
        int angle = SERVO_CENTER;
        if (avoidDirectionLeft) {
            angle = SERVO_CENTER - offset;
        } else {
            angle = SERVO_CENTER + offset;
        }
        setRudderAngle(angle);
    } else {
        setRudderAngle(SERVO_CENTER);
        avoidDirectionLeft = !avoidDirectionLeft;
    }
}

// ==================== WEBSOCKET ====================

void sendSensorData() {
    if (!wsConnected) return;
    
    String json = "{\"type\":\"sensor_data\",";
    json += "\"tds\":" + String(currentTDS, 1) + ",";
    json += "\"turbidity\":" + String(currentTurbidity, 1) + ",";
    json += "\"tof_distance\":" + String(currentDistance, 1) + ",";
    json += "\"rudder_angle\":" + String(currentRudderAngle) + "}";
    
    webSocket.sendTXT(json);
}

void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[WS] *** DISCONNECTED ***");
            wsConnected = false;
            wsReconnectAttempts++;
            Serial.printf("[WS] Reconnect attempts: %d\n", wsReconnectAttempts);
            break;
            
        case WStype_CONNECTED:
            Serial.println("[WS] *** CONNECTED ***");
            Serial.printf("[WS] Server: wss://%s:%d%s\n", SERVER_HOST, SERVER_PORT, WS_PATH);
            wsConnected = true;
            wsReconnectAttempts = 0;
            webSocket.sendTXT("{\"type\":\"device_info\",\"device\":\"controller_module\",\"firmware\":\"1.0.0\"}");
            Serial.println("[WS] Controller module registration sent");
            break;
            
        case WStype_TEXT: {
            String message = String((char *)payload);
            if (message.indexOf("\"rudder_command\"") >= 0) {
                int angleStart = message.indexOf("\"angle\":");
                if (angleStart >= 0) {
                    String angleStr = message.substring(angleStart + 8);
                    angleStr.trim();
                    if (angleStr.startsWith(",")) angleStr = angleStr.substring(1);
                    int commaPos = angleStr.indexOf(',');
                    if (commaPos > 0) angleStr = angleStr.substring(0, commaPos);
                    if (angleStr.endsWith("}")) angleStr = angleStr.substring(0, angleStr.length() - 1);
                    int angle = angleStr.toInt();
                    setRudderAngle(angle);
                    Serial.printf("[WS] Rudder command: angle=%d\n", angle);
                }
            }
            break;
        }
        
        case WStype_ERROR:
            Serial.println("[WS] *** ERROR ***");
            break;
            
        default:
            break;
    }
}

// ==================== WiFi ====================

bool connectWiFi() {
    printSection("WIFI CONNECTION");
    Serial.printf("  SSID: %s\n", WIFI_SSID);
    Serial.printf("  Server: %s:%d\n", SERVER_HOST, SERVER_PORT);
    Serial.print("  Status: Connecting");
    
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(WIFI_RETRY_MS);
        Serial.print(".");
        attempts++;
    }
    Serial.println();
    
    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("  [OK] WiFi connected!");
        Serial.printf("  IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("  RSSI: %d dBm\n", WiFi.RSSI());
        Serial.printf("  MAC: %s\n", WiFi.macAddress().c_str());
        return true;
    } else {
        Serial.println("  [FAIL] WiFi connection failed!");
        Serial.println("  Check: SSID, Password, Router range");
        return false;
    }
}

bool setupWebSocket() {
    printSection("WEBSOCKET SETUP");
    Serial.printf("  Server: wss://%s:%d%s\n", SERVER_HOST, SERVER_PORT, WS_PATH);
    Serial.print("  Status: Connecting...");
    
    webSocket.beginSSL(SERVER_HOST, SERVER_PORT, WS_PATH);
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(WS_RECONNECT_MS);
    webSocket.enableHeartbeat(15000, 10000, 3);
    
    Serial.println(" initiated");
    Serial.println("  Waiting for connection...");
    return true;
}

// ==================== SETUP ====================

void setup() {
    Serial.begin(115200);
    delay(1000);
    bootTime = millis();
    
    Serial.println();
    Serial.println("╔══════════════════════════════════════════╗");
    Serial.println("║      Tigris eye Controller v1.0           ║");
    Serial.println("║    River Water Quality Monitoring        ║");
    Serial.println("║    ESP32-S3 Controller (No Camera)       ║");
    Serial.println("╚══════════════════════════════════════════╝");
    Serial.println();
    
    Serial.printf("[SYS] Free heap: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("[SYS] Chip: ESP32-S3 rev %d\n", ESP.getChipRevision());
    Serial.printf("[SYS] CPU freq: %d MHz\n", getCpuFrequencyMhz());

    // ===== SERVO =====
    printSection("SERVO INIT");
    Serial.printf("  Pin: GPIO%d\n", SERVO_PIN);
    rudderServo.attach(SERVO_PIN, 500, 2500);
    setRudderAngle(SERVO_CENTER);
    Serial.printf("  [OK] Servo centered at %d degrees\n", SERVO_CENTER);

    // ===== I2C + VL53L0X =====
    printSection("I2C + TOF SENSOR");
    Serial.printf("  I2C SDA: GPIO%d\n", I2C_SDA);
    Serial.printf("  I2C SCL: GPIO%d\n", I2C_SCL);
    Serial.println("  Initializing I2C bus...");
    Wire.begin(I2C_SDA, I2C_SCL);
    delay(100);
    Serial.println("  [OK] I2C bus initialized");
    
    Serial.println("  Scanning for VL53L0X (addr 0x29)...");
    tofReady = tofSensor.init();
    if (tofReady) {
        tofSensor.setTimeout(500);
        tofSensor.setMeasurementTimingBudget(20000);
        Serial.println("  [OK] VL53L0X TOF sensor initialized");
        Serial.printf("  Test read: %.1f cm\n", readTOF());
    } else {
        Serial.println("  [FAIL] VL53L0X not found!");
        Serial.println("  Check: wiring, I2C address, power");
        Serial.println("  Continuing without distance sensor...");
    }
    
    // ===== WiFi =====
    bool wifiOk = connectWiFi();
    printStatus("WiFi connection", wifiOk);

    // ===== WebSocket =====
    bool wsOk = setupWebSocket();
    printStatus("WebSocket client", wsOk);

    // ===== Summary =====
    printSection("SYSTEM STATUS");
    Serial.printf("  TOF Sensor:   %s\n", tofReady ? "OK" : "FAILED");
    Serial.printf("  Servo:        OK (GPIO%d)\n", SERVO_PIN);
    Serial.printf("  WiFi:         %s\n", wifiOk ? "OK" : "FAILED");
    Serial.printf("  WebSocket:    Connecting...\n");
    Serial.printf("  Free heap:    %d bytes\n", ESP.getFreeHeap());
    Serial.printf("  Boot time:    %lu ms\n", millis() - bootTime);
    Serial.println();
    Serial.println("  Sensing:  every 1 second");
    Serial.println("  Rudder:   auto obstacle avoidance");
    Serial.println();
    Serial.println("========== Starting main loop ==========");
    Serial.println();
}

// ==================== MAIN LOOP ====================

void loop() {
    webSocket.loop();
    
    unsigned long now = millis();
    
    // --- Read sensors every 1 second ---
    if (now - lastSensorRead >= SENSOR_INTERVAL_MS) {
        lastSensorRead = now;
        
        currentTDS = readTDS();
        currentTurbidity = readTurbidity();
        currentDistance = readTOF();
        
        Serial.printf("[SENS] TDS=%.1f ppm | Turb=%.1f NTU | Dist=%.1f cm | Rudder=%d°\n",
                      currentTDS, currentTurbidity, currentDistance, currentRudderAngle);
        
        handleObstacleAvoidance(currentDistance);
        sendSensorData();
    }
    
    // --- Reconnect WiFi if disconnected ---
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WIFI] *** CONNECTION LOST ***");
        connectWiFi();
    }
}
