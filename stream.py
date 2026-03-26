from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from picamera2 import Picamera2
import io
import json
import time
import threading
from PIL import Image
import RPi.GPIO as GPIO

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
                <title>Pi Camera and BME280</title>
                <style>
                    body {{
                        font-family: Arial, sans-serif;
                        background: #f4f4f4;
                        margin: 20px;
                    }}
                    .wrap {{
                        max-width: 900px;
                        margin: auto;
                    }}
                    .card {{
                        background: white;
                        padding: 16px;
                        border-radius: 10px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                        margin-bottom: 20px;
                    }}
                    img {{
                        display: block;
                        max-width: 100%;
                        border-radius: 8px;
                    }}
                    .sensor-grid {{
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 12px;
                    }}
                    .sensor-box {{
                        background: #fafafa;
                        padding: 12px;
                        border-radius: 8px;
                        border: 1px solid #ddd;
                    }}
                    .label {{
                        font-size: 14px;
                        color: #555;
                    }}
                    .value {{
                        font-size: 24px;
                        font-weight: bold;
                        margin-top: 6px;
                    }}
                    .error {{
                        color: #b00020;
                        font-weight: bold;
                    }}
                    .controls {{
                        display: grid;
                        grid-template-columns: repeat(2, 140px);
                        gap: 10px;
                        margin-top: 12px;
                    }}
                    button {{
                        padding: 12px;
                        font-size: 16px;
                        border: none;
                        border-radius: 8px;
                        background: #e8e8e8;
                        cursor: pointer;
                    }}
                    button:hover {{
                        background: #dcdcdc;
                    }}
                    #control-status {{
                        margin-top: 12px;
                        font-size: 18px;
                        font-weight: bold;
                    }}
                    .help {{
                        margin-top: 10px;
                        color: #555;
                    }}
                </style>
            </head>
            <body>
                <div class="wrap">
                    <div class="card">
                        <h2>Camera Stream</h2>
                        <img src="/stream.mjpg" width="{CAMERA_WIDTH}" height="{CAMERA_HEIGHT}">
                    </div>

                    <div class="card">
                        <h2>BME280 Data</h2>
                        <div id="sensor-status">Loading...</div>
                    </div>

                    <div class="card">
                        <h2>Controls</h2>
                        <div class="controls">
                            <button onclick="sendCmd('forward')">Forward</button>
                            <button onclick="sendCmd('back')">Back</button>
                            <button onclick="sendCmd('left')">Left</button>
                            <button onclick="sendCmd('right')">Right</button>
                            <button onclick="sendCmd('stop')">Stop</button>
                        </div>
                        <div id="control-status">Last command: stop</div>
                        <div class="help">Keyboard: W = forward, S = back, A = left, D = right, Space = stop</div>
                    </div>
                </div>

                <script>
                    async function updateSensor() {{
                        try {{
                            const response = await fetch('/sensor.json');
                            const data = await response.json();

                            const status = document.getElementById('sensor-status');

                            if (data.error) {{
                                status.innerHTML = '<div class="error">Sensor error: ' + data.error + '</div>';
                                return;
                            }}

                            status.innerHTML = `
                                <div class="sensor-grid">
                                    <div class="sensor-box">
                                        <div class="label">Temperature</div>
                                        <div class="value">${{data.temperature}} °C</div>
                                    </div>
                                    <div class="sensor-box">
                                        <div class="label">Humidity</div>
                                        <div class="value">${{data.humidity}} %</div>
                                    </div>
                                    <div class="sensor-box">
                                        <div class="label">Pressure</div>
                                        <div class="value">${{data.pressure}} hPa</div>
                                    </div>
                                </div>
                            `;
                        }} catch (err) {{
                            document.getElementById('sensor-status').innerHTML =
                                '<div class="error">Failed to load sensor data</div>';
                        }}
                    }}

                    async function sendCmd(cmd) {{
                        try {{
                            const response = await fetch('/control?cmd=' + encodeURIComponent(cmd));
                            const data = await response.json();
                            document.getElementById('control-status').textContent =
                                'Last command: ' + data.last_command;
                        }} catch (err) {{
                            document.getElementById('control-status').textContent =
                                'Failed to send command';
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


try:
    server = ThreadingHTTPServer((SERVER_HOST, SERVER_PORT), StreamingHandler)
    print(f"Server running on http://{SERVER_HOST}:{SERVER_PORT}")
    server.serve_forever()
finally:
    GPIO.cleanup()