import logging
import threading
from datetime import datetime
from flask import Flask, jsonify
from flask_cors import CORS

from controllers.notificationController import init_db
from routes.notificationRoutes import notif_bp
from sockets.rabbitmqConsumer import start_consumer

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s [Notif] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

app.register_blueprint(notif_bp)

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'notifications', 'ts': datetime.now().isoformat()})

if __name__ == '__main__':
    init_db()
    threading.Thread(target=start_consumer, daemon=True).start()
    logger.info('🚀 Notification Service corriendo en http://localhost:5002')
    app.run(host='0.0.0.0', port=5002, debug=False, threaded=True)
