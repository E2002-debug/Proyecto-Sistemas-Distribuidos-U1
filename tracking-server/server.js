const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const amqp = require('amqplib');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./db/database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// ─── RabbitMQ Setup ───────────────────────────────────────────────────────────
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE_NAME = 'delivery_events';
const DLX_NAME = 'delivery_dlx';
const DLQ_NAME = 'delivery_dead_letter';

let rabbitChannel = null;

async function connectRabbitMQ() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Dead Letter setup
    await channel.assertExchange(DLX_NAME, 'fanout', { durable: true });
    await channel.assertQueue(DLQ_NAME, { durable: true });
    await channel.bindQueue(DLQ_NAME, DLX_NAME, '');

    // Main topic exchange
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

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ service: 'Tracking Server', status: 'running', message: 'API is up and running' });
});

app.get('/api/orders', (req, res) => {
  res.json(db.getOrders());
});

app.post('/api/orders', (req, res) => {
  const { customerName, address, deliveryPersonName } = req.body;
  if (!customerName || !address) {
    return res.status(400).json({ error: 'customerName y address son requeridos' });
  }
  const orderId = uuidv4().substring(0, 8).toUpperCase();
  db.createOrder(orderId, customerName, address, deliveryPersonName);
  console.log(`[API] Pedido creado: ${orderId}`);
  res.status(201).json({ orderId, customerName, address, status: 'Pendiente' });
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = db.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(order);
});

app.get('/api/orders/:orderId/history', (req, res) => {
  res.json(db.getLocationHistory(req.params.orderId));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tracking-server',
    rabbitmq: rabbitChannel ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket.IO] 🔌 Conectado: ${socket.id}`);

  // Join a room by orderId
  socket.on('join_order', ({ orderId, role }) => {
    if (!orderId || !role) return;
    socket.join(`order_${orderId}`);
    socket.data.orderId = orderId;
    socket.data.role = role;
    console.log(`[Socket.IO] ${role} unido al pedido ${orderId}`);

    const order = db.getOrder(orderId);
    if (order) socket.emit('order_info', order);

    socket.to(`order_${orderId}`).emit('peer_joined', { role, socketId: socket.id });
  });

  // Driver sends GPS coordinates
  socket.on('location_update', ({ orderId, lat, lng }) => {
    if (!orderId || lat === undefined || lng === undefined) return;
    db.saveLocation(orderId, lat, lng);
    socket.to(`order_${orderId}`).emit('location_update', {
      lat, lng, timestamp: new Date().toISOString()
    });
  });

  // Driver changes delivery status
  socket.on('status_update', async ({ orderId, status }) => {
    if (!orderId || !status) return;

    db.updateOrderStatus(orderId, status);

    // Broadcast to all in room
    io.to(`order_${orderId}`).emit('status_update', {
      status, timestamp: new Date().toISOString()
    });

    // Publish to RabbitMQ
    const order = db.getOrder(orderId);
    const routingKey = `delivery.estado.${status.toLowerCase().replace(/\s+/g, '_')}`;
    const published = await publishEvent(routingKey, {
      orderId,
      status,
      customerName: order?.customer_name,
      deliveryPersonName: order?.delivery_person_name,
      address: order?.address,
      timestamp: new Date().toISOString()
    });

    socket.emit('event_published', { routingKey, published });
    console.log(`[Socket.IO] Estado actualizado [${orderId}]: ${status}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] 🔴 Desconectado: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Tracking Server corriendo en http://localhost:${PORT}`);
  console.log(`   WebSocket listo para conexiones\n`);
  connectRabbitMQ();
});
