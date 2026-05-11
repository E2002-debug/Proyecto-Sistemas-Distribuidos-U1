import os
import json
import time
import pika
import logging
from controllers.billingController import save_invoice

logger = logging.getLogger(__name__)

# Configuraciones de RabbitMQ (nombres de Exchanges y Colas)
RABBITMQ_HOST = os.environ.get('RABBITMQ_HOST', 'localhost')
EXCHANGE      = 'delivery_events'      # El Exchange del que leeremos (Topic)
QUEUE         = 'billing_queue'        # Nuestra cola dedicada a facturas
BINDING_KEY   = 'delivery.estado.*'    # Escuchamos cualquier evento que diga 'delivery.estado.[algo]'
DLX           = 'delivery_dlx'         # Exchange de Dead Letter (para fallos)

# Diccionario que define cuánto cobrar dependiendo del estado
STATUS_AMOUNTS = {
    'recogiendo': 0.0,
    'en_camino':  0.0,
    'entregado':  15.99, # ¡Solo cobramos cuando la orden llega a su destino!
}

# Lógica de Negocio: Procesar un mensaje individual
def process_message(body, retries=0):
    # Convertimos los bytes del mensaje a un diccionario JSON
    data      = json.loads(body)
    order_id  = data.get('orderId', 'N/A')
    status    = data.get('status', '').lower().replace(' ', '_')
    customer  = data.get('customerName', 'Cliente')
    address   = data.get('address', 'N/A')
    
    # Obtenemos el monto a cobrar ($0.0 o $15.99)
    amount    = STATUS_AMOUNTS.get(status, 0.0)

    # Guardamos la factura en la base de datos
    invoice_id = save_invoice(order_id, status, customer, address, amount, retries)
    logger.info(f'✅ Factura #{invoice_id} | Pedido={order_id} | Estado={status} | ${amount:.2f}')

# Callback (Se ejecuta cada vez que RabbitMQ nos empuja un mensaje)
def on_message(ch, method, props, body):
    # Extraemos cuántas veces se ha reintentado este mensaje (viene en los Headers del mensaje)
    retries = (props.headers or {}).get('x-retry-count', 0)
    try:
        # Intentamos procesarlo
        process_message(body, retries)
        
        # ─── CONFIRMACIÓN (ACK) ───
        # Le decimos a RabbitMQ: "Ya procesé esto exitosamente, puedes borrarlo de la cola"
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        logger.error(f'❌ Error procesando: {e}')
        
        # ─── RECHAZO (NACK) ───
        # Le decimos a RabbitMQ que fallamos y que NO lo vuelva a poner directamente en la cola original
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        
        # ─── POLÍTICA DE REINTENTOS (EXPONENTIAL BACKOFF) ───
        if retries < 3:
            # Esperamos 2s, 4s, u 8s según el intento
            delay = 2 ** (retries + 1)
            logger.warning(f'🔁 Reintento {retries+1}/3 en {delay}s...')
            time.sleep(delay)
            try:
                # Volvemos a publicar el mensaje nosotros mismos, incrementando el contador de reintentos
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
            # Si superamos los 3 reintentos, lo dejamos morir (terminará en la DLQ / delivery_dead_letter)
            logger.error('💀 Máximo de reintentos alcanzado → DLQ')

# Hilo Principal del Consumidor
def start_consumer():
    while True: # Bucle infinito por si RabbitMQ se desconecta
        try:
            logger.info(f'Conectando a RabbitMQ ({RABBITMQ_HOST})...')
            # 1. Conectar y crear canal
            conn = pika.BlockingConnection(
                pika.ConnectionParameters(host=RABBITMQ_HOST, heartbeat=600)
            )
            ch = conn.channel()
            
            # 2. Declarar el Exchange, la Cola y atarlos juntos (Binding)
            ch.exchange_declare(exchange=EXCHANGE, exchange_type='topic', durable=True)
            ch.queue_declare(
                queue=QUEUE, durable=True,
                arguments={'x-dead-letter-exchange': DLX} # Configuramos la DLQ para fallos
            )
            ch.queue_bind(exchange=EXCHANGE, queue=QUEUE, routing_key=BINDING_KEY)
            
            # 3. Solo tomar 1 mensaje a la vez (evita sobrecargar la RAM del servicio)
            ch.basic_qos(prefetch_count=1)
            
            # 4. Iniciar la suscripción activa
            ch.basic_consume(queue=QUEUE, on_message_callback=on_message)
            logger.info(f'🎧 Escuchando cola [{QUEUE}] con routing_key [{BINDING_KEY}]')
            
            # Bloquea el hilo y se queda escuchando eternamente
            ch.start_consuming()
            
        except pika.exceptions.AMQPConnectionError as e:
            logger.error(f'RabbitMQ no disponible: {e}. Reintentando en 5s...')
            time.sleep(5)
        except Exception as e:
            logger.error(f'Error inesperado: {e}. Reintentando en 5s...')
            time.sleep(5)
