import time
from server.config import hardware, i2c_lock, ADC_ADDRESS, MQ2_ADC_CHANNEL, MQ2_BASELINE_SAMPLES

def read_ads7830(channel):
    if "adc_bus" not in hardware:
        return None
    channel = max(0, min(7, int(channel)))
    command = 0x84 | ((((channel << 2) | (channel >> 1)) & 0x07) << 4)
    try:
        with i2c_lock:
            return hardware["adc_bus"].read_byte_data(ADC_ADDRESS, command)
    except Exception as e:
        print(f"[ADC] Read error: {e}")
        return None

def read_mq2_raw():
    return read_ads7830(MQ2_ADC_CHANNEL)

def calibrate_mq2_baseline(samples=MQ2_BASELINE_SAMPLES, delay=0.02):
    if "adc_bus" not in hardware:
        print("[MQ2] Baseline skipped: ADC not found")
        return None
    print("[MQ-2] Calibrating baseline (keep in clean air)...")
    total = 0
    valid = 0
    for _ in range(samples):
        try:
            value = read_mq2_raw()
            if value is not None:
                total += value
                valid += 1
            time.sleep(delay)
        except Exception as e:
            print(f"[MQ2] Baseline read error: {e}")
    if valid == 0:
        print("[MQ2] Baseline failed")
        return None
    baseline = total / valid
    print(f"[MQ-2] Baseline calibrated: {baseline:.1f}")
    return baseline
