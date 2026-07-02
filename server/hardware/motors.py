from server.config import hardware, i2c_lock

def init_motors():
    shared_i2c = hardware.get("shared_i2c")
    if shared_i2c is None:
        return

    try:
        from adafruit_pca9685 import PCA9685
        from adafruit_motor import motor, servo

        with i2c_lock:
            pwm = PCA9685(shared_i2c, address=0x5F)
            pwm.frequency = 50

        motors = [
            motor.DCMotor(pwm.channels[ch_a], pwm.channels[ch_b])
            for ch_a, ch_b in [(15, 14), (12, 13)]
        ]
        hardware["motors"] = motors
        print("[HARDWARE] Motors Initialized")

        servos = [servo.Servo(pwm.channels[0]), servo.Servo(pwm.channels[1])]
        hardware["servos"] = servos
        print("[HARDWARE] Servos Initialized on channels 0 and 1")

        try:
            with i2c_lock:
                servos[0].angle = 65
                servos[1].angle = 75
        except Exception as servo_err:
            print(f"[SERVOS] Initial angles failed: {servo_err}")

    except Exception as e:
        print(f"[MOTORS/SERVOS] Failed: {e}")

def set_camera_servos(pan, tilt):
    if "servos" in hardware:
        try:
            with i2c_lock:
                # Invert pan around the 65 center point because the servo is physically reversed
                inverted_pan = 130 - pan
                hardware["servos"][0].angle = inverted_pan
                hardware["servos"][1].angle = tilt
        except Exception as servo_err:
            print(f"[SERVOS] Set angles failed: {servo_err}")

def stop_all_motors():
    if "motors" not in hardware:
        return
    try:
        with i2c_lock:
            for m in hardware["motors"]:
                m.throttle = 0
    except Exception as e:
        print(f"[MOTORS] Stop failed: {e}")

def set_motors(cmd, throttle=0.5, turn=0.0):
    if "motors" not in hardware:
        return
    motors = hardware["motors"]
    throttle = max(0.0, min(1.0, throttle))
    turn = max(-1.0, min(1.0, turn))

    left = 0.0
    right = 0.0

    if cmd == "forward":
        left = throttle
        right = throttle
        if turn < 0: left -= abs(turn) * throttle
        elif turn > 0: right -= abs(turn) * throttle
    elif cmd == "back":
        left = -throttle
        right = -throttle
        if turn < 0: left += abs(turn) * throttle
        elif turn > 0: right += abs(turn) * throttle
    elif cmd == "left":
        left = -throttle
        right = throttle
    elif cmd == "right":
        left = throttle
        right = -throttle

    try:
        with i2c_lock:
            motors[0].throttle = max(-1.0, min(1.0, left))
            motors[1].throttle = max(-1.0, min(1.0, -right)) # invert right motor because it's physically mirrored.
    except Exception as e:
        print(f"[MOTORS] Move error: {e}")
