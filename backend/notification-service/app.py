# ─── MICROSERVICIO DE NOTIFICACIONES (NOTIFICATION SERVICE) ───
import logging
import threading
from datetime import datetime
from flask import Flask, jsonify
from flask_cors import CORS

from controllers.notificationController import init_db
from routes.notificationRoutes import notif_bp
from sockets.rabbitmqConsumer import start_consumer

# Configuración de logs para ver la actividad en consola
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s [Notif] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Inicialización de Flask
app = Flask(__name__)
# CORS es crucial aquí porque este servicio usa SSE (Server-Sent Events) para empujar datos al frontend web
CORS(app)

# Registramos las rutas de notificaciones (ej. /api/notifications/stream)
app.register_blueprint(notif_bp)

# Health Check
@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'notifications', 'ts': datetime.now().isoformat()})

if __name__ == '__main__':
    # Inicializa la BD local
    init_db()
    
    # Arranca el consumidor de RabbitMQ en segundo plano
    threading.Thread(target=start_consumer, daemon=True).start()
    
    logger.info('🚀 Notification Service corriendo en http://localhost:5002')
    
    # Arrancamos Flask. `threaded=True` es MUY importante porque permite mantener múltiples 
    # conexiones SSE abiertas simultáneamente sin bloquear el servidor.
    app.run(host='0.0.0.0', port=5002, debug=False, threaded=True)
