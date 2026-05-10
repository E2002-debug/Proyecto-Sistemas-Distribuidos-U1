import os
import json
import time
import pika
import logging
from controllers.billingController import save_invoice

logger = logging.getLogger(__name__)

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
