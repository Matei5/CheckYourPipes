from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import json

# from flask import Flask, jsonify
# app = Flask(__name__)
# 
# @app.route('/api/telemetry', methods=['GET'])
# def get_telemetry():
#     from server.config import state, pose
#     return jsonify({"state": state, "pose": pose})

from server.routes.static_routes import handle_static_route
from server.routes.api_routes import handle_api_route
from server.routes.stream_routes import handle_stream_route

class QuietHTTPServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        import sys
        err = sys.exc_info()[1]
        if isinstance(err, (ConnectionResetError, BrokenPipeError)):
            print(f"[SERVER] Connection dropped by {client_address[0]} (safe to ignore)")
        else:
            super().handle_error(request, client_address)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, data, status=200):
        try:
            self.send_response(status)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        path = urlparse(self.path).path

        if handle_static_route(self, path):
            return
        
        if handle_api_route(self, path):
            return
            
        if handle_stream_route(self, path):
            return

        self.send_error(404)
