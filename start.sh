#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════╗
# ║   DeliveryTrack — Script de inicio (sin Docker)          ║
# ║   Sistemas Distribuidos Unidad I                         ║
# ╚══════════════════════════════════════════════════════════╝

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS_FILE="$ROOT/.pids"
LOG_DIR="$ROOT/logs"

mkdir -p "$LOG_DIR"
> "$PIDS_FILE"

echo ""
echo "🚀 DeliveryTrack — Iniciando servicios..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. RabbitMQ ──────────────────────────────────────────────
echo "🐇 Verificando RabbitMQ..."
if ! command -v rabbitmq-server &>/dev/null && ! systemctl is-active --quiet rabbitmq-server 2>/dev/null; then
  echo ""
  echo "  ⚠️  RabbitMQ no está instalado o no está corriendo."
  echo "  Instálalo con:"
  echo "    sudo apt-get update && sudo apt-get install -y rabbitmq-server"
  echo "    sudo systemctl enable --now rabbitmq-server"
  echo "  Luego vuelve a ejecutar este script."
  echo ""
  exit 1
fi

if ! systemctl is-active --quiet rabbitmq-server 2>/dev/null; then
  echo "  Iniciando RabbitMQ..."
  sudo systemctl start rabbitmq-server
fi
echo "  ✅ RabbitMQ activo"

# ── 2. Tracking Server (Node.js) ─────────────────────────────
echo ""
echo "🔌 Instalando dependencias del Tracking Server..."
cd "$ROOT/tracking-server"
npm install --silent
echo "  Iniciando Tracking Server en puerto 3000..."
node server.js > "$LOG_DIR/tracking.log" 2>&1 &
TRACKING_PID=$!
echo "$TRACKING_PID" >> "$PIDS_FILE"
echo "  ✅ Tracking Server PID=$TRACKING_PID"

# ── 3. Python venv ───────────────────────────────────────────
VENV="$ROOT/.venv"
if [ ! -d "$VENV" ]; then
  echo ""
  echo "🐍 Creando entorno virtual Python..."
  python3 -m venv "$VENV"
fi
source "$VENV/bin/activate"

# ── 4. Billing Service (Flask) ───────────────────────────────
echo ""
echo "🧾 Instalando dependencias del Billing Service..."
pip install -q -r "$ROOT/billing-service/requirements.txt"
echo "  Iniciando Billing Service en puerto 5001..."
cd "$ROOT/billing-service"
python app.py > "$LOG_DIR/billing.log" 2>&1 &
BILLING_PID=$!
echo "$BILLING_PID" >> "$PIDS_FILE"
echo "  ✅ Billing Service PID=$BILLING_PID"

# ── 5. Notification Service (Flask) ──────────────────────────
echo ""
echo "🔔 Instalando dependencias del Notification Service..."
pip install -q -r "$ROOT/notification-service/requirements.txt"
echo "  Iniciando Notification Service en puerto 5002..."
cd "$ROOT/notification-service"
python app.py > "$LOG_DIR/notification.log" 2>&1 &
NOTIF_PID=$!
echo "$NOTIF_PID" >> "$PIDS_FILE"
echo "  ✅ Notification Service PID=$NOTIF_PID"

# ── 6. Frontend HTTP Server ───────────────────────────────────
echo ""
echo "🌐 Iniciando servidor web del Frontend en puerto 8080..."
cd "$ROOT/frontend"
python3 -m http.server 8080 > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" >> "$PIDS_FILE"
echo "  ✅ Frontend PID=$FRONTEND_PID"

# ── Done ─────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Todos los servicios están corriendo"
echo ""
echo "  📱 Frontend:              http://localhost:8080"
echo "  🚀 Tracking Server:       http://localhost:3000"
echo "  🧾 Billing Service:       http://localhost:5001"
echo "  🔔 Notification Service:  http://localhost:5002"
echo "  🐇 RabbitMQ Management:   http://localhost:15672 (guest/guest)"
echo ""
echo "  📄 Logs en: $LOG_DIR/"
echo "  🛑 Para detener: ./stop.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
