# Tigris eye - Agent Notes

## Dual-ESP32 Architecture

The project has been split from a single ESP32-S3-CAM into two dedicated nodes:

### 1. Controller Module: ESP32-S3
- **File**: `firmware/tigris_eye_s3_controller.ino`
- **Role**: Sensors, servo control, obstacle avoidance, WebSocket client
- **Sensors**: TDS (GPIO1), Turbidity (GPIO2), VL53L0X TOF (I2C on GPIO4/5)
- **Actuator**: Servo rudder (GPIO14)
- **Device ID**: `controller_module`

### 2. Camera Module: ESP32-CAM (AI-Thinker)
- **File**: `firmware/camera_esp32.ino`
- **Role**: Image capture only, WebSocket client
- **Camera**: OV2640 with AI-Thinker pin definitions
- **Device ID**: `camera_module`

### Server Changes
- `websocket-handler.js` now tracks `controllerClient` and `cameraClient` separately
- `device_status` messages include a `device` field (`controller` or `camera`)
- Rudder commands are forwarded only to the controller

### UI Changes
- Dashboard shows two device status pills: Controller and Camera
- Both can connect/disconnect independently

### Flashing Instructions
1. Flash `camera_esp32.ino` to the ESP32-CAM board (select AI-Thinker board in Arduino IDE)
2. Flash `tigris_eye_s3_controller.ino` to the ESP32-S3 board
3. Both should connect to the same WiFi network and reach the server at `wss://smartboat-production.up.railway.app:443/ws`

### Notes
- The old monolithic firmware `tigris_eye_firmware.ino` has been removed
- If either module disconnects, the other continues to function independently
- The camera module sends `device_info` with `"device": "camera_module"` on connect
- The controller module sends `device_info` with `"device": "controller_module"` on connect
