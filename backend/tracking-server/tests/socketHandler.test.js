const socketHandler = require('../sockets/socketHandler');
const db = require('../db/database');
const rabbitmq = require('../config/rabbitmq');

jest.mock('../db/database', () => ({
  getOrder: jest.fn(),
  saveLocation: jest.fn(),
  updateOrderStatus: jest.fn()
}));

jest.mock('../config/rabbitmq', () => ({
  publishEvent: jest.fn().mockResolvedValue(true)
}));

describe('Socket Handler', () => {
  let mockIo;
  let mockSocket;

  beforeEach(() => {
    mockSocket = {
      id: 'test-socket-123',
      join: jest.fn(),
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
      data: {},
      on: jest.fn()
    };

    mockIo = {
      on: jest.fn((event, cb) => {
        if (event === 'connection') {
          cb(mockSocket);
        }
      }),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn()
    };

    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize connection event', () => {
    socketHandler(mockIo);
    expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('should handle join_order event', () => {
    socketHandler(mockIo);
    // Find the 'join_order' callback
    const joinOrderCb = mockSocket.on.mock.calls.find(call => call[0] === 'join_order')[1];
    
    db.getOrder.mockReturnValue({ id: 'test-1', customer_name: 'Bob' });
    
    joinOrderCb({ orderId: 'test-1', role: 'cliente' });
    
    expect(mockSocket.join).toHaveBeenCalledWith('order_test-1');
    expect(db.getOrder).toHaveBeenCalledWith('test-1');
    expect(mockSocket.emit).toHaveBeenCalledWith('order_info', expect.objectContaining({ id: 'test-1' }));
    expect(mockSocket.to).toHaveBeenCalledWith('order_test-1');
  });

  it('should handle location_update event', () => {
    socketHandler(mockIo);
    const locationUpdateCb = mockSocket.on.mock.calls.find(call => call[0] === 'location_update')[1];
    
    locationUpdateCb({ orderId: 'test-1', lat: -3.99, lng: -79.20 });
    
    expect(db.saveLocation).toHaveBeenCalledWith('test-1', -3.99, -79.20);
    expect(mockSocket.to).toHaveBeenCalledWith('order_test-1');
  });

  it('should handle status_update event and publish to RabbitMQ', async () => {
    socketHandler(mockIo);
    const statusUpdateCb = mockSocket.on.mock.calls.find(call => call[0] === 'status_update')[1];
    
    db.getOrder.mockReturnValue({ customer_name: 'Alice' });
    
    await statusUpdateCb({ orderId: 'test-1', status: 'En camino' });
    
    expect(db.updateOrderStatus).toHaveBeenCalledWith('test-1', 'En camino');
    expect(mockIo.to).toHaveBeenCalledWith('order_test-1');
    expect(rabbitmq.publishEvent).toHaveBeenCalledWith(
      'delivery.estado.en_camino',
      expect.objectContaining({
        orderId: 'test-1',
        status: 'En camino'
      })
    );
    expect(mockSocket.emit).toHaveBeenCalledWith('event_published', expect.any(Object));
  });
});
