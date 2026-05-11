# ─── MICROSERVICIO DE FACTURACIÓN (BILLING SERVICE) ───
import logging
import threading
from datetime import datetime
from flask import Flask, jsonify
from flask_cors import CORS

from controllers.billingController import init_db
from routes.billingRoutes import billing_bp
from sockets.rabbitmqConsumer import start_consumer

# Configuración básica del sistema de logs (para ver en consola)
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s [Billing] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Inicializamos la aplicación web con Flask
app = Flask(__name__)
# Permitimos peticiones cruzadas (CORS) para que el Frontend pueda hacer consultas REST
CORS(app)

# Registramos las rutas de facturación (/api/invoices)
app.register_blueprint(billing_bp)

# Ruta de monitoreo de salud del microservicio
@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'billing', 'ts': datetime.now().isoformat()})

if __name__ == '__main__':
    # 1. Inicializamos la base de datos (SQLite) donde guardaremos las facturas
    init_db()
    
    # 2. Arrancamos el consumidor de RabbitMQ en un Hilo (Thread) separado.
    # Usamos daemon=True para que el hilo muera si se apaga el servidor principal.
    # Esto permite que Flask (la API HTTP) y el Consumidor (RabbitMQ) corran al mismo tiempo.
    threading.Thread(target=start_consumer, daemon=True).start()
    
    logger.info('🚀 Billing Service corriendo en http://localhost:5001')
    
    # 3. Arrancamos el servidor web Flask en el puerto 5001
    app.run(host='0.0.0.0', port=5001, debug=False)
