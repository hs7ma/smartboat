# Tigris eye - Agent Notes

## Dual-ESP32 Architecture

The project has been split from a single ESP32-S3-CAM into two dedicated nodes:

### 1. Controller Module: ESP32-S3
- **File**: `firmware/tigris_eye_s3_controller.ino`
- **Role**: Sensors, servo control, obstacle avoidance, GPS, WebSocket client
- **Sensors**: TDS (GPIO1), Turbidity (GPIO2), VL53L0X TOF (I2C on GPIO4/5), NEO-M8N/NEO-8M GPS (UART1 on GPIO17 RX / GPIO18 TX)
- **Actuator**: Servo rudder (GPIO14)
- **Device ID**: `controller_module`
- **Arduino library**: TinyGPSPlus (non-blocking UART poll; soft-fail if no fix)

### 2. Camera Module: ESP32-CAM (AI-Thinker)
- **File**: `firmware/camera_esp32.ino`
- **Role**: Image capture only, WebSocket client
- **Camera**: OV2640 with AI-Thinker pin definitions
- **Device ID**: `camera_module`

### GPS Wiring (Controller)
| GPS pin | ESP32-S3 |
|---------|----------|
| TX | GPIO17 (RX) |
| RX | GPIO18 (TX), optional |
| VCC | 3.3V or 5V per module |
| GND | GND |

First outdoor fix typically takes 30–90 seconds. Without a fix the controller still sends TDS/turbidity/TOF/rudder with `"gps_fix": false`.

### Server Changes
- `websocket-handler.js` now tracks `controllerClient` and `cameraClient` separately
- `device_status` messages include a `device` field (`controller` or `camera`)
- Rudder commands are forwarded only to the controller
- `sensor_data` may include optional GPS fields: `gps_fix`, `gps_lat`, `gps_lng`, `gps_alt`, `gps_satellites`, `gps_speed`

### UI Changes
- Dashboard shows two device status pills: Controller and Camera
- Both can connect/disconnect independently
- Live Map section (Leaflet + OSM) shows boat marker and trail when `gps_fix` is true

### Flashing Instructions
1. Flash `camera_esp32.ino` to the ESP32-CAM board (select AI-Thinker board in Arduino IDE)
2. Flash `tigris_eye_s3_controller.ino` to the ESP32-S3 board (install TinyGPSPlus first)
3. Both should connect to the same WiFi network and reach the server at `wss://smartboat-production.up.railway.app:443/ws`

### Notes
- The old monolithic firmware `tigris_eye_firmware.ino` has been removed
- If either module disconnects, the other continues to function independently
- The camera module sends `device_info` with `"device": "camera_module"` on connect
- The controller module sends `device_info` with `"device": "controller_module"` on connect
- GPS failure or No Fix must not block obstacle avoidance or other sensors
