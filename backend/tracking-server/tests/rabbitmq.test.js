const amqp = require('amqplib');
const { connectRabbitMQ, publishEvent } = require('../config/rabbitmq');

jest.mock('amqplib');

describe('RabbitMQ Config', () => {
  let mockChannel;
  let mockConnection;

  beforeEach(() => {
    mockChannel = {
      assertExchange: jest.fn().mockResolvedValue(true),
      assertQueue: jest.fn().mockResolvedValue(true),
      bindQueue: jest.fn().mockResolvedValue(true),
      publish: jest.fn().mockReturnValue(true)
    };
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      on: jest.fn()
    };
    amqp.connect.mockResolvedValue(mockConnection);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should connect to RabbitMQ and setup queues/exchanges', async () => {
    await connectRabbitMQ();
    expect(amqp.connect).toHaveBeenCalled();
    expect(mockConnection.createChannel).toHaveBeenCalled();
    expect(mockChannel.assertExchange).toHaveBeenCalledWith('delivery_dlx', 'fanout', { durable: true });
    expect(mockChannel.assertQueue).toHaveBeenCalledWith('delivery_dead_letter', { durable: true });
    expect(mockChannel.bindQueue).toHaveBeenCalledWith('delivery_dead_letter', 'delivery_dlx', '');
    expect(mockChannel.assertExchange).toHaveBeenCalledWith('delivery_events', 'topic', { durable: true });
  });

  it('should publish an event successfully', async () => {
    await connectRabbitMQ();
    const data = { orderId: 'test-123' };
    const result = await publishEvent('test.route', data);
    
    expect(result).toBe(true);
    expect(mockChannel.publish).toHaveBeenCalledWith(
      'delivery_events',
      'test.route',
      Buffer.from(JSON.stringify(data)),
      expect.objectContaining({
        persistent: true,
        contentType: 'application/json'
      })
    );
  });

  it('should return false if publishing fails without channel', async () => {
    // We intentionally don't connect
    // Require a fresh module so rabbitChannel is null
    jest.isolateModules(async () => {
      const rm = require('../config/rabbitmq');
      const data = { orderId: 'test-123' };
      const result = await rm.publishEvent('test.route', data);
      expect(result).toBe(false);
    });
  });
});
