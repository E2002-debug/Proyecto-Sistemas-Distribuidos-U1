import os
import json
import time
import pika
import logging
from datetime import datetime
from controllers.notificationController import save_notification
from sockets.sseHandler import push

logger = logging.getLogger(__name__)

# Configuraciones de RabbitMQ
RABBITMQ_HOST = os.environ.get('RABBITMQ_HOST', 'localhost')
EXCHANGE      = 'delivery_events'
QUEUE_NAME    = 'notification_queue'   # Esta cola es EXCLUSIVA para el servicio de notificaciones
BINDING_KEY   = 'delivery.estado.*'    # Nos suscribimos a cualquier cambio de estado
DLX           = 'delivery_dlx'

# Plantillas de texto para traducir un estado genérico a un mensaje amigable para el cliente
STATUS_TEMPLATES = {
    'recogiendo': ('El repartidor está recogiendo tu pedido', 'warning'),
    'en_camino':  ('Tu repartidor está en camino a tu dirección', 'info'),
    'entregado':  ('¡Tu pedido ha sido entregado exitosamente!', 'success'),
}

# Lógica de Negocio: Procesar la Notificación
def process_notification(body, retries=0):
    # Decodificamos el JSON
    data     = json.loads(body)
    order_id = data.get('orderId', 'N/A')
    status   = data.get('status', '').lower().replace(' ', '_')

    # Buscamos la plantilla correspondiente (o un valor por defecto)
    msg, ntype = STATUS_TEMPLATES.get(status, (f'Estado actualizado: {status}', 'info'))
    
    # Guardamos el historial de notificaciones en SQLite
    nid = save_notification(order_id, msg, status, ntype)

    # Preparamos la carga útil que vamos a enviar al Frontend
    payload = {
        'id': nid, 'orderId': order_id, 'message': msg,
        'status': status, 'type': ntype,
        'timestamp': datetime.now().isoformat()
    }
    
    # ─── PUSH VÍA SSE (Server-Sent Events) ───
    # Empujamos los datos a dos canales distintos:
    push(order_id, payload)   # Canal privado (Solo lo ve el cliente de este pedido)
    push('global', payload)   # Canal global (Lo ve el Panel de Administración)
    logger.info(f'Notificación #{nid} | {order_id} | {msg}')

# Callback de recepción de mensaje
def on_message(ch, method, props, body):
    retries = (props.headers or {}).get('x-retry-count', 0)
    try:
        process_notification(body, retries)
        
        # Confirmamos que leímos y procesamos bien
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        logger.error(f'❌ Error: {e}')
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        
        # Mismo sistema de Backoff Exponencial que en Facturación
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

# Hilo del consumidor
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
            # Unimos la cola de notificaciones al Topic Exchange
            ch.queue_bind(exchange=EXCHANGE, queue=QUEUE_NAME, routing_key=BINDING_KEY)
            ch.basic_qos(prefetch_count=1)
            
            # Comenzamos a consumir
            ch.basic_consume(queue=QUEUE_NAME, on_message_callback=on_message)
            logger.info(f'🎧 Escuchando cola [{QUEUE_NAME}]')
            ch.start_consuming()
        except pika.exceptions.AMQPConnectionError as e:
            logger.error(f'RabbitMQ no disponible: {e}. Reintentando en 5s...')
            time.sleep(5)
        except Exception as e:
            logger.error(f'Error inesperado: {e}. Reintentando en 5s...')
            time.sleep(5)
