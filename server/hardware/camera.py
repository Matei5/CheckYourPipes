from server.config import hardware, i2c_lock

def init_camera():
    try:
        from picamera2 import Picamera2
        picam = Picamera2()
        picam.configure(picam.create_video_configuration(main={"size": (1296, 972)}))
        picam.set_controls({"FrameRate": 15})
        picam.start()
        hardware["camera"] = picam
        print("[CAMERA] Initialized")
    except Exception as e:
        print(f"[CAMERA] Failed: {e}")
