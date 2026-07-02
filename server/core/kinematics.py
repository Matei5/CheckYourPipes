import time
import math
from server.config import (
    hardware, i2c_lock, state_lock, state, pose, mpu_calibration,
    GYRO_Z_DEADBAND, DISTANCE_PER_TICK, ACCEL_FORWARD_AXIS,
    ACCEL_FORWARD_SIGN, ACCEL_DEADBAND_MPS2, VELOCITY_DAMPING,
    MAX_MINIMAP_SPEED_MPS
)
from server.hardware.motors import set_motors

def reset_pose_values():
    pose["x"] = 0.0
    pose["y"] = 0.0
    pose["vx"] = 0.0
    pose["vy"] = 0.0
    pose["heading"] = 0.0
    pose["last_update"] = time.time()



def pose_loop():
    last_linear_dir = "forward"
    stop_time = None
    last_cmd = "stop"
    stationary_timer = 0.0
    ZUPT_STABLE_THRESHOLD = 0.015
    ZUPT_TIME_REQUIRED = 2.0

    while True:
        now = time.time()
        with state_lock:
            dt = now - pose["last_update"]
            pose["last_update"] = now
            cmd = state["direction"]
            gyro_bias_z = mpu_calibration["gyro_bias"][2]
            accel_bias = list(mpu_calibration["accel_bias"])
            calibrated = mpu_calibration["calibrated"]
            pose_mode = state.get("pose_mode", "encoders")

        if cmd == "stop" and last_cmd != "stop":
            stop_time = now
        elif cmd in ("forward", "back", "left", "right"):
            stop_time = None
        last_cmd = cmd

        if dt <= 0 or dt > 0.5:
            # prevent massive map jumps if the thread stalls.
            time.sleep(0.02)
            continue

        with state_lock:
            last_cmd_time = state.get("last_command_time", now)
        if cmd != "stop" and (now - last_cmd_time) > 1.0:
            # failsafe: halt the robot if connection drops.
            cmd = "stop"
            with state_lock:
                state["direction"] = "stop"
                state["speed"] = 0
                state["throttle"] = 0.0
            set_motors("stop")
            print("[FAILSAFE] Motor timeout. Stopping motors.")

        try:
            gyro_z = 0.0
            if "imu" in hardware:
                mpu = hardware["imu"]
                try:
                    with i2c_lock:
                        raw_gyro_z = mpu.gyro[2]

                    with state_lock:
                        zupt_enabled = state.get("zupt_enabled", False)

                    if zupt_enabled and cmd == "stop" and stop_time is not None and (now - stop_time) > ZUPT_TIME_REQUIRED:
                        # zero velocity update: auto-calibrate gyro bias when stationary.
                        if abs(raw_gyro_z - gyro_bias_z) < ZUPT_STABLE_THRESHOLD:
                            stationary_timer += dt
                            if stationary_timer > ZUPT_TIME_REQUIRED:
                                with state_lock:
                                    mpu_calibration["gyro_bias"][2] = gyro_bias_z * 0.99 + raw_gyro_z * 0.01
                                    gyro_bias_z = mpu_calibration["gyro_bias"][2]
                                    mpu_calibration["calibrated"] = True
                        else:
                            stationary_timer = 0.0
                    else:
                        stationary_timer = 0.0

                    gyro_z = raw_gyro_z - gyro_bias_z if calibrated else raw_gyro_z
                    if abs(gyro_z) < GYRO_Z_DEADBAND:
                        gyro_z = 0.0
                except Exception:
                    gyro_z = 0.0

            with state_lock:
                pose["heading"] = math.remainder(pose["heading"] + gyro_z * dt, 2 * math.pi)
                heading = pose["heading"]

            if pose_mode == "encoders" and "encoder_counts" in hardware:
                with hardware["encoder_lock"]:
                    left_ticks = hardware["encoder_counts"]["left"]
                    right_ticks = hardware["encoder_counts"]["right"]
                    # always consume ticks so they don't accumulate during pivot turns.
                    hardware["encoder_counts"]["left"] = 0
                    hardware["encoder_counts"]["right"] = 0

                if cmd == "forward":
                    sign = 1.0
                    last_linear_dir = "forward"
                elif cmd == "back":
                    sign = -1.0
                    last_linear_dir = "back"
                elif cmd in ("left", "right"):
                    sign = 0.0
                else:
                    if stop_time is not None and (now - stop_time) < 0.3:
                        # count deceleration coasting in the previous travel direction.
                        sign = 1.0 if last_linear_dir == "forward" else -1.0
                    else:
                        sign = 0.0

                dist = ((left_ticks + right_ticks) / 2.0) * DISTANCE_PER_TICK
                step_dist = sign * dist

                with state_lock:
                    pose["vx"] = (step_dist * math.cos(heading)) / dt if dt > 0 else 0.0
                    pose["vy"] = (step_dist * math.sin(heading)) / dt if dt > 0 else 0.0
                    
                    # mid_heading = heading - (gyro_z * dt) / 2.0
                    # pose["x"] += step_dist * math.cos(mid_heading)
                    # pose["y"] += step_dist * math.sin(mid_heading)
                    
                    pose["x"] += step_dist * math.cos(heading)
                    pose["y"] += step_dist * math.sin(heading)
            else:
                accel_forward = 0.0
                if "imu" in hardware:
                    with i2c_lock:
                        raw_accel = list(hardware["imu"].acceleration)
                    accel_values = [raw_accel[i] - accel_bias[i] for i in range(3)] if calibrated else raw_accel
                    accel_forward = accel_values[ACCEL_FORWARD_AXIS] * ACCEL_FORWARD_SIGN

                    if abs(accel_forward) < ACCEL_DEADBAND_MPS2:
                        accel_forward = 0.0

                with state_lock:
                    if cmd in ["forward", "back"]:
                        # filter out opposing acceleration spikes so we don't drift backwards.
                        if cmd == "forward" and accel_forward < 0: accel_forward = 0.0
                        elif cmd == "back" and accel_forward > 0: accel_forward = 0.0
                        pose["vx"] += accel_forward * math.cos(heading) * dt
                        pose["vy"] += accel_forward * math.sin(heading) * dt
                    elif cmd in ["left", "right", "stop"]:
                        pose["vx"] = 0.0
                        pose["vy"] = 0.0

                    pose["vx"] *= VELOCITY_DAMPING
                    pose["vy"] *= VELOCITY_DAMPING
                    speed = math.hypot(pose["vx"], pose["vy"])

                    if speed > MAX_MINIMAP_SPEED_MPS:
                        scale = MAX_MINIMAP_SPEED_MPS / speed
                        pose["vx"] *= scale
                        pose["vy"] *= scale

                    pose["x"] += pose["vx"] * dt
                    pose["y"] += pose["vy"] * dt

        except Exception as e:
            print(f"[POSE] Error: {e}")

        time.sleep(0.02)  # cap the loop to ~50hz to avoid burning cpu.
