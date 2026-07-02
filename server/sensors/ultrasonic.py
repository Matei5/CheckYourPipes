import time
import warnings
from server.config import hardware

try:
    from gpiozero.exc import PWMSoftwareFallback
    warnings.filterwarnings("ignore", category=PWMSoftwareFallback)
except ImportError:
    pass

class RobustUltrasonic:
    def __init__(self, trigger_pin, echo_pin, max_distance=2.0):
        from gpiozero import DigitalOutputDevice, DigitalInputDevice
        self.trigger = DigitalOutputDevice(trigger_pin)
        self.echo = DigitalInputDevice(echo_pin)
        self.max_distance = max_distance
        
    @property
    def distance(self):
        for _ in range(3):
            self.trigger.on()
            time.sleep(0.00001)
            self.trigger.off()
            
            start = time.time()
            timeout = start + (self.max_distance * 2 / 343.0) + 0.02

            # wait for echo to go high — don't update start inside this loop.
            while not self.echo.value and time.time() < timeout:
                pass
            start = time.time()  # mark the true echo start.

            stop = time.time()
            while self.echo.value and time.time() < timeout:
                stop = time.time()
                
            time_elapsed = stop - start
            if time_elapsed > 0.0001 and time_elapsed < (self.max_distance * 2 / 343.0):
                return time_elapsed * 343.0 / 2
                
            time.sleep(0.05)
            
        return self.max_distance

def init_ultrasonic():
    try:
        hardware["ultrasonic"] = RobustUltrasonic(trigger_pin=23, echo_pin=24, max_distance=2.0)
        print("[ULTRASONIC] Initialized robust synchronous sensor")
    except Exception as e:
        print(f"[ULTRASONIC] Failed: {e}")
