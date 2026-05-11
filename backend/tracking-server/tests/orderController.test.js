const { createOrder } = require('../controllers/orderController');
const db = require('../db/database');

jest.mock('../db/database', () => ({
  createOrder: jest.fn(),
  getOrders: jest.fn(),
  getOrder: jest.fn()
}));

describe('Order Controller', () => {
  it('should create an order successfully', () => {
    const req = {
      body: {
        customerName: 'Test User',
        address: 'Test Address',
        deliveryPersonName: 'Driver 1'
      }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      customerName: 'Test User',
      address: 'Test Address',
      status: 'Pendiente'
    }));
    expect(db.createOrder).toHaveBeenCalled();
  });

  it('should return 400 if missing customerName or address', () => {
    const req = { body: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    createOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'customerName y address son requeridos' });
  });
});
