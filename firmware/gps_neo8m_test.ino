/*
 * NEO-8M GPS Standalone Test - ESP32-S3
 *
 * Wiring:
 *   GPS TX  -> ESP32 GPIO17 (RX)
 *   GPS RX  -> ESP32 GPIO18 (TX)  [optional]
 *   GPS VCC -> 3.3V or 5V
 *   GPS GND -> GND
 *
 * Library: TinyGPSPlus (Sketch -> Include Library -> Manage Libraries)
 * Serial Monitor: 115200
 */

#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

#define GPS_RX_PIN  17
#define GPS_TX_PIN  18
#define GPS_BAUD    9600

HardwareSerial GPS_Serial(1);
TinyGPSPlus gps;

unsigned long lastPrint = 0;
String nmeaLine;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("========================================");
  Serial.println("  NEO-8M GPS Test (raw + parse)");
  Serial.println("========================================");
  Serial.printf("  RX GPIO%d <- GPS TX | baud %d\n", GPS_RX_PIN, GPS_BAUD);
  Serial.println("  Tip: outdoors + antenna attached");
  Serial.println("========================================");
  Serial.println();

  GPS_Serial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
}

void loop() {
  while (GPS_Serial.available() > 0) {
    char c = GPS_Serial.read();
    gps.encode(c);

    if (c == '\n') {
      nmeaLine.trim();
      if (nmeaLine.length() > 0) {
        Serial.print("[NMEA] ");
        Serial.println(nmeaLine);
      }
      nmeaLine = "";
    } else if (c != '\r') {
      if (nmeaLine.length() < 120) {
        nmeaLine += c;
      }
    }
  }

  unsigned long now = millis();
  if (now - lastPrint < 2000) return;
  lastPrint = now;

  Serial.println("---------- GPS STATUS ----------");
  Serial.printf("Chars: %lu | Passed: %lu | Failed: %lu\n",
                gps.charsProcessed(),
                gps.passedChecksum(),
                gps.failedChecksum());

  if (gps.charsProcessed() < 10) {
    Serial.println("No UART data. Check GPS TX -> GPIO17 and power.");
    Serial.println();
    return;
  }

  if (gps.passedChecksum() == 0) {
    Serial.println("Data arrives but NMEA not parsed.");
    Serial.println("Try GPS_BAUD 38400, or check wiring/noise.");
    Serial.println();
    return;
  }

  if (gps.location.isValid()) {
    Serial.println("FIX: YES");
    Serial.printf("  Lat: %.6f  Lng: %.6f\n", gps.location.lat(), gps.location.lng());
    if (gps.altitude.isValid()) Serial.printf("  Alt: %.1f m\n", gps.altitude.meters());
    if (gps.speed.isValid()) Serial.printf("  Speed: %.1f km/h\n", gps.speed.kmph());
    if (gps.satellites.isValid()) Serial.printf("  Sats: %d\n", gps.satellites.value());
    if (gps.hdop.isValid()) Serial.printf("  HDOP: %.1f\n", gps.hdop.hdop());
  } else {
    Serial.println("FIX: NO (waiting for satellites)");
    if (gps.satellites.isValid()) {
      Serial.printf("  Sats: %d\n", gps.satellites.value());
    } else {
      Serial.println("  Sats: 0 / unknown");
    }
    Serial.println("  1) Antenna plugged in");
    Serial.println("  2) Outdoors, clear sky");
    Serial.println("  3) Wait 1-5 min (cold start)");
    Serial.println("  4) Try 5V VCC on the GPS board");
  }
  Serial.println();
}

