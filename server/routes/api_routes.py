import json
import time
from urllib.parse import urlparse, parse_qs
from server.config import state, state_lock, pose, mpu_calibration, hardware, hardware_info, cached_i2c_devices, ADC_ADDRESS
import server.config as config
from server.hardware.motors import set_motors, stop_all_motors
from server.sensors.mpu6050 import calibrate_imu
from server.sensors.gas import calibrate_mq2_baseline
from server.core.kinematics import reset_pose_values
from server.config import i2c_lock

def handle_api_route(server, path):
    if path == "/sensor.json":
        found_i2c = config.cached_i2c_devices
        with state_lock:
            data = {
                **state["sensor_data"],
                "direction": state["direction"],
                "speed": state["speed"],
                "throttle": state["throttle"],
                "turn": state["turn"],
                "pose_mode": state.get("pose_mode", "encoders"),
                "camera_rotation": state.get("camera_rotation", 65.0),
                "camera_angle": state.get("camera_angle", 75.0),
                "zupt_enabled": state.get("zupt_enabled", False),
                "i2c_found": [f"0x{addr:02X}" for addr in found_i2c],
                "devices": {
                    "camera": "camera" in hardware,
                    "motors": "motors" in hardware,
                    "servos": "servos" in hardware,
                    "bme280": "bme280" in hardware,
                    "imu": "imu" in hardware,
                    "ultrasonic": "ultrasonic" in hardware,
                    "encoders": "left_encoder" in hardware and "right_encoder" in hardware,
                    "mq2": "adc_bus" in hardware,
                    "i2c_bus": "i2c_scan_bus" in hardware,
                    "adc_found": ADC_ADDRESS in found_i2c,
                    "pca9685_found": 0x5F in found_i2c,
                    "imu_found": 0x68 in found_i2c,
                    "bme280_found": 0x76 in found_i2c,
                    "bme280_address": f"0x{hardware_info['bme280_address']:02X}" if "bme280_address" in hardware_info else None,
                },
            }
        server.send_json(data)
        return True

    if path == "/pose.json":
        with state_lock:
            pose_mode = state.get("pose_mode", "encoders")
            data = {
                "x": round(pose["x"], 3),
                "y": round(pose["y"], 3),
                "vx": round(pose["vx"], 3),
                "vy": round(pose["vy"], 3),
                "heading": round(pose["heading"], 3),
                "pose_mode": pose_mode,
                "pose_source": "encoders" if pose_mode == "encoders" else "imu_forward_acceleration",
                "ultrasonic_cm": state["sensor_data"].get("ultrasonic_cm"),
                "gas": state["sensor_data"].get("gas"),
                "gas_raw": state["sensor_data"].get("gas_raw"),
                "gas_percent": state["sensor_data"].get("gas_percent"),
                "gas_delta": state["sensor_data"].get("gas_delta"),
                "gas_event": state["sensor_data"].get("gas_event"),
                "mpu_calibrated": mpu_calibration["calibrated"],
            }
        server.send_json(data)
        return True

    if path == "/set_pose_mode":
        query = parse_qs(urlparse(server.path).query)
        mode = query.get("mode", ["encoders"])[0].lower()
        if mode in ["encoders", "accelerometer"]:
            with state_lock:
                state["pose_mode"] = mode
                if "encoder_counts" in hardware:
                    with hardware["encoder_lock"]:
                        hardware["encoder_counts"]["left"] = 0
                        hardware["encoder_counts"]["right"] = 0
            print(f"[UI] Tracking mode changed to: {mode}")
            server.send_json({"ok": True, "message": f"Tracking mode set to {mode}"})
        else:
            server.send_json({"ok": False, "message": "Invalid tracking mode"}, status=400)
        return True

    if path == "/set_zupt":
        query = parse_qs(urlparse(server.path).query)
        is_enabled = query.get("enabled", ["false"])[0].lower() == "true"
        with state_lock:
            state["zupt_enabled"] = is_enabled
        print(f"[UI] ZUPT Auto-Calibration set to: {is_enabled}")
        server.send_json({"ok": True, "zupt_enabled": is_enabled})
        return True

    if path.startswith("/trim"):
        query = parse_qs(urlparse(server.path).query)
        try:
            trim_val = float(query.get("value", ["0.0"])[0])
        except ValueError:
            trim_val = 0.0
        with state_lock:
            state["motor_trim"] = max(-0.5, min(0.5, trim_val))
        server.send_json({"ok": True, "motor_trim": state["motor_trim"]})
        return True

    if path.startswith("/control"):
        query = parse_qs(urlparse(server.path).query)
        cmd = query.get("cmd", ["stop"])[0].lower()
        try:
            throttle = float(query.get("throttle", ["0.5"])[0])
        except ValueError:
            throttle = 0.5
        try:
            turn = float(query.get("turn", ["0.0"])[0])
        except ValueError:
            turn = 0.0
        
        throttle = max(0.0, min(1.0, throttle))
        turn = max(-1.0, min(1.0, turn))

        if cmd in ["forward", "back", "left", "right", "stop"]:
            set_motors(cmd, throttle, turn)
            with state_lock:
                state["direction"] = cmd
                state["speed"] = int(throttle * 100) if cmd != "stop" else 0
                state["throttle"] = throttle if cmd != "stop" else 0.0
                state["turn"] = turn
                if cmd != "stop":
                    state["last_command_time"] = time.time()
            server.send_json({"ok": True, "cmd": cmd, "throttle": throttle})
            return True
        server.send_json({"ok": False, "error": "Invalid command"}, status=400)
        return True

    if path.startswith("/set_camera_res"):
        query = parse_qs(urlparse(server.path).query)
        with state_lock:
            state["high_res"] = (query.get("high", ["false"])[0] == "true")
        server.send_json({"ok": True, "high_res": state.get("high_res", False)})
        return True

    if path == "/reset_pose":
        with state_lock:
            reset_pose_values()
        server.send_json({"ok": True, "message": "Pose reset"})
        return True

    if path == "/calibrate_mpu":
        stop_all_motors()
        calibrate_imu()
        with state_lock:
            reset_pose_values()
        server.send_json({"ok": True, "message": "IMU calibrated and pose reset"})
        return True

    if path == "/calibrate_mq2":
        stop_all_motors()
        baseline = calibrate_mq2_baseline()
        if baseline is not None:
            config.mq2_baseline = baseline
            server.send_json({"ok": True, "message": "MQ-2 baseline calibrated", "baseline": round(config.mq2_baseline, 1)})
        else:
            server.send_json({"ok": False, "message": "MQ-2 baseline calibration failed"}, status=500)
        return True

    if path.startswith("/camera_servo"):
        query = parse_qs(urlparse(server.path).query)
        rot_str = query.get("rotation", [None])[0]
        ang_str = query.get("angle", [None])[0]
        response = {"ok": True}

        if "servos" in hardware:
            servos = hardware["servos"]
            if rot_str is not None:
                try:
                    rot_val = max(0.0, min(120.0, float(rot_str)))
                    with i2c_lock:
                        servos[0].angle = rot_val
                    with state_lock:
                        state["camera_rotation"] = rot_val
                    response["rotation"] = rot_val
                except Exception as e:
                    response["rotation_error"] = str(e)
            if ang_str is not None:
                try:
                    ang_val = max(30.0, min(120.0, float(ang_str)))
                    with i2c_lock:
                        servos[1].angle = ang_val
                    with state_lock:
                        state["camera_angle"] = ang_val
                    response["angle"] = ang_val
                except Exception as e:
                    response["angle_error"] = str(e)
            server.send_json(response)
        else:
            server.send_json({"ok": False, "error": "Servos hardware not initialized"}, status=503)
        return True

    return False
