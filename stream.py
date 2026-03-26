from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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

picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={"size": (640, 480)}))
picam2.start()

i2c = busio.I2C(board.SCL, board.SDA)
bme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c, address = 0x76)
GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)

sensor_data = {
	"temp": None,
	"hum": None,
	"pressure": None,
	"timestamp": None,
	"error": None,
}

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
        time.sleep(2)

threading.Thread(target=update_sensor_loop, daemon=True).start()

class StreamingHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Pi Camera and BME280</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #f4f4f4;
                        margin: 20px;
                    }
                    .wrap {
                        max-width: 900px;
                        margin: auto;
                    }
                    .card {
                        background: white;
                        padding: 16px;
                        border-radius: 10px;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                        margin-bottom: 20px;
                    }
                    img {
                        display: block;
                        max-width: 100%;
                        border-radius: 8px;
                    }
                    .sensor-grid {
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 12px;
                    }
                    .sensor-box {
                        background: #fafafa;
                        padding: 12px;
                        border-radius: 8px;
                        border: 1px solid #ddd;
                    }
                    .label {
                        font-size: 14px;
                        color: #555;
                    }
                    .value {
                        font-size: 24px;
                        font-weight: bold;
                        margin-top: 6px;
                    }
                    .error {
                        color: #b00020;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
                <div class="wrap">
                    <div class="card">
                        <h2>Camera Stream</h2>
                        <img src="/stream.mjpg" width="640" height="480">
                    </div>

                    <div class="card">
                        <h2>BME280 Data</h2>
                        <div id="sensor-status">Loading...</div>
                    </div>
                </div>

                <script>
                    async function updateSensor() {
                        try {
                            const response = await fetch('/sensor.json');
                            const data = await response.json();

                            const status = document.getElementById('sensor-status');

                            if (data.error) {
                                status.innerHTML = '<div class="error">Sensor error: ' + data.error + '</div>';
                                return;
                            }

                            status.innerHTML = `
                                <div class="sensor-grid">
                                    <div class="sensor-box">
                                        <div class="label">Temperature</div>
                                        <div class="value">${data.temperature} °C</div>
                                    </div>
                                    <div class="sensor-box">
                                        <div class="label">Humidity</div>
                                        <div class="value">${data.humidity} %</div>
                                    </div>
                                    <div class="sensor-box">
                                        <div class="label">Pressure</div>
                                        <div class="value">${data.pressure} hPa</div>
                                    </div>
                                </div>
                            `;
                        } catch (err) {
                            document.getElementById('sensor-status').innerHTML =
                                '<div class="error">Failed to load sensor data</div>';
                        }
                    }

                    updateSensor();
                    setInterval(updateSensor, 1000);
                </script>
            </body>
            </html>
            """
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(html.encode('utf-8'))

        elif self.path == '/sensor.json':
            self.send_response(200)
            self.send_header('Content-type', 'aplicatation/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(json.dumps(sensor_data).encode('utf-8'))

        elif self.path == '/stream.mjpg':
            self.send_response(200)
            self.send_header('Content-type', 'multipart/x-mixed-replace; boundary=frame')
            self.send_header('Cache-Control', 'no-chache')
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
                    time.sleep(0.05)
            except BrokenPipeError:
                pass
            except ConnectionResetError:
                pass

        else:
            self.send_error(404)

server = ThreadingHTTPServer(('0.0.0.0', 8000), StreamingHandler)
print("Server running on https://0.0.0.0:8000")
server.serve_forever()
