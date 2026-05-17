from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from picamera2 import Picamera2
import io
import json
import time
import threading
from PIL import Image
import socket

import board
import busio
from board import SCL, SDA
from adafruit_pca9685 import PCA9685
from adafruit_motor import motor
import adafruit_bme280.advanced
import adafruit_mpu6050

MOTOR_M1_IN1, MOTOR_M1_IN2 = 15, 14
MOTOR_M2_IN1, MOTOR_M2_IN2 = 12, 13
MOTOR_M3_IN1, MOTOR_M3_IN2 = 11, 10
MOTOR_M4_IN1, MOTOR_M4_IN2 = 8, 9

ULTRASONIC_TRIG = 23
ULTRASONIC_ECHO = 24

STANDARD_SPEED = 5000

CAMERA_WIDTH = 1296 
CAMERA_HEIGHT = 972

HUMIDITY_SENSOR_ENABLED = False
BME280_I2C_ADDRESS = 0x76
SENSOR_UPDATE_INTERVAL_S = 2

SERVER_HOST = '0.0.0.0'
SERVER_PORT = 8000

STREAM_FRAME_INTERVAL_S = 0.05
SENSOR_FETCH_INTERVAL_MS = 1000

MPU6050_ADDR = 0x68
BME280_ADDR = 0x77
MQ2_ADC_ADDR = 0x48
PCA9685_ADDR = 0x5f

PWM_FREQUENCY = 50
MOTOR_THROTTLE_FORWARD = 0.2
MOTOR_THROTTLE_BACKWARD = -0.2
MOTOR_THROTTLE_STOP = 0.0

SENSOR_DECIMAL_PLACES = 2

HTTP_OK = 200
HTTP_NOT_FOUND = 404
HTTP_SERVICE_UNAVAILABLE = 503

ENCODING_UTF8 = 'utf-8'

FILE_INDEX = 'index.html'
FILE_APP_JS = 'app.js'
PATH_ROOT = '/'
PATH_APP_JS = '/app.js'
PATH_SENSOR = '/sensor.json'
PATH_CONTROL = '/control'
PATH_STREAM = '/stream.mjpg'

QUERY_PARAM_CMD = 'cmd'

CMD_FORWARD = 'forward'
CMD_BACKWARD = 'back'
CMD_LEFT = 'left'
CMD_RIGHT = 'right'
CMD_STOP = 'stop'

DNS_IP = '8.8.8.8'
DNS_PORT = 80
LOCAL_IP_FALLBACK = '127.0.0.1'
MJPEG_BOUNDARY = 'frame'

picam2 = None
try:
    picam2 = Picamera2()
    picam2.configure(picam2.create_video_configuration(main={"size": (CAMERA_WIDTH, CAMERA_HEIGHT)}))
    picam2.start()
    print("Camera initialized successfully")
except Exception as e:
    print(f"Warning: Could not initialize camera: {e}")
    picam2 = None

motors = []
try:
    i2c = busio.I2C(SCL, SDA)
    pwm_motor = PCA9685(i2c, address=PCA9685_ADDR)
    pwm_motor.frequency = PWM_FREQUENCY
    
    for in1, in2 in [(MOTOR_M1_IN1, MOTOR_M1_IN2),
                     (MOTOR_M2_IN1, MOTOR_M2_IN2),
                     (MOTOR_M3_IN1, MOTOR_M3_IN2),
                     (MOTOR_M4_IN1, MOTOR_M4_IN2)]:
        motors.append(motor.DCMotor(pwm_motor.channels[in1], pwm_motor.channels[in2]))
    print("Motors initialized successfully")
except Exception as e:
    print(f"Error: Could not initialize motors: {e}")
    motors = []

motor_direction = CMD_STOP
motor_speed = 0

sensor_data = {
    "temperature": None,
    "humidity": None,
    "pressure": None,
    "acceleration": None,
    "gyroscope": None,
    "timestamp": None,
    "error": None,
    "motor_direction": motor_direction,
    "motor_speed": motor_speed,
}

