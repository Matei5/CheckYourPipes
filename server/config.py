import threading
import time
import math


hardware = {}
hardware_info = {}
i2c_lock = threading.Lock()
cached_i2c_devices = []  # refreshed periodically by the sensor loop.


state_lock = threading.RLock()

state = {
    "direction": "stop",
    "speed": 0,
    "throttle": 0.0,
    "turn": 0.0,
    "sensor_data": {},
    "pose_mode": "encoders",
    "camera_rotation": 65.0,
    "camera_angle": 75.0,
    "motor_trim": 0.0,
    "zupt_enabled": False,
    "high_res": False
}

mpu_calibration = {
    "gyro_bias": [0.0, 0.0, 0.0],
    "accel_bias": [0.0, 0.0, 0.0],
    "calibrated": False,
}

imu_fail_count = 0

pose = {
    "x": 0.0,
    "y": 0.0,
    "vx": 0.0,
    "vy": 0.0,
    "heading": 0.0,
    "last_update": time.time(),
}

mq2_baseline = None


LEFT_MOTOR_INDICES = [0]
RIGHT_MOTOR_INDICES = [1]
LEFT_MOTOR_SIGN = 1
RIGHT_MOTOR_SIGN = -1

GYRO_Z_DEADBAND = 0.04
ACCEL_DEADBAND_MPS2 = 0.10
VELOCITY_DAMPING = 0.96
MAX_MINIMAP_SPEED_MPS = 0.50

WHEEL_DIAMETER_M = 0.045
ENCODER_TICKS_PER_REV = 1920
DISTANCE_PER_TICK = (math.pi * WHEEL_DIAMETER_M) / ENCODER_TICKS_PER_REV

ACCEL_FORWARD_AXIS = 0
ACCEL_FORWARD_SIGN = 1

ADC_ADDRESS = 0x48
MQ2_ADC_CHANNEL = 2

MQ2_BASELINE_SAMPLES = 100
MQ2_GAS_EVENT_DELTA = 50

EXPECTED_I2C_DEVICES = {
    0x48: "ADS7830 ADC",
    0x5F: "PCA9685 PWM / motor control",
    0x68: "IMU",
    0x76: "BME280",
}
