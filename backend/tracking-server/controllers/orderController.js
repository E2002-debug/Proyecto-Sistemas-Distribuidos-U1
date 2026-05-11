const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

const getOrders = (req, res) => {
  res.json(db.getOrders());
};

const createOrder = (req, res) => {
  const { customerName, address, deliveryPersonName } = req.body;
  if (!customerName || !address) {
    return res.status(400).json({ error: 'customerName y address son requeridos' });
  }
  const orderId = uuidv4().substring(0, 8).toUpperCase();
  db.createOrder(orderId, customerName, address, deliveryPersonName);
  console.log(`[API] Pedido creado: ${orderId}`);
  res.status(201).json({ orderId, customerName, address, status: 'Pendiente' });
};

const getOrderById = (req, res) => {
  const order = db.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json(order);
};

const getOrderHistory = (req, res) => {
  res.json(db.getLocationHistory(req.params.orderId));
};

module.exports = {
  getOrders,
  createOrder,
  getOrderById,
  getOrderHistory
};
