import os
import json
import time
import sqlite3
import threading
import logging
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS
import pika

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s [Billing] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ─── Database ─────────────────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'billing.db')
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_conn() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS invoices (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id  TEXT NOT NULL,
                event     TEXT NOT NULL,
                customer  TEXT,
                address   TEXT,
                amount    REAL DEFAULT 0.0,
                retries   INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    logger.info('Base de datos inicializada')

def save_invoice(order_id, event, customer, address, amount, retries=0):
    with get_conn() as conn:
        cur = conn.execute(
            'INSERT INTO invoices (order_id,event,customer,address,amount,retries) VALUES(?,?,?,?,?,?)',
            (order_id, event, customer, address, amount, retries)
        )
        return cur.lastrowid

def all_invoices():
    with get_conn() as conn:
        rows = conn.execute('SELECT * FROM invoices ORDER BY created_at DESC').fetchall()
        return [dict(r) for r in rows]

# ─── RabbitMQ Consumer ────────────────────────────────────────────────────────
RABBITMQ_HOST = os.environ.get('RABBITMQ_HOST', 'localhost')
EXCHANGE      = 'delivery_events'
QUEUE         = 'billing_queue'
BINDING_KEY   = 'delivery.estado.*'
DLX           = 'delivery_dlx'

STATUS_AMOUNTS = {
    'recogiendo': 0.0,
    'en_camino':  0.0,
    'entregado':  15.99,
}

def process_message(body, retries=0):
    data      = json.loads(body)
    order_id  = data.get('orderId', 'N/A')
    status    = data.get('status', '').lower().replace(' ', '_')
    customer  = data.get('customerName', 'Cliente')
    address   = data.get('address', 'N/A')
    amount    = STATUS_AMOUNTS.get(status, 0.0)

    invoice_id = save_invoice(order_id, status, customer, address, amount, retries)
    logger.info(f'✅ Factura #{invoice_id} | Pedido={order_id} | Estado={status} | ${amount:.2f}')

def on_message(ch, method, props, body):
    retries = (props.headers or {}).get('x-retry-count', 0)
    try:
        process_message(body, retries)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        logger.error(f'❌ Error procesando: {e}')
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        if retries < 3:
            delay = 2 ** (retries + 1)   # 2 → 4 → 8 segundos
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
                logger.error(f'Error al re-publicar: {pub_err}')
        else:
            logger.error('💀 Máximo de reintentos alcanzado → DLQ')

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
                queue=QUEUE, durable=True,
                arguments={'x-dead-letter-exchange': DLX}
            )
            ch.queue_bind(exchange=EXCHANGE, queue=QUEUE, routing_key=BINDING_KEY)
            ch.basic_qos(prefetch_count=1)
            ch.basic_consume(queue=QUEUE, on_message_callback=on_message)
            logger.info(f'🎧 Escuchando cola [{QUEUE}] con routing_key [{BINDING_KEY}]')
            ch.start_consuming()
        except pika.exceptions.AMQPConnectionError as e:
            logger.error(f'RabbitMQ no disponible: {e}. Reintentando en 5s...')
            time.sleep(5)
        except Exception as e:
            logger.error(f'Error inesperado: {e}. Reintentando en 5s...')
            time.sleep(5)

# ─── REST API ─────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return jsonify({'service': 'Billing Service', 'status': 'running', 'message': 'API is up and running'})

@app.route('/api/invoices')
def get_invoices():
    return jsonify(all_invoices())

@app.route('/api/invoices/order/<order_id>')
def get_invoices_by_order(order_id):
    invs = [i for i in all_invoices() if i['order_id'] == order_id]
    return jsonify(invs)

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'billing', 'ts': datetime.now().isoformat()})

# ─── Main ─────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    init_db()
    threading.Thread(target=start_consumer, daemon=True).start()
    logger.info('🚀 Billing Service corriendo en http://localhost:5001')
    app.run(host='0.0.0.0', port=5001, debug=False)
