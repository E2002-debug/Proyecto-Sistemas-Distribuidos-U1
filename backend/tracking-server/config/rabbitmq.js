const amqp = require('amqplib'); // Cliente de RabbitMQ para Node.js

// Variables de entorno o valores por defecto
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE_NAME = 'delivery_events'; // Nombre de nuestro Exchange principal (tipo topic)
const DLX_NAME = 'delivery_dlx';         // Dead Letter Exchange (cementerio de mensajes)
const DLQ_NAME = 'delivery_dead_letter'; // Dead Letter Queue (la cola donde caen los mensajes muertos)

let rabbitChannel = null; // Guardará el canal abierto de comunicación con RabbitMQ

// Función para establecer y configurar la conexión al Broker de mensajes
async function connectRabbitMQ() {
  try {
    // 1. Establecer la conexión TCP con RabbitMQ
    const connection = await amqp.connect(RABBITMQ_URL);
    // 2. Crear un "canal" ligero sobre la conexión TCP
    const channel = await connection.createChannel();

    // ─── CONFIGURACIÓN DE TOLERANCIA A FALLOS (DEAD LETTER) ───
    // Declaramos el Exchange para mensajes que no pudieron ser procesados (muertos)
    await channel.assertExchange(DLX_NAME, 'fanout', { durable: true });
    // Declaramos la cola donde terminarán descansando los mensajes muertos
    await channel.assertQueue(DLQ_NAME, { durable: true });
    // Unimos la cola muerta al exchange de mensajes muertos
    await channel.bindQueue(DLQ_NAME, DLX_NAME, '');

    // ─── CONFIGURACIÓN DEL EXCHANGE PRINCIPAL ───
    // Declaramos un Exchange de tipo 'topic'. 
    // Un 'topic' permite enrutar mensajes basados en patrones (ej. 'delivery.estado.*')
    // 'durable: true' significa que el Exchange sobrevive a reinicios del servidor RabbitMQ
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    // Guardamos el canal globalmente para usarlo al publicar
    rabbitChannel = channel;
    console.log('[RabbitMQ] ✅ Conectado al broker y Exchanges configurados');

    // ─── MANEJO DE ERRORES Y RECONEXIÓN AUTOMÁTICA ───
    // Si la conexión da error, esperamos 5 segundos y volvemos a intentarlo
    connection.on('error', () => setTimeout(connectRabbitMQ, 5000));
    // Si la conexión se cierra inesperadamente, también reconectamos
    connection.on('close', () => {
      console.warn('[RabbitMQ] Conexión cerrada, reconectando...');
      setTimeout(connectRabbitMQ, 5000);
    });
  } catch (err) {
    // Si el propio RabbitMQ está apagado al inicio, atrapamos el error y reintentamos en bucle
    console.error(`[RabbitMQ] ❌ Error de conexión: ${err.message}. Reintentando en 5s...`);
    setTimeout(connectRabbitMQ, 5000);
  }
}

// Función asíncrona para publicar (enviar) mensajes a RabbitMQ
async function publishEvent(routingKey, data) {
  // Si no hay canal abierto, no podemos enviar el mensaje
  if (!rabbitChannel) {
    console.warn('[RabbitMQ] Canal no disponible, el evento fue descartado temporalmente.');
    return false;
  }
  try {
    // .publish() envía el mensaje al Exchange
    rabbitChannel.publish(
      EXCHANGE_NAME,                 // A qué Exchange enviar
      routingKey,                    // Con qué etiqueta (ej: 'delivery.estado.entregado')
      Buffer.from(JSON.stringify(data)), // El mensaje real (convertido a Buffer de Bytes)
      { 
        persistent: true,            // El mensaje se guardará en el disco duro de RabbitMQ (no se borra si se reinicia)
        contentType: 'application/json', // Indicamos que el contenido es JSON
        timestamp: Date.now()        // Estampa de tiempo del evento
      }
    );
    console.log(`[RabbitMQ] 📤 Evento Publicado exitosamente [${routingKey}]`);
    return true;
  } catch (err) {
    console.error(`[RabbitMQ] ❌ Error publicando evento: ${err.message}`);
    return false;
  }
}

// Exportamos las funciones para usarlas en otros archivos (como socketHandler.js)
module.exports = { connectRabbitMQ, publishEvent };
