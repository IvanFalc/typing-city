#!/usr/bin/env python3
# Локальный сервер «Печатного Города»: раздача статики + сохранение раскладки.
# Запуск:  python server.py [порт]     (по умолчанию 8766)
#   игра:     http://127.0.0.1:8766/index.html
#   верстак:  http://127.0.0.1:8766/layout.html
# POST /api/layout  (тело — JSON раскладки) → перезаписывает layout.json в папке игры.
import http.server
import json
import os
import functools

ROOT = os.path.dirname(os.path.abspath(__file__))
LAYOUT_PATH = os.path.join(ROOT, 'layout.json')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/layout':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            data = self.rfile.read(length)
            parsed = json.loads(data.decode('utf-8'))
            if not isinstance(parsed, dict) or 'elements' not in parsed:
                raise ValueError('ожидался объект с ключом "elements"')
            with open(LAYOUT_PATH, 'w', encoding='utf-8') as f:
                json.dump(parsed, f, ensure_ascii=False, indent=2)
                f.write('\n')
            body = json.dumps({'ok': True}, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            print('[server] layout.json сохранён (%d байт)' % length)
        except Exception as e:
            body = json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8')
            self.send_response(400)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    print('Печатный Город: http://127.0.0.1:%d/index.html' % port)
    print('Верстак раскладки: http://127.0.0.1:%d/layout.html' % port)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
