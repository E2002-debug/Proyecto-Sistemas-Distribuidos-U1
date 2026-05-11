import logging
import threading
from datetime import datetime
from flask import Flask, jsonify
from flask_cors import CORS

from controllers.billingController import init_db
from routes.billingRoutes import billing_bp
from sockets.rabbitmqConsumer import start_consumer

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s [Billing] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

app.register_blueprint(billing_bp)

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'billing', 'ts': datetime.now().isoformat()})

if __name__ == '__main__':
    init_db()
    threading.Thread(target=start_consumer, daemon=True).start()
    logger.info('🚀 Billing Service corriendo en http://localhost:5001')
    app.run(host='0.0.0.0', port=5001, debug=False)
