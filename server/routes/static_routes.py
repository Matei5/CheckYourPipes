import os

def handle_static_route(server, path):
    file_map = {
        "/": ("index.html", "text/html"),
        "/style.css": ("style.css", "text/css"),
    }
    
    # check explicitly mapped root files for security.
    if path in file_map:
        filename, content_type = file_map[path]
        return serve_file(server, filename, content_type)
        
    # serve javascript files dynamically from the js directory.
    if path.startswith("/js/") and path.endswith(".js"):
        # strip leading slash so python finds the local file instead of root.
        filename = path[1:]
        return serve_file(server, filename, "application/javascript")
        
    return False

def serve_file(server, filename, content_type):
    try:
        with open(filename, "r", encoding="utf-8") as f:
            server.send_response(200)
            server.send_header("Content-type", content_type)
            server.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            server.send_header("Pragma", "no-cache")
            server.send_header("Expires", "0")
            server.end_headers()
            server.wfile.write(f.read().encode())
        return True
    except FileNotFoundError:
        server.send_error(404)
        return True
    except Exception as e:
        print(f"[FILE] Error serving {filename}: {e}")
        server.send_error(500)
        return True
