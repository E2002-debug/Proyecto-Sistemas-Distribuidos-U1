const db = require('../db/database');
const { publishEvent } = require('../config/rabbitmq');

// Exportamos la función que recibe la instancia del servidor WebSocket (io)
module.exports = (io) => {
  // Evento principal: Se dispara cuando un cliente o repartidor abre la aplicación
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] 🔌 Conectado: ${socket.id}`);

    // ─── 1. GESTIÓN DE SALAS (ROOMS) ───
    // El frontend envía este evento para unirse a un pedido específico
    socket.on('join_order', ({ orderId, role }) => {
      if (!orderId || !role) return;
      
      // Agrupamos al cliente y al repartidor en una misma "habitación" aislada.
      // Así el GPS no se cruza con otros pedidos activos.
      socket.join(`order_${orderId}`); 
      
      // Guardamos la info localmente en esta conexión
      socket.data.orderId = orderId;
      socket.data.role = role;
      console.log(`[Socket.IO] ${role} unido al pedido ${orderId}`);

      // Le mandamos el historial o la info actual del pedido
      const order = db.getOrder(orderId);
      if (order) socket.emit('order_info', order);

      // Avisamos a los demás en la sala (ej. avisar al cliente que entró el repartidor)
      socket.to(`order_${orderId}`).emit('peer_joined', { role, socketId: socket.id });
    });

    // ─── 2. SEGUIMIENTO GPS EN TIEMPO REAL ───
    // Escuchamos las coordenadas constantes que nos manda la app del repartidor
    socket.on('location_update', ({ orderId, lat, lng }) => {
      if (!orderId || lat === undefined || lng === undefined) return;
      
      // Persistimos la ubicación en la base de datos (SQLite)
      db.saveLocation(orderId, lat, lng);
      
      // BROADCAST: Rebotamos las coordenadas SOLO a la sala correspondiente.
      // Esto empuja la actualización al mapa del cliente instantáneamente.
      socket.to(`order_${orderId}`).emit('location_update', {
        lat, lng, timestamp: new Date().toISOString()
      });
    });

    // ─── 3. PUBLICACIÓN DE EVENTOS (RABBITMQ) ───
    // El repartidor presiona un botón ("En Camino", "Entregado")
    socket.on('status_update', async ({ orderId, status }) => {
      if (!orderId || !status) return;
      
      // Actualizamos estado en base de datos central
      db.updateOrderStatus(orderId, status);

      // Emitimos el cambio vía WebSockets para que se dibuje en las interfaces gráficas
      io.to(`order_${orderId}`).emit('status_update', {
        status, timestamp: new Date().toISOString()
      });

      // --- INTEGRACIÓN ASÍNCRONA ---
      const order = db.getOrder(orderId);
      // Creamos la llave dinámica para RabbitMQ (ej. 'delivery.estado.en_camino')
      const routingKey = `delivery.estado.${status.toLowerCase().replace(/\s+/g, '_')}`;
      
      // Publicamos el evento. Los microservicios de Python (Facturación/Notificaciones) 
      // atraparán este mensaje sin bloquear este servidor Node.js.
      const published = await publishEvent(routingKey, {
        orderId,
        status,
        customerName: order?.customer_name,
        deliveryPersonName: order?.delivery_person_name,
        address: order?.address,
        timestamp: new Date().toISOString()
      });

      // Le confirmamos al frontend que todo salió bien
      socket.emit('event_published', { routingKey, published });
      console.log(`[Socket.IO] Estado actualizado [${orderId}]: ${status}`);
    });

    // ─── 4. DESCONEXIÓN ───
    // Limpiamos cuando alguien cierra la pestaña
    socket.on('disconnect', () => {
      console.log(`[Socket.IO] 🔴 Desconectado: ${socket.id}`);
    });
  });
};
