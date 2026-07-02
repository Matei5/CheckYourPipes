import time
import threading
from server.config import hardware

def init_encoders():
    try:
        from gpiozero import DigitalInputDevice
        left_encoder = DigitalInputDevice(17, pull_up=True)
        right_encoder = DigitalInputDevice(27, pull_up=True)

        encoder_counts = {"left": 0, "right": 0}
        encoder_lock = threading.Lock()

        def on_left_pulse():
            with encoder_lock:
                encoder_counts["left"] += 1

        def on_right_pulse():
            with encoder_lock:
                encoder_counts["right"] += 1

        left_encoder.when_activated = on_left_pulse
        left_encoder.when_deactivated = on_left_pulse
        right_encoder.when_activated = on_right_pulse
        right_encoder.when_deactivated = on_right_pulse

        hardware["left_encoder"] = left_encoder
        hardware["right_encoder"] = right_encoder
        hardware["encoder_counts"] = encoder_counts
        hardware["encoder_lock"] = encoder_lock
        print("[ENCODERS] Initialized on GPIO 17 (left) and GPIO 27 (right)")
    except Exception as e:
        print(f"[ENCODERS] Failed: {e}")
