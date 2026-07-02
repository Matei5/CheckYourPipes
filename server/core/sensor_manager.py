import time
from server.config import hardware, hardware_info, i2c_lock, state_lock, state, pose
import server.config as config
from server.sensors.mpu6050 import get_calibrated_mpu_values
from server.sensors.gas import read_mq2_raw

def get_cpu_temp():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            return round(float(f.read()) / 1000.0, 1)
    except Exception:
        return None

def sensor_loop():
    bme_fail_count = 0

    while True:
        try:
            data = {}
            cpu_temp = get_cpu_temp()
            if cpu_temp is not None:
                data["cpu_temp"] = cpu_temp

            if "ultrasonic" in hardware:
                try:
                    data["ultrasonic_cm"] = round(hardware["ultrasonic"].distance * 100, 1)
                except Exception as e:
                    print(f"[ULTRASONIC] Read error: {e}")

            if "bme280" in hardware:
                try:
                    bme = hardware["bme280"]
                    # lock the i2c bus because the bme and imu can collide during reads.
                    with i2c_lock:
                        temp = bme.temperature
                        humidity = bme.humidity
                        pressure = bme.pressure
                    data["temp"] = round(temp, 1)
                    data["humidity"] = round(humidity, 1)
                    data["pressure"] = round(pressure, 1)
                    data["bme_address"] = f"0x{hardware_info.get('bme280_address', 0):02X}"
                    bme_fail_count = 0
                except Exception as e:
                    bme_fail_count += 1
                    print(f"[BME280] Read error: {e} (failures: {bme_fail_count}/3)")
                    if bme_fail_count >= 3:
                        # try rebooting the sensor if it dropped off the i2c bus.
                        print("[BME280] Attempting to re-initialize BME280 sensor...")
                        from server.sensors.bme280 import init_bme280
                        init_bme280()
                        bme_fail_count = 0

            if "adc_bus" in hardware:
                try:
                    gas_raw = read_mq2_raw()
                    if gas_raw is not None:
                        data["gas"] = gas_raw
                        data["gas_raw"] = gas_raw
                        # map raw 8-bit adc values to a percentage for the ui.
                        data["gas_percent"] = round((gas_raw / 255.0) * 100.0, 1)
                        if config.mq2_baseline is not None:
                            gas_delta = gas_raw - config.mq2_baseline
                            data["gas_delta"] = round(gas_delta, 1)
                            data["gas_event"] = gas_delta >= config.MQ2_GAS_EVENT_DELTA
                        else:
                            data["gas_delta"] = None
                            data["gas_event"] = False
                except Exception as e:
                    print(f"[MQ2] Read error: {e}")

            mpu_values = get_calibrated_mpu_values()
            if mpu_values is not None:
                try:
                    data["accel"] = [round(x, 2) for x in mpu_values["accel"]]
                    data["gyro"] = [round(x, 4) for x in mpu_values["gyro"]]
                    data["accel_raw"] = [round(x, 2) for x in mpu_values["accel_raw"]]
                    data["gyro_raw"] = [round(x, 4) for x in mpu_values["gyro_raw"]]
                    data["mpu_calibrated"] = mpu_values["calibrated"]
                except Exception as e:
                    print(f"[IMU] Data format error: {e}")

            with state_lock:
                data["x"] = round(pose["x"], 3)
                data["y"] = round(pose["y"], 3)
                data["vx"] = round(pose["vx"], 3)
                data["vy"] = round(pose["vy"], 3)
                data["heading"] = round(pose["heading"], 3)
                state["sensor_data"] = data

        except Exception as e:
            print(f"[SENSOR] Error: {e}")

        time.sleep(1)
