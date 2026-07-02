from server.config import hardware, i2c_lock, EXPECTED_I2C_DEVICES

def init_i2c():
    try:
        try:
            import smbus
        except ImportError:
            import smbus2 as smbus

        smbus_bus = smbus.SMBus(1)
        hardware["i2c_scan_bus"] = smbus_bus
        hardware["adc_bus"] = smbus_bus
        print("[I2C] SMBus 1 opened for scanning and ADC")
    except Exception as e:
        print(f"[I2C] Failed to open SMBus 1: {e}")

    try:
        import board
        import busio
        from board import SCL, SDA

        shared_i2c = busio.I2C(SCL, SDA)
        hardware["shared_i2c"] = shared_i2c
        print("[I2C] Shared CircuitPython I2C bus initialized")
    except Exception as e:
        hardware["shared_i2c"] = None
        print(f"[I2C] Failed to initialize CircuitPython I2C bus: {e}")

def scan_i2c_bus():
    found = []
    if "i2c_scan_bus" not in hardware:
        return found

    bus = hardware["i2c_scan_bus"]

    with i2c_lock:
        for addr in range(0x03, 0x78):
            try:
                bus.write_quick(addr)
                found.append(addr)
            except Exception:
                pass

    return found

def print_i2c_scan(found_addresses):
    found_set = set(found_addresses)
    addrs = (
        ", ".join(f"0x{a:02X}" for a in found_addresses) if found_addresses else "None"
    )
    print(f"\n[I2C SCAN] Found: {addrs}")
    for addr, name in EXPECTED_I2C_DEVICES.items():
        status = "OK" if addr in found_set else "MISSING"
        print(f"  0x{addr:02X} {name:28s} [{status}]")
