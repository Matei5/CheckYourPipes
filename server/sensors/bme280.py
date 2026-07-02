import time
from server.config import hardware, hardware_info, i2c_lock

def init_bme280():
    shared_i2c = hardware.get("shared_i2c")
    if shared_i2c is None:
        return None
    try:
        import adafruit_bme280.advanced
        with i2c_lock:
            bme = adafruit_bme280.advanced.Adafruit_BME280_I2C(shared_i2c, address=0x76)
            _ = bme.temperature
        print("[BME280] Initialized successfully at 0x76")
        hardware["bme280"] = bme
        hardware_info["bme280_address"] = 0x76
    except Exception as e:
        print(f"[BME280] Initialization failed: {e}")