def set_command(cmd, throttle=None, turn=None):
    global motor_direction, motor_speed
    
    if not motors:
        print("Warning: Motors not initialized")
        return
    
    if throttle is None:
        throttle = STANDARD_SPEED / 100.0
    else:
        throttle = max(0.0, min(1.0, throttle))
    
    if cmd == CMD_STOP or throttle == 0:
        for m in motors:
            m.throttle = MOTOR_THROTTLE_STOP
        motor_direction = CMD_STOP
        motor_speed = 0
    elif cmd == CMD_FORWARD:
        if turn is not None and len(motors) >= 4:
            turn = max(-1.0, min(1.0, turn))
            adjusted_turn = turn * (1.0 - throttle)
            left_throttle = throttle + adjusted_turn
            right_throttle = throttle - adjusted_turn
            motors[0].throttle = left_throttle
            motors[1].throttle = right_throttle
            motors[2].throttle = left_throttle
            motors[3].throttle = right_throttle
            motor_speed = int(throttle * 100)
        else:
            for m in motors:
                m.throttle = throttle
            motor_speed = int(throttle * 100)
        motor_direction = CMD_FORWARD
    elif cmd == CMD_BACKWARD:
        if turn is not None and len(motors) >= 4:
            turn = max(-1.0, min(1.0, turn))
            adjusted_turn = turn * (1.0 - throttle)
            left_throttle = -throttle + adjusted_turn
            right_throttle = -throttle - adjusted_turn
            motors[0].throttle = left_throttle
            motors[1].throttle = right_throttle
            motors[2].throttle = left_throttle
            motors[3].throttle = right_throttle
            motor_speed = int(throttle * 100)
        else:
            for m in motors:
                m.throttle = -throttle
            motor_speed = int(throttle * 100)
        motor_direction = CMD_BACKWARD
    elif cmd == CMD_LEFT:
        if len(motors) >= 4:
            motors[0].throttle = -throttle
            motors[1].throttle = throttle
            motors[2].throttle = -throttle
            motors[3].throttle = throttle
        motor_direction = CMD_LEFT
        motor_speed = int(throttle * 100)
    elif cmd == CMD_RIGHT:
        if len(motors) >= 4:
            motors[0].throttle = throttle
            motors[1].throttle = -throttle
            motors[2].throttle = throttle
            motors[3].throttle = -throttle
        motor_direction = CMD_RIGHT
        motor_speed = int(throttle * 100)
    
    sensor_data["motor_direction"] = motor_direction
    sensor_data["motor_speed"] = motor_speed


def update_sensor_loop():
    global sensor_data
    
    bme280_sensor = None
    try:
        bme280_sensor = adafruit_bme280.advanced.Adafruit_BME280_I2C(i2c, address=BME280_ADDR)
    except Exception as e:
        print(f"Warning: Could not initialize BME280 sensor: {e}")
    
    mpu6050_sensor = None
    try:
        mpu6050_sensor = adafruit_mpu6050.MPU6050(i2c, address=MPU6050_ADDR)
    except Exception as e:
        print(f"Warning: Could not initialize MPU6050 sensor: {e}")
    
    while True:
        try:
            if bme280_sensor is not None:
                sensor_data["temperature"] = round(bme280_sensor.temperature, SENSOR_DECIMAL_PLACES)
                if HUMIDITY_SENSOR_ENABLED:
                    sensor_data["humidity"] = round(bme280_sensor.humidity, SENSOR_DECIMAL_PLACES)
                else:
                    sensor_data["humidity"] = None
                sensor_data["pressure"] = round(bme280_sensor.pressure, SENSOR_DECIMAL_PLACES)
            
            if mpu6050_sensor is not None:
                accel = mpu6050_sensor.acceleration
                gyro = mpu6050_sensor.gyro
                sensor_data["acceleration"] = {
                    "x": round(accel[0], SENSOR_DECIMAL_PLACES),
                    "y": round(accel[1], SENSOR_DECIMAL_PLACES),
                    "z": round(accel[2], SENSOR_DECIMAL_PLACES)
                }
                sensor_data["gyroscope"] = {
                    "x": round(gyro[0], SENSOR_DECIMAL_PLACES),
                    "y": round(gyro[1], SENSOR_DECIMAL_PLACES),
                    "z": round(gyro[2], SENSOR_DECIMAL_PLACES)
                }
            
            sensor_data["motor_direction"] = motor_direction
            sensor_data["motor_speed"] = motor_speed
            sensor_data["timestamp"] = time.time()
            sensor_data["error"] = None
        except Exception as e:
            sensor_data["error"] = str(e)
        time.sleep(SENSOR_UPDATE_INTERVAL_S)


