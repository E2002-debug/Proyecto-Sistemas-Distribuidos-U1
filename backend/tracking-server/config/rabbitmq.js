const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE_NAME = 'delivery_events';
const DLX_NAME = 'delivery_dlx';
const DLQ_NAME = 'delivery_dead_letter';

let rabbitChannel = null;

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertExchange(DLX_NAME, 'fanout', { durable: true });
    await channel.assertQueue(DLQ_NAME, { durable: true });
    await channel.bindQueue(DLQ_NAME, DLX_NAME, '');
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

    rabbitChannel = channel;
    console.log('[RabbitMQ] ✅ Conectado al broker');

    connection.on('error', () => setTimeout(connectRabbitMQ, 5000));
    connection.on('close', () => {
      console.warn('[RabbitMQ] Conexión cerrada, reconectando...');
      setTimeout(connectRabbitMQ, 5000);
    });
  } catch (err) {
    console.error(`[RabbitMQ] ❌ Error: ${err.message}. Reintentando en 5s...`);
    setTimeout(connectRabbitMQ, 5000);
  }
}

async function publishEvent(routingKey, data) {
  if (!rabbitChannel) {
    console.warn('[RabbitMQ] Canal no disponible, evento descartado');
    return false;
  }
  try {
    rabbitChannel.publish(
      EXCHANGE_NAME,
      routingKey,
      Buffer.from(JSON.stringify(data)),
      { persistent: true, contentType: 'application/json', timestamp: Date.now() }
    );
    console.log(`[RabbitMQ] 📤 Publicado [${routingKey}]:`, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error(`[RabbitMQ] Error publicando: ${err.message}`);
    return false;
  }
}

module.exports = { connectRabbitMQ, publishEvent };
