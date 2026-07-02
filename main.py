#!/usr/bin/env python3

import time
import threading
import socket
import signal
import sys
import os
import subprocess

from server.config import hardware, i2c_lock
from server.hardware.i2c import init_i2c, scan_i2c_bus, print_i2c_scan
from server.hardware.camera import init_camera
from server.hardware.motors import init_motors, stop_all_motors
from server.sensors.bme280 import init_bme280
from server.sensors.mpu6050 import init_imu_sensor, calibrate_imu
from server.sensors.ultrasonic import init_ultrasonic
from server.sensors.encoders import init_encoders
from server.sensors.gas import calibrate_mq2_baseline
from server.core.sensor_manager import sensor_loop
from server.core.kinematics import pose_loop
from server.server import QuietHTTPServer, Handler
import server.config as config


def is_pipe_robo_connected():
    try:
        # check linux networking tools for piperobo hotspot mode.
        ssid = (
            subprocess.check_output(["iwgetid", "-r"], stderr=subprocess.DEVNULL)
            .decode("utf-8")
            .strip()
        )
        if ssid == "pipeRobo":
            return True
    except Exception:
        pass
    try:
        nmcli_out = subprocess.check_output(
            ["nmcli", "-t", "-f", "ACTIVE,SSID", "dev", "wifi"],
            stderr=subprocess.DEVNULL,
        ).decode("utf-8")
        for line in nmcli_out.split("\n"):
            if line.startswith("yes:pipeRobo"):
                return True
    except Exception:
        pass
    try:
        ip_out = subprocess.check_output(
            ["ip", "addr"], stderr=subprocess.DEVNULL
        ).decode("utf-8")
        if "10.42.0.1" in ip_out:
            return True
    except Exception:
        pass
    return False


def get_network_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def print_device_grid():
    found_i2c = scan_i2c_bus()
    print("\n" + "=" * 60)
    print("DEVICE STATUS")
    print("=" * 60)

    devices = [
        ("camera", "CSI", "camera" in hardware),
        ("motors", "0x5F", "motors" in hardware),
        ("servos", "CH 0,1", "servos" in hardware),
        (
            "bme280",
            f"0x{config.hardware_info.get('bme280_address', 0x76):02X}",
            "bme280" in hardware,
        ),
        ("imu", "0x68", "imu" in hardware),
        ("ultrasonic", "GPIO 23/24", "ultrasonic" in hardware),
        (
            "encoders",
            "GPIO 17/27",
            "left_encoder" in hardware and "right_encoder" in hardware,
        ),
        ("mq2/adc", "ADC 0x48", "adc_bus" in hardware),
    ]

    for name, addr, ok in devices:
        print(f"  {name:20s} {addr:12s} {'[OK]' if ok else '[MISSING]'}")

    cal = config.mpu_calibration
    print(
        f"  MPU Cal={cal['calibrated']} GB={cal['gyro_bias'][0]:.3f}/{cal['gyro_bias'][1]:.3f}/{cal['gyro_bias'][2]:.3f} AB={cal['accel_bias'][0]:.3f}/{cal['accel_bias'][1]:.3f}/{cal['accel_bias'][2]:.3f}"
    )

    missing = [a for a in config.EXPECTED_I2C_DEVICES if a not in found_i2c]
    if missing:
        print(f"  [WARN] Missing I2C: {', '.join(f'0x{a:02X}' for a in missing)}")
        print_i2c_scan(found_i2c)

    print("=" * 60 + "\n")


if __name__ == "__main__":
    is_hotspot = is_pipe_robo_connected()
    if is_hotspot:
        ip = "10.42.0.1"
        print("\n" + "=" * 60)
        print("  PIPER ROBOT - HOTSPOT MODE  [Hotspot 'pipeRobo' detected]")
        print("=" * 60 + "\n")
    else:
        ip = get_network_ip()
        print("\n" + "=" * 60)
        print("  PIPER ROBOT - WI-FI MODE")
        print("=" * 60 + "\n")

    init_i2c()
    init_camera()
    init_motors()
    init_bme280()
    init_imu_sensor()
    init_ultrasonic()
    init_encoders()

    calibrate_imu()

    if "adc_bus" in hardware:
        config.mq2_baseline = calibrate_mq2_baseline()

    print_device_grid()

    def signal_handler(sig, frame):
        print(f"\n[SYSTEM] Received signal {sig}. Shutting down safely...")
        stop_all_motors()
        if "camera" in hardware:
            try:
                hardware["camera"].stop()
                hardware["camera"].close()
            except:
                pass
        # rescue terminal state if camera streaming messed it up.
        os.system("stty sane 2>/dev/null")
        sys.exit(0)

    try:
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGHUP, signal_handler)
    except AttributeError:
        # safely skip posix signals on windows machines.
        pass

    sensor_thread = threading.Thread(target=sensor_loop, daemon=True)
    pose_thread = threading.Thread(target=pose_loop, daemon=True)

    sensor_thread.start()
    pose_thread.start()

    server = QuietHTTPServer(("0.0.0.0", 8000), Handler)
    print(f"\n[SERVER] Running at http://raspmatei.local:8000 (or http://{ip}:8000)\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[SERVER] Keyboard interrupt received. Shutting down...")
    finally:
        stop_all_motors()
        if "camera" in hardware:
            try:
                hardware["camera"].stop()
                hardware["camera"].close()
                print("[CAMERA] Shut down properly.")
            except Exception as e:
                print(f"[CAMERA] Error on shutdown: {e}")

        os.system("stty sane 2>/dev/null")
        print("[SYSTEM] Exit complete. Terminal restored.")
