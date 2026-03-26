from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from picamera2 import Picamera2
import io
import json
import time
import threading
from PIL import Image
import RPi.GPIO as GPIO
import socket

import board
import busio
from adafruit_bme280 import basic as adafruit_bme280

# Camera configuration
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480

# I2C and Sensor configuration
BME280_I2C_ADDRESS = 0x76
SENSOR_UPDATE_INTERVAL = 2  # seconds

# GPIO configuration
CONTROL_GPIO_PIN = 4

# Server configuration
SERVER_HOST = '0.0.0.0'
SERVER_PORT = 8000

# Streaming configuration
STREAM_FRAME_INTERVAL = 0.05  # seconds
SENSOR_FETCH_INTERVAL = 1000  # milliseconds

picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={"size": (640, 480)}))
picam2.start()

i2c = busio.I2C(board.SCL, board.SDA)
bme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)

GPIO.setmode(GPIO.BCM)
GPIO.setup(4, GPIO.OUT)
GPIO.output(4, GPIO.LOW)

sensor_data = {
    "temperature": None,
    "humidity": None,
    "pressure": None,
    "timestamp": None,
    "error": None,
}

control_state = {
    "last_command": "stop",
    "timestamp": time.time()
}


def set_command(cmd):
    if cmd == "forward":
        GPIO.output(CONTROL_GPIO_PIN, GPIO.HIGH)
    elif cmd == "stop":
        GPIO.output(CONTROL_GPIO_PIN, GPIO.LOW)
    elif cmd == "left":
        print("Left command received")
    elif cmd == "right":
        print("Right command received")
    elif cmd == "back":
        print("Back command received")

    control_state["last_command"] = cmd
    control_state["timestamp"] = time.time()


def update_sensor_loop():
    while True:
        try:
            sensor_data["temperature"] = round(bme280.temperature, 2)
            sensor_data["humidity"] = round(bme280.humidity, 2)
            sensor_data["pressure"] = round(bme280.pressure, 2)
            sensor_data["timestamp"] = time.time()
            sensor_data["error"] = None
        except Exception as e:
            sensor_data["error"] = str(e)
        time.sleep(SENSOR_UPDATE_INTERVAL)


threading.Thread(target=update_sensor_loop, daemon=True).start()


class StreamingHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/':
            html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
                <title>Pi Camera Control</title>
                <style>
                    * {{
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }}
                    
                    html, body {{
                        width: 100%;
                        height: 100%;
                        overflow: hidden;
                        background: #000;
                        font-family: Arial, sans-serif;
                    }}
                    
                    #video-container {{
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        background: #000;
                    }}
                    
                    img {{
                        max-width: 100%;
                        max-height: 100%;
                        width: auto;
                        height: auto;
                    }}
                    #sensor-panel {{
                        position: absolute;
                        top: 16px;
                        right: 16px;
                        background: rgba(0, 0, 0, 0.75);
                        backdrop-filter: blur(4px);
                        border-radius: 8px;
                        padding: 12px 16px;
                        color: white;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        z-index: 100;
                        min-width: 140px;
                        font-size: 13px;
                    }}
                    
                    .sensor-item {{
                        margin-bottom: 8px;
                    }}
                    
                    .sensor-item:last-child {{
                        margin-bottom: 0;
                    }}
                    
                    .sensor-label {{
                        font-size: 11px;
                        color: rgba(255, 255, 255, 0.7);
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }}
                    
                    .sensor-value {{
                        font-size: 16px;
                        font-weight: bold;
                        color: #4ade80;
                        margin-top: 2px;
                    }}
                    
                    .sensor-error {{
                        color: #f87171;
                    }}
                    #joystick-container {{
                        position: absolute;
                        bottom: 16px;
                        right: 16px;
                        z-index: 100;
                        user-select: none;
                    }}
                    
                    #joystick-base {{
                        width: 140px;
                        height: 140px;
                        border-radius: 50%;
                        background: rgba(59, 130, 246, 0.15);
                        border: 3px solid rgba(59, 130, 246, 0.4);
                        position: relative;
                        touch-action: none;
                    }}
                    
                    #joystick-stick {{
                        width: 70px;
                        height: 70px;
                        border-radius: 50%;
                        background: rgba(59, 130, 246, 0.9);
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.2);
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        cursor: grab;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        font-size: 24px;
                        font-weight: bold;
                        color: white;
                        transition: box-shadow 0.1s ease;
                    }}
                    
                    #joystick-stick:hover {{
                        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3);
                    }}
                    
                    #joystick-stick.active {{
                        cursor: grabbing;
                    }}
                </style>
            </head>
            <body>
                <div id="video-container">
                    <img src="/stream.mjpg" alt="Camera Stream">
                </div>
                
                <div id="sensor-panel">
                    <div id="sensor-status">
                        <div class="sensor-item">
                            <div class="sensor-label">Temperature</div>
                            <div class="sensor-value">--</div>
                        </div>
                        <div class="sensor-item">
                            <div class="sensor-label">Humidity</div>
                            <div class="sensor-value">--</div>
                        </div>
                        <div class="sensor-item">
                            <div class="sensor-label">Pressure</div>
                            <div class="sensor-value">--</div>
                        </div>
                    </div>
                </div>
                
                <div id="joystick-container">
                    <div id="joystick-base">
                        <div id="joystick-stick"></div>
                    </div>
                </div>

                <script>
                    // Joystick state
                    const joystickState = {{
                        isDragging: false,
                        lastCommand: 'stop',
                        x: 0,
                        y: 0,
                        animationFrameId: null
                    }};

                    const stick = document.getElementById('joystick-stick');
                    const base = document.getElementById('joystick-base');
                    const baseRect = base.getBoundingClientRect();
                    const maxDistance = 35; // Max drag distance (70px diameter / 2)
                    const deadZone = 8; // Dead zone radius

                    function getAngleAndDistance(x, y) {{
                        const centerX = baseRect.width / 2;
                        const centerY = baseRect.height / 2;
                        const dx = x - centerX;
                        const dy = y - centerY;
                        const distance = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx);
                        return {{ dx, dy, distance, angle }};
                    }}

                    function determineCommand(dx, dy, distance) {{
                        if (distance < deadZone) return 'stop';
                        
                        const angle = Math.atan2(dy, dx);
                        const normalizedAngle = (angle + Math.PI) / (2 * Math.PI) * 360;
                        
                        // Determine primary direction based on angle
                        if (normalizedAngle < 45 || normalizedAngle >= 315) return 'right';
                        if (normalizedAngle >= 45 && normalizedAngle < 135) return 'forward';
                        if (normalizedAngle >= 135 && normalizedAngle < 225) return 'left';
                        if (normalizedAngle >= 225 && normalizedAngle < 315) return 'back';
                        
                        return 'stop';
                    }}

                    function updateStickPosition(x, y) {{
                        const {{ distance }} = getAngleAndDistance(x, y);
                        const constrainedDistance = Math.min(distance, maxDistance);
                        const {{ angle }} = getAngleAndDistance(x, y);
                        const offsetX = Math.cos(angle) * constrainedDistance;
                        const offsetY = Math.sin(angle) * constrainedDistance;
                        
                        joystickState.x = offsetX;
                        joystickState.y = offsetY;
                        
                        stick.style.transform = 'translate(calc(-50% + ' + offsetX + 'px), calc(-50% + ' + offsetY + 'px))';
                        
                        const command = determineCommand(offsetX, offsetY, constrainedDistance);
                        if (command !== joystickState.lastCommand) {{
                            joystickState.lastCommand = command;
                            sendCmd(command);
                        }}
                    }}

                    function springBack() {{
                        const springStrength = 0.15;
                        const friction = 0.92;
                        
                        function animate() {{
                            joystickState.x *= friction;
                            joystickState.y *= friction;
                            
                            stick.style.transform = 'translate(calc(-50% + ' + joystickState.x + 'px), calc(-50% + ' + joystickState.y + 'px))';
                            
                            if (Math.abs(joystickState.x) > 0.5 || Math.abs(joystickState.y) > 0.5) {{
                                joystickState.animationFrameId = requestAnimationFrame(animate);
                            }} else {{
                                joystickState.x = 0;
                                joystickState.y = 0;
                                stick.style.transform = 'translate(-50%, -50%)';
                                joystickState.lastCommand = 'stop';
                                sendCmd('stop');
                            }}
                        }}
                        
                        if (joystickState.animationFrameId) {{
                            cancelAnimationFrame(joystickState.animationFrameId);
                        }}
                        animate();
                    }}

                    // Touch events
                    base.addEventListener('touchstart', (e) => {{
                        joystickState.isDragging = true;
                        stick.classList.add('active');
                        const touch = e.touches[0];
                        const x = touch.clientX - baseRect.left;
                        const y = touch.clientY - baseRect.top;
                        updateStickPosition(x, y);
                        e.preventDefault();
                    }});

                    document.addEventListener('touchmove', (e) => {{
                        if (!joystickState.isDragging) return;
                        const touch = e.touches[0];
                        const x = touch.clientX - baseRect.left;
                        const y = touch.clientY - baseRect.top;
                        updateStickPosition(x, y);
                        e.preventDefault();
                    }});

                    document.addEventListener('touchend', () => {{
                        if (!joystickState.isDragging) return;
                        joystickState.isDragging = false;
                        stick.classList.remove('active');
                        springBack();
                    }});

                    // Mouse events
                    stick.addEventListener('mousedown', () => {{
                        joystickState.isDragging = true;
                        stick.classList.add('active');
                    }});

                    document.addEventListener('mousemove', (e) => {{
                        if (!joystickState.isDragging) return;
                        const x = e.clientX - baseRect.left;
                        const y = e.clientY - baseRect.top;
                        updateStickPosition(x, y);
                    }});

                    document.addEventListener('mouseup', () => {{
                        if (!joystickState.isDragging) return;
                        joystickState.isDragging = false;
                        stick.classList.remove('active');
                        springBack();
                    }});

                    async function updateSensor() {{
                        try {{
                            const response = await fetch('/sensor.json');
                            const data = await response.json();
                            const panel = document.getElementById('sensor-status');

                            if (data.error) {{
                                panel.innerHTML = '<div class="sensor-item"><div class="sensor-label">Error</div><div class="sensor-value sensor-error">Sensor Error</div></div>';
                                return;
                            }}

                            panel.innerHTML = `
                                <div class="sensor-item">
                                    <div class="sensor-label">Temperature</div>
                                    <div class="sensor-value">${{data.temperature ?? '--'}} °C</div>
                                </div>
                                <div class="sensor-item">
                                    <div class="sensor-label">Humidity</div>
                                    <div class="sensor-value">${{data.humidity ?? '--'}} %</div>
                                </div>
                                <div class="sensor-item">
                                    <div class="sensor-label">Pressure</div>
                                    <div class="sensor-value">${{data.pressure ?? '--'}} hPa</div>
                                </div>
                            `;
                        }} catch (err) {{
                            document.getElementById('sensor-status').innerHTML =
                                '<div class="sensor-item"><div class="sensor-label">Error</div><div class="sensor-value sensor-error">Load Failed</div></div>';
                        }}
                    }}

                    async function sendCmd(cmd) {{
                        try {{
                            await fetch('/control?cmd=' + encodeURIComponent(cmd));
                        }} catch (err) {{
                            console.error('Command failed:', err);
                        }}
                    }}

                    document.addEventListener('keydown', function(event) {{
                        const key = event.key.toLowerCase();
                        if (key === 'w') sendCmd('forward');
                        else if (key === 's') sendCmd('back');
                        else if (key === 'a') sendCmd('left');
                        else if (key === 'd') sendCmd('right');
                        else if (key === ' ') {{
                            event.preventDefault();
                            sendCmd('stop');
                        }}
                    }});

                    updateSensor();
                    setInterval(updateSensor, {SENSOR_FETCH_INTERVAL});
                </script>
            </body>
            </html>
            """
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(html.encode('utf-8'))

        elif parsed.path == '/sensor.json':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(json.dumps(sensor_data).encode('utf-8'))

        elif parsed.path == '/control':
            query = parse_qs(parsed.query)
            cmd = query.get('cmd', [''])[0].lower()

            allowed = {"forward", "back", "left", "right", "stop"}

            if cmd in allowed:
                set_command(cmd)
                response = {
                    "ok": True,
                    "last_command": control_state["last_command"],
                    "timestamp": control_state["timestamp"]
                }
            else:
                response = {
                    "ok": False,
                    "error": "Invalid command",
                    "last_command": control_state["last_command"]
                }

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf-8'))

        elif parsed.path == '/stream.mjpg':
            self.send_response(200)
            self.send_header('Content-type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()

            try:
                while True:
                    frame = picam2.capture_array()
                    buffer = io.BytesIO()
                    img = Image.fromarray(frame).convert("RGB")
                    img.save(buffer, format="JPEG")

                    self.wfile.write(b"--frame\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n\r\n")
                    self.wfile.write(buffer.getvalue())
                    self.wfile.write(b"\r\n")
                    time.sleep(STREAM_FRAME_INTERVAL)
            except BrokenPipeError:
                pass
            except ConnectionResetError:
                pass

        else:
            self.send_error(404)


def get_local_ip():
    try:
        # Create a socket to determine the local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        # Fallback to localhost
        return "127.0.0.1"


try:
    local_ip = get_local_ip()
    server = ThreadingHTTPServer((SERVER_HOST, SERVER_PORT), StreamingHandler)
    print(f"Server running on http://{local_ip}:{SERVER_PORT}")
    server.serve_forever()
finally:
    GPIO.cleanup()