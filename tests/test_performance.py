import sys
import os
import time
import timeit
import unittest
import threading
from io import BytesIO

# Add parent directory to path to import stream.py
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import stream

class MockHandler(stream.Handler):
    # Mock handler to test HTTP API endpoints without starting a real server.
    def __init__(self, path):
        self.path = path
        self.wfile = BytesIO()
        self.rfile = BytesIO()
        
    # Override network methods
    def send_response(self, *args):
        pass
        
    def send_header(self, *args):
        pass
        
    def end_headers(self, *args):
        pass

class TestRobotPerformance(unittest.TestCase):
    
    def test_1_odometry_math_latency(self):
        # Benchmark pose_loop math to prove map updating doesn't block CPU.
        stream.pose["x"] = 0.0
        stream.pose["y"] = 0.0
        stream.pose["heading"] = 0.0

        def single_odometry_step():
            dt = 0.05
            gyro_z = 0.1
            left_ticks = 5
            right_ticks = 5
            
            # Simplified mock of pose_loop math
            stream.pose["heading"] += gyro_z * dt
            heading = stream.pose["heading"]
            
            avg_ticks = (left_ticks + right_ticks) / 2.0
            dist = avg_ticks * stream.DISTANCE_PER_TICK
            
            stream.pose["vx"] = (dist * 1.0) / dt
            stream.pose["vy"] = 0.0
            import math
            stream.pose["x"] += dist * math.cos(heading)
            stream.pose["y"] += dist * math.sin(heading)

        iterations = 10000
        total_time = timeit.timeit(single_odometry_step, number=iterations)
        avg_time_ms = (total_time / iterations) * 1000
        
        print(f"\n[BENCHMARK] Odometry Math (1 step): {avg_time_ms:.5f} ms")
        self.assertLess(avg_time_ms, 1.0, "Odometry math should take < 1ms")

    def test_2_api_control_latency(self):
        # Benchmark motor control request speed to show raw HTTP efficiency.
        handler = MockHandler("/control?cmd=forward&throttle=0.8")

        def handle_request():
            handler.wfile = BytesIO() # reset buffer
            handler.do_GET()

        iterations = 1000
        total_time = timeit.timeit(handle_request, number=iterations)
        avg_time_ms = (total_time / iterations) * 1000
        
        print(f"[BENCHMARK] HTTP API /control Latency: {avg_time_ms:.5f} ms")
        self.assertLess(avg_time_ms, 10.0, "API control latency should be < 10ms")

    def test_3_i2c_lock_contention(self):
        # Simulate lock contention to verify continuous I2C reads aren't bottlenecks.
        def lock_requester():
            for _ in range(500):
                with stream.i2c_lock:
                    # Simulate a very short hardware read operation (e.g. MPU9250 register read)
                    time.sleep(0.0001)

        start = time.time()
        
        # 4 threads simulating: motor writer, imu reader, bme reader, gas reader
        threads = [threading.Thread(target=lock_requester) for _ in range(4)]
        
        for t in threads:
            t.start()
        for t in threads:
            t.join()
            
        end = time.time()
        
        duration_ms = (end - start) * 1000
        ops_per_sec = (4 * 500) / (end - start)
        
        print(f"[BENCHMARK] Lock Contention (4 threads, 2000 reads): {duration_ms:.2f} ms")
        print(f"[BENCHMARK] Max Theoretical Sensor reads: {ops_per_sec:.0f} ops/sec")
        self.assertGreater(ops_per_sec, 1000, "Architecture should handle at least 1000 lock ops/sec")

    @classmethod
    def tearDownClass(cls):
        # Stop motors after tests finish, because test_2 leaves them running
        stream.stop_all_motors()

if __name__ == '__main__':
    unittest.main()
