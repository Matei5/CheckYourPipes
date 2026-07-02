# Raspberry Pi Robot Control System

A web-based control interface for a Raspberry Pi robot with camera streaming, motor control, sensor monitoring, and a modular Python backend.

## Features

- **Live Camera Stream** - Real-time MJPEG video from Pi Camera with Pan/Tilt servo control.
- **High-Res Overlay** - Toggle between compressed low-res streams (for speed) and high-res streams (for detail) with the `F` key.
- **Panoramic Capture** - Automatically sweeps the camera to take a 3x3 grid of high-res photos and stitches them together for a full room view.
- **Joystick Control** - Touch, mouse, or keyboard (WASD) control for robot movement.
- **Sensor Monitoring** - Temperature, humidity, pressure (BME280), acceleration/gyro (MPU6050), and gas detection (MQ-2).
- **Motor Control** - 2-motor differential drive with variable speed and turning via PCA9685.
- **Interactive Mini-Map & Fullscreen Map** - Tracks robot odometry, paths, and obstacles. 
- **Custom Map Pins & Snapshots** - Drop pins on the map, attach real-time snapshot captures, and view historical sensor data charts for specific locations.
- **Calibration** - Live zero-point MPU calibration, gas baseline setting, and map origin resets.

## Pre-Demo Checklist

1. [ ] Battery fully charged and connected
2. [ ] Raspberry Pi powered on
3. [ ] Hotspot / Wi-Fi connected
4. [ ] Open URL `http://raspmatei.local:8000` (or the IP printed in the console)
5. [ ] Camera stream is visible
6. [ ] "Stop Motors" button or `Space` key works
7. [ ] WASD keyboard control drives the robot
8. [ ] Sensor panel shows valid data
9. [ ] Map tracks movement

## Quick Start

```bash
python3 main.py
```
Then open: `http://raspmatei.local:8000` or `http://<your-pi-ip>:8000`

## Controls

### Movement
- **Joystick**: Drag the blue circle to control movement. Distance = speed, Direction = turn radius.
- **W** - Forward
- **S** - Backward
- **A** - Strafe / Turn Left
- **D** - Strafe / Turn Right
- **Space** - Emergency Stop

### UI & Camera Shortcuts
- **H** - Toggle interface visibility (hide all UI for a clean stream)
- **F** - Hold to toggle High-Res camera stream overlay
- **Q** - Quick camera snapshot
- **P** - Capture 3x3 Panorama
- **E** - Toggle Fullscreen Minimap
- **R** - Reset map and pose to origin (0, 0)
- **C** - Calibrate MPU6050 Gyroscope
- **S/M/L** - Adjust side panel sizes

## Hardware Requirements

### Motors & Servos
- 2x DC Motors connected to a PCA9685 PWM driver (Address 0x5F)
- Motor Channels: 15/14 (Left), 12/13 (Right)
- Camera Servos: Channels 0 (Pan) and 1 (Tilt)

### Sensors
- BME280 (Temperature, humidity, pressure - Address 0x76)
- MPU6050 (Accelerometer, gyroscope - Address 0x68)
- Pi Camera Module (CSI interface)
- HC-SR04 Ultrasonic Sensor (GPIO 23/24)
- MQ-2 Gas Sensor (via ADS7830 ADC on I2C)
- Wheel Encoders (GPIO 17/27)

## Installation

### On Raspberry Pi

```bash
# Install system packages
sudo apt-get update
sudo apt-get install -y python3-pip python3-dev

# Install Python dependencies
pip3 install -r requirements.txt
# Alternatively, install them manually:
pip3 install picamera2 pillow
pip3 install adafruit-blinka adafruit-circuitpython-pca9685 adafruit-circuitpython-motor
pip3 install adafruit-circuitpython-bme280 adafruit-circuitpython-mpu6050
```

## Architecture

### Server (`main.py`)
The Python server is fully modularized:
- `main.py` - Main entry point. Initializes hardware and spawns daemon threads.
- `server/server.py` - Single-threaded `QuietHTTPServer` HTTP/API router.
- `server/hardware/` - Singletons for `camera.py`, `motors.py`, and `i2c.py`.
- `server/sensors/` - Individual sensor initialization and reading logic.
- `server/routes/` - API endpoints (`api_routes.py`) and MJPEG stream endpoints (`stream_routes.py`).
- `server/core/` - Kinematics processing and sensor polling loops.

### Client (`js/`)
Pure Vanilla JavaScript (No Frameworks):
- `ui.js` - Modal management, panorama capturing, UI resizing, and map pins.
- `controls.js` - Keyboard and Touch joystick input handling.
- `api.js` - Fetching sensor data and commanding motors.
- `minimap.js` - HTML5 Canvas rendering for odometry and paths.
- `charts.js` - Historical sensor data visualization using Chart.js.

## Troubleshooting

### Camera not showing / Resource errors
- Ensure the Pi Camera is enabled in `raspi-config` -> Interface Options -> Camera.
- Verify no other process is using the camera (`lsof /dev/video0`).
- If the stream lags heavily, verify you aren't stuck in High-Res mode, or restart the server.

### Motors not responding
- Check the I2C connection: `i2cdetect -y 1`. The PCA9685 should appear at `0x5f`.
- Verify battery power is sufficient. The Pi will drop the I2C bus if voltage sags.

### Network Issues
- The server automatically attempts to detect if it is running on the `pipeRobo` hotspot (IP `10.42.0.1`) or a standard Wi-Fi network, and prints the appropriate access IP to the console on startup.

## Development

The codebase is intentionally kept free of heavy frameworks (React, Vue, Node.js) to:
- Maximize performance on low-power Raspberry Pi hardware.
- Allow for easy, instantaneous modifications via SSH without build steps.
- Provide a clear, transparent control flow for educational robotics.
