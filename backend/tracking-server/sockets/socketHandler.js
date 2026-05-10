const db = require('../db/database');
const { publishEvent } = require('../config/rabbitmq');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] 🔌 Conectado: ${socket.id}`);

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

    socket.on('location_update', ({ orderId, lat, lng }) => {
      if (!orderId || lat === undefined || lng === undefined) return;
      db.saveLocation(orderId, lat, lng);
      socket.to(`order_${orderId}`).emit('location_update', {
        lat, lng, timestamp: new Date().toISOString()
      });
    });

    socket.on('status_update', async ({ orderId, status }) => {
      if (!orderId || !status) return;
      db.updateOrderStatus(orderId, status);

      io.to(`order_${orderId}`).emit('status_update', {
        status, timestamp: new Date().toISOString()
      });

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
};
