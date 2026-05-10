#!/usr/bin/env bash
# ╔══════════════════════════════════════╗
# ║  DeliveryTrack — Detener servicios   ║
# ╚══════════════════════════════════════╝

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS_FILE="$ROOT/.pids"

echo ""
echo "🛑 Deteniendo servicios DeliveryTrack..."

if [ -f "$PIDS_FILE" ]; then
  while IFS= read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && echo "  ✅ Proceso $pid detenido"
    fi
  done < "$PIDS_FILE"
  rm -f "$PIDS_FILE"
else
  echo "  ⚠️  No se encontró archivo de PIDs. Intentando por puerto..."
  for port in 3000 5001 5002 8080; do
    pid=$(lsof -ti tcp:$port 2>/dev/null)
    if [ -n "$pid" ]; then
      kill "$pid" && echo "  ✅ Puerto $port (PID=$pid) liberado"
    fi
  done
fi

echo "  ✅ Todos los servicios detenidos"
echo ""
