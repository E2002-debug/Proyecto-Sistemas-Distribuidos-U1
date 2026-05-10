const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

router.get('/orders', orderController.getOrders);
router.post('/orders', orderController.createOrder);
router.get('/orders/:orderId', orderController.getOrderById);
router.get('/orders/:orderId/history', orderController.getOrderHistory);

module.exports = router;
