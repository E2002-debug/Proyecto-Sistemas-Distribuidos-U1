# 🚀 DeliveryTrack — Sistema de Delivery Distribuido

> **Sistemas Distribuidos Unidad I**  
> Lisbeth Cale · David Guaman · Stiven Jimenez · Santiago Jiménez

Sistema de microservicios para seguimiento de repartidores en **tiempo real** en Loja, Ecuador. Usa **WebSockets (Socket.IO)** para comunicación sincrónica y **RabbitMQ** para propagación asíncrona de eventos.

---

## 🏗️ Arquitectura

```
Frontend (HTML/JS/Leaflet)
      │ Socket.IO (WebSocket)
      ▼
Tracking Server (Node.js + Express)  ──→  RabbitMQ (topic exchange)
      │                                        │              │
      │ SQLite                         billing_queue   notification_queue
      │                                        │              │
      ▼                                        ▼              ▼
  tracking.db                          Billing Service  Notification Service
                                        (Flask/SQLite)   (Flask/SQLite + SSE)
```

| Servicio | Tecnología | Puerto |
|---|---|---|
| Tracking Server | Node.js + Socket.IO | 3000 |
| Billing Service | Flask + pika | 5001 |
| Notification Service | Flask + pika + SSE | 5002 |
| Frontend | HTML/CSS/JS + Leaflet.js | 8080 |
| RabbitMQ | AMQP broker | 5672 / 15672 |

---

## 📁 Estructura

```
Proyecto-Sistemas-Distribuidos-U1/
├── start.sh                    # Inicia todos los servicios
├── stop.sh                     # Detiene todos los servicios
│
├── tracking-server/            # Node.js + Socket.IO
│   ├── server.js
│   ├── package.json
│   └── db/database.js          # SQLite (tracking.db)
│
├── billing-service/            # Flask Python
│   ├── app.py                  # Consumer RabbitMQ + REST API
│   └── requirements.txt
│
├── notification-service/       # Flask Python
│   ├── app.py                  # Consumer + SSE push
│   └── requirements.txt
│
└── frontend/
    ├── index.html              # Landing page
    ├── client.html             # App cliente (mapa + timeline)
    ├── driver.html             # App repartidor (GPS + estados)
    └── assets/
        ├── css/style.css
        └── js/
            ├── client.js
            └── driver.js
```

---

## ⚡ Instalación y Ejecución

### Prerequisitos

```bash
# Node.js (v18+)
node --version

# Python 3
python3 --version

# RabbitMQ
sudo apt-get update && sudo apt-get install -y rabbitmq-server
sudo systemctl enable --now rabbitmq-server

# Activar plugin de management (panel web)
sudo rabbitmq-plugins enable rabbitmq_management
```

### Iniciar el sistema

```bash
cd Proyecto-Sistemas-Distribuidos-U1
./start.sh
```

### Detener el sistema

```bash
./stop.sh
```

---

## 🎮 Flujo de Demostración

1. Abre el **panel de administración RabbitMQ**: http://localhost:15672 (usuario: `guest`, contraseña: `guest`)

2. **Crear un pedido** (vía API o directamente en la app):
   ```bash
   curl -X POST http://localhost:3000/api/orders \
     -H "Content-Type: application/json" \
     -d '{"customerName":"Ana Torres","address":"Av. Universitaria 123, Loja","deliveryPersonName":"Carlos López"}'
   ```
   Guarda el `orderId` devuelto (ej: `A1B2C3D4`).

3. Abre **dos ventanas del browser**:
   - Ventana 1: http://localhost:8080/client.html → ingresa el `orderId` → clic en **Seguir**
   - Ventana 2: http://localhost:8080/driver.html → ingresa el mismo `orderId` → clic en **Unirse**

4. En la **App Repartidor**:
   - Clic en **▶ Simular Ruta** → el marcador 🚴 se mueve por Loja en tiempo real
   - Clic en **Recogiendo** → evento publicado en RabbitMQ
   - Clic en **En camino** → evento publicado en RabbitMQ
   - Clic en **Entregado** → factura generada en Billing Service + notificación vía SSE

5. Verifica los datos:
   ```bash
   # Facturas generadas
   curl http://localhost:5001/api/invoices

   # Notificaciones
   curl http://localhost:5002/api/notifications
   
   # Historial de ubicaciones
   curl http://localhost:3000/api/orders/A1B2C3D4/history
   ```

---

## 📡 API Reference

### Tracking Server (`:3000`)

| Método | Endpoint | Descripción |
|---|---|---|
| POST | `/api/orders` | Crear nuevo pedido |
| GET | `/api/orders` | Listar todos los pedidos |
| GET | `/api/orders/:id` | Obtener pedido por ID |
| GET | `/api/orders/:id/history` | Historial de ubicaciones |
| GET | `/health` | Estado del servicio |

### Socket.IO Events

| Evento | Dirección | Payload |
|---|---|---|
| `join_order` | client → server | `{ orderId, role }` |
| `location_update` | driver → server | `{ orderId, lat, lng }` |
| `status_update` | driver → server | `{ orderId, status }` |
| `location_update` | server → client | `{ lat, lng, timestamp }` |
| `status_update` | server → client | `{ status, timestamp }` |

### RabbitMQ Exchange

- **Exchange**: `delivery_events` (type: `topic`)
- **Routing keys**: `delivery.estado.recogiendo`, `delivery.estado.en_camino`, `delivery.estado.entregado`
- **Colas**: `billing_queue`, `notification_queue`
- **DLQ**: `delivery_dead_letter` (tras 3 reintentos: 2s → 4s → 8s)

---

## 🧪 Verificación

```bash
# Health checks
curl http://localhost:3000/health
curl http://localhost:5001/health
curl http://localhost:5002/health

# Logs en tiempo real
tail -f logs/tracking.log
tail -f logs/billing.log
tail -f logs/notification.log
```
