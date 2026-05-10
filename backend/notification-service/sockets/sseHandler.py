import queue
import threading
import json
from flask import Response, stream_with_context

_subscribers = {}
_lock = threading.Lock()

def subscribe(channel: str) -> queue.Queue:
    q = queue.Queue(maxsize=50)
    with _lock:
        _subscribers.setdefault(channel, []).append(q)
    return q

def unsubscribe(channel: str, q: queue.Queue):
    with _lock:
        if channel in _subscribers:
            try:
                _subscribers[channel].remove(q)
            except ValueError:
                pass

def push(channel: str, data: dict):
    with _lock:
        qs = list(_subscribers.get(channel, []))
    dead = []
    for q in qs:
        try:
            q.put_nowait(data)
        except queue.Full:
            dead.append(q)
    for q in dead:
        unsubscribe(channel, q)

def generate_stream(order_id, q):
    try:
        yield f'data: {json.dumps({"type":"connected","channel":order_id})}\n\n'
        while True:
            try:
                data = q.get(timeout=25)
                yield f'data: {json.dumps(data)}\n\n'
            except queue.Empty:
                yield ': heartbeat\n\n'
    except GeneratorExit:
        unsubscribe(order_id, q)

def sse_response(order_id):
    q = subscribe(order_id)
    return Response(
        stream_with_context(generate_stream(order_id, q)),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )
