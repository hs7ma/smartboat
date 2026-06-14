/*
 * ============================================================
 *   Tigris eye Camera Module - ESP32-CAM (AI-Thinker)
 *   Dedicated Camera Node for Tigris eye
 * ============================================================
 *
 * Board: ESP32-CAM (AI-Thinker module)
 * Role:  Capture and stream images via WebSocket
 * 
 * Components:
 *   - ESP32-CAM with OV2640
 *   - WiFi connection to same network as controller
 * 
 * Pins (AI-Thinker ESP32-CAM):
 *   GPIO15: VSPI CS (can use for other things if needed)
 *   GPIO14: HS2_CLK / PSRAM CLK
 *   GPIO2:  LED (onboard, optional)
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <esp_camera.h>
#include <base64.h>

// ==================== CONFIGURATION ====================

#define WIFI_SSID       "MSR3"
#define WIFI_PASSWORD   "60006000"
#define SERVER_HOST     "smartboat-production.up.railway.app"
#define SERVER_PORT     443
#define WS_PATH         "/ws"

// ==================== CAMERA PINS (AI-Thinker ESP32-CAM) ====================

#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ==================== CONSTANTS ====================

#define CAMERA_INTERVAL_MS    10000
#define WS_RECONNECT_MS       5000
#define WIFI_RETRY_MS         500

// ==================== GLOBAL OBJECTS ====================

WebSocketsClient webSocket;

// ==================== STATE VARIABLES ====================

unsigned long lastCameraCapture = 0;
bool cameraReady               = false;
bool wsConnected               = false;
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

// ==================== CAMERA ====================

bool initCamera() {
    printSection("CAMERA INIT");
    
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    config.pin_d0       = Y2_GPIO_NUM;
    config.pin_d1       = Y3_GPIO_NUM;
    config.pin_d2       = Y4_GPIO_NUM;
    config.pin_d3       = Y5_GPIO_NUM;
    config.pin_d4       = Y6_GPIO_NUM;
    config.pin_d5       = Y7_GPIO_NUM;
    config.pin_d6       = Y8_GPIO_NUM;
    config.pin_d7       = Y9_GPIO_NUM;
    config.pin_xclk     = XCLK_GPIO_NUM;
    config.pin_pclk     = PCLK_GPIO_NUM;
    config.pin_vsync    = VSYNC_GPIO_NUM;
    config.pin_href     = HREF_GPIO_NUM;
    config.pin_sccb_sda = SIOD_GPIO_NUM;
    config.pin_sccb_scl = SIOC_GPIO_NUM;
    config.pin_pwdn     = PWDN_GPIO_NUM;
    config.pin_reset    = RESET_GPIO_NUM;
    config.xclk_freq_hz = 20000000;
    config.pixel_format = PIXFORMAT_JPEG;
    config.frame_size   = FRAMESIZE_QVGA;
    config.jpeg_quality = 12;
    config.fb_count     = 1;
    config.grab_mode    = CAMERA_GRAB_LATEST;
    
    if (psramFound()) {
        config.fb_count = 2;
        config.jpeg_quality = 10;
        config.frame_size = FRAMESIZE_VGA;
        Serial.println("  PSRAM found: 2 frame buffers, quality 10, VGA");
    } else {
        config.fb_count = 1;
        config.jpeg_quality = 12;
        config.frame_size = FRAMESIZE_QVGA;
        Serial.println("  No PSRAM: 1 frame buffer, quality 12, QVGA");
    }
    
    Serial.println("  Initializing camera driver...");
    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        Serial.printf("  [FAIL] Camera init error: 0x%x\n", err);
        Serial.println("  Possible causes:");
        Serial.println("    1. Camera module not connected");
        Serial.println("    2. Pin configuration mismatch");
        Serial.println("    3. PSRAM not enabled (Tools > PSRAM > Enabled)");
        Serial.println("    4. Wrong board selected (use AI-Thinker ESP32-CAM)");
        return false;
    }
    Serial.println("  [OK] Camera driver initialized");

    sensor_t *s = esp_camera_sensor_get();
    if (s) {
        s->set_brightness(s, 0);
        s->set_contrast(s, 0);
        s->set_saturation(s, 0);
        s->set_whitebal(s, 1);
        s->set_awb_gain(s, 1);
        s->set_exposure_ctrl(s, 1);
        s->set_aec2(s, 1);
        s->set_gain_ctrl(s, 1);
        Serial.println("  [OK] Camera sensor settings applied");
    }
    
    Serial.println("  [OK] Camera ready!");
    return true;
}

String captureImageBase64() {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        Serial.println("  [FAIL] Camera capture returned NULL");
        return "";
    }
    
    String base64Image = base64::encode(fb->buf, fb->len);
    esp_camera_fb_return(fb);
    base64Image.replace("\n", "");
    
    return base64Image;
}

// ==================== WEBSOCKET ====================

void sendCameraImage(String base64Image) {
    if (!wsConnected || base64Image.length() == 0) return;

    String json = "{\"type\":\"camera_image\",\"image\":\"" + base64Image + "\",\"timestamp\":" + String(millis()) + "}";

    Serial.printf("[CAM] Sending image: %d bytes base64, %d bytes total JSON\n", base64Image.length(), json.length());

    bool sent = webSocket.sendTXT(json);
    if (sent) {
        Serial.println("[CAM] Image sent successfully");
    } else {
        Serial.println("[CAM] Failed to send image");
    }
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
            webSocket.sendTXT("{\"type\":\"device_info\",\"device\":\"camera_module\",\"firmware\":\"1.0.0\"}");
            Serial.println("[WS] Camera module registration sent");
            break;
            
        case WStype_TEXT: {
            // Camera module does not handle commands from server
            // but we can add debug logging here if needed
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
    Serial.println("║      Tigris eye Camera Module v1.0        ║");
    Serial.println("║         ESP32-CAM (AI-Thinker)           ║");
    Serial.println("║         Dedicated Camera Node            ║");
    Serial.println("╚══════════════════════════════════════════╝");
    Serial.println();
    
    Serial.printf("[SYS] Free heap: %d bytes\n", ESP.getFreeHeap());
    Serial.printf("[SYS] Free PSRAM: %d bytes\n", ESP.getFreePsram());
    Serial.printf("[SYS] Chip: ESP32 rev %d\n", ESP.getChipRevision());
    Serial.printf("[SYS] CPU freq: %d MHz\n", getCpuFrequencyMhz());

    // ===== PSRAM =====
    printSection("PSRAM INIT");
    if (psramInit()) {
        Serial.printf("  [OK] PSRAM: %d bytes free\n", ESP.getFreePsram());
    } else {
        Serial.println("  [FAIL] PSRAM not available!");
        Serial.println("  Fix: Tools > PSRAM > Enabled (Quad/OPI)");
    }

    // ===== CAMERA =====
    bool camOk = initCamera();
    cameraReady = camOk;
    printStatus("Camera module", camOk);

    // ===== WiFi =====
    bool wifiOk = connectWiFi();
    printStatus("WiFi connection", wifiOk);

    // ===== WebSocket =====
    bool wsOk = setupWebSocket();
    printStatus("WebSocket client", wsOk);

    // ===== Summary =====
    printSection("SYSTEM STATUS");
    Serial.printf("  Camera:       %s\n", cameraReady ? "OK" : "FAILED");
    Serial.printf("  WiFi:         %s\n", wifiOk ? "OK" : "FAILED");
    Serial.printf("  WebSocket:    Connecting...\n");
    Serial.printf("  Free heap:    %d bytes\n", ESP.getFreeHeap());
    Serial.printf("  Free PSRAM:   %d bytes\n", ESP.getFreePsram());
    Serial.printf("  Boot time:    %lu ms\n", millis() - bootTime);
    Serial.println();
    Serial.println("  Camera:   every 10 seconds");
    Serial.println();
    Serial.println("========== Starting main loop ==========");
    Serial.println();
}

// ==================== MAIN LOOP ====================

void loop() {
    webSocket.loop();
    
    unsigned long now = millis();
    
    // --- Capture & send image every 10 seconds ---
    if (cameraReady && wsConnected && (now - lastCameraCapture >= CAMERA_INTERVAL_MS)) {
        lastCameraCapture = now;
        
        Serial.println("[CAM] Capturing image...");
        String image = captureImageBase64();
        if (image.length() > 0) {
            Serial.printf("[CAM] Sending image (%d bytes base64)\n", image.length());
            sendCameraImage(image);
        } else {
            Serial.println("[CAM] Capture failed - empty result");
        }
    }
    
    // --- Reconnect WiFi if disconnected ---
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WIFI] *** CONNECTION LOST ***");
        connectWiFi();
    }
}
