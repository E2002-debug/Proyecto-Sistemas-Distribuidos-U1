const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'tracking.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    address TEXT NOT NULL,
    delivery_person_name TEXT DEFAULT 'Repartidor',
    status TEXT DEFAULT 'Pendiente',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS location_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`);

module.exports = {
  createOrder(id, customerName, address, deliveryPersonName) {
    return db.prepare(`
      INSERT INTO orders (id, customer_name, address, delivery_person_name)
      VALUES (?, ?, ?, ?)
    `).run(id, customerName, address, deliveryPersonName || 'Repartidor');
  },

  getOrders() {
    return db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  },

  getOrder(id) {
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  },

  updateOrderStatus(id, status) {
    return db.prepare(`
      UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, id);
  },

  saveLocation(orderId, lat, lng) {
    return db.prepare(`
      INSERT INTO location_history (order_id, lat, lng) VALUES (?, ?, ?)
    `).run(orderId, lat, lng);
  },

  getLocationHistory(orderId) {
    return db.prepare(`
      SELECT * FROM location_history WHERE order_id = ? ORDER BY timestamp ASC
    `).all(orderId);
  }
};
