const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { connectRabbitMQ } = require('./config/rabbitmq');
const orderRoutes = require('./routes/orderRoutes');
const socketHandler = require('./sockets/socketHandler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ service: 'Tracking Server', status: 'running', message: 'API is up and running' });
});
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tracking-server',
    timestamp: new Date().toISOString()
  });
});
app.use('/api', orderRoutes);

// Sockets
socketHandler(io);

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Tracking Server corriendo en http://localhost:${PORT}`);
  console.log(`   WebSocket listo para conexiones\n`);
  connectRabbitMQ();
});
