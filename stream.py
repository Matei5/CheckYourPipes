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
CAMERA_WIDTH = 1296 
CAMERA_HEIGHT = 972

# I2C and Sensor configuration
HUMIDITY_SENSOR_ENABLED = False  # Humidity sensor disabled - hardware removed
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
picam2.configure(picam2.create_video_configuration(main={"size": (1920, 1080)}))
picam2.start()

# Initialize I2C and BME280 only if enabled
bme280 = None
if HUMIDITY_SENSOR_ENABLED:
    try:
        i2c = busio.I2C(board.SCL, board.SDA)
        bme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c, address=0x76)
        print("BME280 sensor initialized successfully")
    except Exception as e:
        print(f"Warning: Could not initialize BME280 sensor: {e}")
        bme280 = None

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
            if bme280 is not None:
                sensor_data["temperature"] = round(bme280.temperature, 2)
                if HUMIDITY_SENSOR_ENABLED:
                    sensor_data["humidity"] = round(bme280.humidity, 2)
                else:
                    sensor_data["humidity"] = None  # Humidity sensor disabled
                sensor_data["pressure"] = round(bme280.pressure, 2)
            else:
                # Sensor not available
                sensor_data["temperature"] = None
                sensor_data["humidity"] = None
                sensor_data["pressure"] = None
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
            try:
                with open('index.html', 'r', encoding='utf-8') as f:
                    html = f.read()
                self.send_response(200)
                self.send_header('Content-type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(html.encode('utf-8'))
            except FileNotFoundError:
                self.send_error(404, "index.html not found")

        elif parsed.path == '/app.js':
            try:
                with open('app.js', 'r', encoding='utf-8') as f:
                    js = f.read()
                self.send_response(200)
                self.send_header('Content-type', 'application/javascript; charset=utf-8')
                self.end_headers()
                self.wfile.write(js.encode('utf-8'))
            except FileNotFoundError:
                self.send_error(404, "app.js not found")

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