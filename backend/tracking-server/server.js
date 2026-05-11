// Importación de módulos principales
const express = require('express');        // Framework para crear el servidor web (REST API)
const http = require('http');              // Módulo nativo de Node.js para servidores HTTP
const { Server } = require('socket.io');   // Librería para WebSockets (Comunicación en tiempo real)
const cors = require('cors');              // Middleware para permitir peticiones desde el frontend
const { connectRabbitMQ } = require('./config/rabbitmq'); // Conexión al bus de mensajería asíncrona
const orderRoutes = require('./routes/orderRoutes');      // Rutas de la API REST para los pedidos
const socketHandler = require('./sockets/socketHandler'); // Lógica de las conexiones de WebSockets

// Inicialización de la aplicación Express
const app = express();
// Se envuelve Express dentro de un servidor HTTP clásico para que Socket.IO pueda engancharse a él
const server = http.createServer(app);

// Configuración del servidor de WebSockets
const io = new Server(server, {
  // CORS permite que el frontend (puerto 8080) se conecte a este backend (puerto 3000) sin ser bloqueado
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middlewares globales de Express
app.use(cors());           // Habilita CORS para las rutas HTTP
app.use(express.json());   // Permite que Express entienda el formato JSON en las peticiones (req.body)

// ─── 1. RUTAS DE LA API REST ───
// Ruta raíz para confirmar que el servicio está vivo
app.get('/', (req, res) => {
  res.json({ service: 'Tracking Server', status: 'running', message: 'API is up and running' });
});

// Ruta de "Health Check" (muy común en microservicios y Kubernetes para monitorear el estado)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tracking-server',
    timestamp: new Date().toISOString()
  });
});

// Importar y usar todas las rutas relacionadas con los "Pedidos" (/api/orders)
app.use('/api', orderRoutes);

// ─── 2. INICIALIZACIÓN DE WEBSOCKETS ───
// Le pasamos la instancia de Socket.IO a nuestro manejador especializado (explicado en socketHandler.js)
socketHandler(io);

// Nota: El archivo principal (`index.js` o donde se llame a `server.listen()`) es el encargado de iniciar este servidor y llamar a `connectRabbitMQ()`.

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Tracking Server corriendo en http://localhost:${PORT}`);
  console.log(`   WebSocket listo para conexiones\n`);
  connectRabbitMQ();
});
