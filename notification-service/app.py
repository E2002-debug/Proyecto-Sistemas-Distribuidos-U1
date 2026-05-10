import os
import json
import time
import queue
import sqlite3
import threading
import logging
from datetime import datetime
from flask import Flask, jsonify, request, Response, stream_with_context
from flask_cors import CORS
import pika

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s [Notif] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ─── Database ─────────────────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'notifications.db')
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS notifications (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id   TEXT NOT NULL,
                message    TEXT NOT NULL,
                status     TEXT NOT NULL,
                type       TEXT DEFAULT 'info',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    logger.info('Base de datos inicializada')

def save_notification(order_id, message, status, ntype):
    with get_conn() as conn:
        cur = conn.execute(
            'INSERT INTO notifications (order_id,message,status,type) VALUES(?,?,?,?)',
            (order_id, message, status, ntype)
        )
        return cur.lastrowid

def all_notifications(order_id=None):
    with get_conn() as conn:
        if order_id:
            rows = conn.execute(
                'SELECT * FROM notifications WHERE order_id=? ORDER BY created_at DESC',
                (order_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100'
            ).fetchall()
        return [dict(r) for r in rows]

# ─── SSE Subscribers ──────────────────────────────────────────────────────────
# Dict: channel_key -> list of queue.Queue
_subscribers: dict[str, list] = {}
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

# ─── RabbitMQ Consumer ────────────────────────────────────────────────────────
RABBITMQ_HOST = os.environ.get('RABBITMQ_HOST', 'localhost')
EXCHANGE      = 'delivery_events'
QUEUE_NAME    = 'notification_queue'
BINDING_KEY   = 'delivery.estado.*'
DLX           = 'delivery_dlx'

STATUS_TEMPLATES = {
    'recogiendo': ('🏪 El repartidor está recogiendo tu pedido', 'warning'),
    'en_camino':  ('🚴 Tu repartidor está en camino a tu dirección', 'info'),
    'entregado':  ('✅ ¡Tu pedido ha sido entregado exitosamente!', 'success'),
}

def process_notification(body, retries=0):
    data     = json.loads(body)
    order_id = data.get('orderId', 'N/A')
    status   = data.get('status', '').lower().replace(' ', '_')

    msg, ntype = STATUS_TEMPLATES.get(status, (f'Estado actualizado: {status}', 'info'))
    nid = save_notification(order_id, msg, status, ntype)

    payload = {
        'id': nid, 'orderId': order_id, 'message': msg,
        'status': status, 'type': ntype,
        'timestamp': datetime.now().isoformat()
    }
    push(order_id, payload)   # per-order channel
    push('global', payload)   # global channel
    logger.info(f'✅ Notificación #{nid} | {order_id} | {msg}')

def on_message(ch, method, props, body):
    retries = (props.headers or {}).get('x-retry-count', 0)
    try:
        process_notification(body, retries)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        logger.error(f'❌ Error: {e}')
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        if retries < 3:
            delay = 2 ** (retries + 1)
            logger.warning(f'🔁 Reintento {retries+1}/3 en {delay}s...')
            time.sleep(delay)
            try:
                ch.basic_publish(
                    exchange=EXCHANGE,
                    routing_key=method.routing_key,
                    body=body,
                    properties=pika.BasicProperties(
                        delivery_mode=2,
                        headers={'x-retry-count': retries + 1}
                    )
                )
            except Exception as pub_err:
                logger.error(f'Re-publish error: {pub_err}')
        else:
            logger.error('💀 Máximo reintentos → DLQ')

def start_consumer():
    while True:
        try:
            logger.info(f'Conectando a RabbitMQ ({RABBITMQ_HOST})...')
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(host=RABBITMQ_HOST, heartbeat=600)
            )
            ch = conn.channel()
            ch.exchange_declare(exchange=EXCHANGE, exchange_type='topic', durable=True)
            ch.queue_declare(
                queue=QUEUE_NAME, durable=True,
                arguments={'x-dead-letter-exchange': DLX}
            )
            ch.queue_bind(exchange=EXCHANGE, queue=QUEUE_NAME, routing_key=BINDING_KEY)
            ch.basic_qos(prefetch_count=1)
            ch.basic_consume(queue=QUEUE_NAME, on_message_callback=on_message)
            logger.info(f'🎧 Escuchando cola [{QUEUE_NAME}]')
            ch.start_consuming()
        except pika.exceptions.AMQPConnectionError as e:
            logger.error(f'RabbitMQ no disponible: {e}. Reintentando en 5s...')
            time.sleep(5)
        except Exception as e:
            logger.error(f'Error inesperado: {e}. Reintentando en 5s...')
            time.sleep(5)

# ─── REST & SSE API ───────────────────────────────────────────────────────────
@app.route('/api/notifications')
def get_all():
    order_id = request.args.get('order_id')
    return jsonify(all_notifications(order_id))

@app.route('/api/notifications/stream')
def sse_stream():
    """Server-Sent Events: /api/notifications/stream?order_id=XYZ (or global)"""
    order_id = request.args.get('order_id', 'global')
    q = subscribe(order_id)

    def generate():
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

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'notifications', 'ts': datetime.now().isoformat()})

# ─── Main ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    threading.Thread(target=start_consumer, daemon=True).start()
    logger.info('🚀 Notification Service corriendo en http://localhost:5002')
    app.run(host='0.0.0.0', port=5002, debug=False, threaded=True)
