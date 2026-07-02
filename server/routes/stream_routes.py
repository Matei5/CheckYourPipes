import time
import io
from PIL import Image
from server.config import hardware, state_lock, state

def handle_stream_route(server, path):
    if path == "/stream.mjpg":
        if "camera" not in hardware:
            server.send_error(503)
            return True

        server.send_response(200)
        server.send_header("Content-type", "multipart/x-mixed-replace; boundary=frame")
        server.end_headers()

        try:
            while True:
                frame = hardware["camera"].capture_array()
                frame = frame[::-1, ::-1, :]
                
                buf = io.BytesIO()
                image = Image.fromarray(frame).convert("RGB")
                
                with state_lock:
                    is_high_res = state.get("high_res", False)
                    
                if not is_high_res:
                    image = image.resize((648, 486))
                    
                image.save(buf, format="JPEG", quality=85 if is_high_res else 65)

                server.wfile.write(
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + buf.getvalue() + b"\r\n"
                )
                time.sleep(1 / 24.0)
        except Exception:
            pass
        return True
    return False
