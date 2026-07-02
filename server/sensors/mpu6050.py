import time
import server.config as config
from server.config import hardware, i2c_lock, state_lock, mpu_calibration

def init_imu_sensor():
    shared_i2c = hardware.get("shared_i2c")
    if shared_i2c is None:
        return None
    try:
        import adafruit_mpu6050
        with i2c_lock:
            try:
                result = bytearray(1)
                shared_i2c.writeto_then_readfrom(0x68, bytes([0x75]), result)
                if result[0] in [0x71, 0x73, 0x70]:
                    adafruit_mpu6050._MPU6050_DEVICE_ID = result[0]
            except Exception:
                pass
            imu = adafruit_mpu6050.MPU6050(shared_i2c, address=0x68)
            try:
                shared_i2c.writeto(0x68, bytes([0x6A, 0x00]))
                time.sleep(0.01)
                shared_i2c.writeto(0x68, bytes([0x37, 0x02]))
                time.sleep(0.01)
                shared_i2c.writeto(0x0C, bytes([0x0A, 0x16]))
                time.sleep(0.01)
            except Exception:
                pass
        print("[IMU/MAG] Initialized successfully at 0x68")
        hardware["imu"] = imu
        return imu
    except Exception as e:
        print(f"[IMU/MAG] Initialization failed: {e}")
        return None

def calibrate_imu(samples=300, delay=0.01):
    if "imu" not in hardware:
        print("[IMU] Calibration skipped: sensor not found")
        return

    print("[IMU] Calibrating... Keep the robot still.")
    gyro_sum = [0.0, 0.0, 0.0]
    accel_sum = [0.0, 0.0, 0.0]
    valid_samples = 0

    for _ in range(samples):
        try:
            with i2c_lock:
                accel = hardware["imu"].acceleration
                gyro = hardware["imu"].gyro

            for i in range(3):
                accel_sum[i] += accel[i]
                gyro_sum[i] += gyro[i]

            valid_samples += 1
            time.sleep(delay)
        except Exception as e:
            print(f"[IMU] Calibration read error: {e}")

    if valid_samples == 0:
        print("[IMU] Calibration failed")
        return

    gyro_bias = [value / valid_samples for value in gyro_sum]
    accel_avg = [value / valid_samples for value in accel_sum]
    accel_bias = [accel_avg[0], accel_avg[1], accel_avg[2]]

    with state_lock:
        mpu_calibration["gyro_bias"] = gyro_bias
        mpu_calibration["accel_bias"] = accel_bias
        mpu_calibration["calibrated"] = True

    print(f"[IMU] Calibration done: Gyro Bias={gyro_bias[0]:.4f}/{gyro_bias[1]:.4f}/{gyro_bias[2]:.4f}, Accel Bias={accel_bias[0]:.4f}/{accel_bias[1]:.4f}/{accel_bias[2]:.4f}")

def get_calibrated_mpu_values():
    if "imu" not in hardware:
        return None

    try:
        with i2c_lock:
            mpu = hardware["imu"]
            accel_raw = list(mpu.acceleration)
            gyro_raw = list(mpu.gyro)
        config.imu_fail_count = 0
    except Exception as e:
        config.imu_fail_count += 1
        print(f"[IMU] Read error: {e} (failures: {config.imu_fail_count}/3)")
        if config.imu_fail_count >= 3:
            print("[IMU] Attempting to re-initialize IMU sensor on I2C bus...")
            new_imu = init_imu_sensor()
            if new_imu is not None:
                hardware["imu"] = new_imu
                config.imu_fail_count = 0
        return None

    with state_lock:
        gyro_bias = list(mpu_calibration["gyro_bias"])
        accel_bias = list(mpu_calibration["accel_bias"])
        calibrated = mpu_calibration["calibrated"]

    if calibrated:
        accel = [accel_raw[i] - accel_bias[i] for i in range(3)]
        gyro = [gyro_raw[i] - gyro_bias[i] for i in range(3)]
    else:
        accel = accel_raw
        gyro = gyro_raw

    return {
        "accel": accel,
        "gyro": gyro,
        "accel_raw": accel_raw,
        "gyro_raw": gyro_raw,
        "calibrated": calibrated,
    }