threading.Thread(target=update_sensor_loop, daemon=True).start()


class StreamingHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == PATH_ROOT:
            try:
                with open(FILE_INDEX, 'r', encoding=ENCODING_UTF8) as f:
                    html = f.read()
                self.send_response(HTTP_OK)
                self.send_header('Content-type', 'text/html; charset=' + ENCODING_UTF8)
                self.end_headers()
                self.wfile.write(html.encode(ENCODING_UTF8))
            except FileNotFoundError:
                self.send_error(HTTP_NOT_FOUND, FILE_INDEX + " not found")

        elif parsed.path == PATH_APP_JS:
            try:
                with open(FILE_APP_JS, 'r', encoding=ENCODING_UTF8) as f:
                    js = f.read()
                self.send_response(HTTP_OK)
                self.send_header('Content-type', 'application/javascript; charset=' + ENCODING_UTF8)
                self.end_headers()
                self.wfile.write(js.encode(ENCODING_UTF8))
            except FileNotFoundError:
                self.send_error(HTTP_NOT_FOUND, FILE_APP_JS + " not found")

        elif parsed.path == PATH_SENSOR:
            self.send_response(HTTP_OK)
            self.send_header('Content-type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(json.dumps(sensor_data).encode(ENCODING_UTF8))

        elif parsed.path == PATH_CONTROL:
            query = parse_qs(parsed.query)
            cmd = query.get(QUERY_PARAM_CMD, [''])[0].lower()
            
            throttle = None
            turn = None
            try:
                throttle_str = query.get('throttle', [''])[0]
                if throttle_str:
                    throttle = float(throttle_str)
            except (ValueError, IndexError):
                pass
            try:
                turn_str = query.get('turn', [''])[0]
                if turn_str:
                    turn = float(turn_str)
            except (ValueError, IndexError):
                pass

            allowed = {CMD_FORWARD, CMD_BACKWARD, CMD_LEFT, CMD_RIGHT, CMD_STOP}

            if cmd in allowed:
                set_command(cmd, throttle, turn)
                response = {
                    "ok": True,
                    "command": cmd,
                    "direction": motor_direction,
                    "speed": motor_speed,
                    "timestamp": time.time()
                }
            else:
                response = {
                    "ok": False,
                    "error": "Invalid command",
                    "direction": motor_direction
                }

            self.send_response(HTTP_OK)
            self.send_header('Content-type', 'application/json')
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode(ENCODING_UTF8))

        elif parsed.path == PATH_STREAM:
            if picam2 is None:
                self.send_error(HTTP_SERVICE_UNAVAILABLE, "Camera not available")
                return
                
            self.send_response(HTTP_OK)
            self.send_header('Content-type', 'multipart/x-mixed-replace; boundary=' + MJPEG_BOUNDARY)
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()

            try:
                while True:
                    frame = picam2.capture_array()
                    buffer = io.BytesIO()
                    img = Image.fromarray(frame).convert("RGB")
                    img.save(buffer, format="JPEG")

                    self.wfile.write(b"--" + MJPEG_BOUNDARY.encode() + b"\r\n")
                    self.wfile.write(b"Content-Type: image/jpeg\r\n\r\n")
                    self.wfile.write(buffer.getvalue())
                    self.wfile.write(b"\r\n")
                    time.sleep(STREAM_FRAME_INTERVAL_S)
            except BrokenPipeError:
                pass
            except ConnectionResetError:
                pass

        else:
            self.send_error(HTTP_NOT_FOUND)


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect((DNS_IP, DNS_PORT))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError as e:
        print(f"Warning: Could not determine local IP: {e}")
        return LOCAL_IP_FALLBACK


try:
    local_ip = get_local_ip()
    server = ThreadingHTTPServer((SERVER_HOST, SERVER_PORT), StreamingHandler)
    print(f"Server running on http://{local_ip}:{SERVER_PORT}")
    server.serve_forever()
finally:
    for m in motors:
        m.throttle = MOTOR_THROTTLE_STOP