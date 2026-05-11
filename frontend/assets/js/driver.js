// ─── Config ───────────────────────────────────────────────────────────────────
const TRACKING_URL = 'http://localhost:3000';

// Loja, Ecuador — ruta de simulación (más puntos = movimiento más detallado)
const LOJA_CENTER  = [-3.9931, -79.2042];
const DEMO_ROUTE   = [
  [-3.9870, -79.2070], // 🏪 Restaurante (origen)
  [-3.9876, -79.2066],
  [-3.9882, -79.2060],
  [-3.9888, -79.2056],
  [-3.9895, -79.2052],
  [-3.9900, -79.2048],
  [-3.9908, -79.2044],
  [-3.9913, -79.2041],
  [-3.9919, -79.2038],
  [-3.9924, -79.2035],
  [-3.9929, -79.2033],
  [-3.9933, -79.2030],
  [-3.9938, -79.2026],
  [-3.9942, -79.2023],
  [-3.9947, -79.2020],
  [-3.9951, -79.2017],
  [-3.9955, -79.2015],
  [-3.9957, -79.2013],
  [-3.9960, -79.2010], // 🏠 Destino (cliente)
];

// Velocidad: ms entre pasos durante la simulación
// ~2000ms × 19 pasos ≈ 38 segundos de entrega visible
const SIM_INTERVAL_MS = 2000;

// ─── State ────────────────────────────────────────────────────────────────────
let socket         = null;
let map            = null;
let driverMarker   = null;
let routeLine      = null;
let currentOrderId = null;
let simInterval    = null;
let simIndex       = 0;
let connected      = false;
let currentStatus  = 'Pendiente';
let simStartTime   = null;
let progressBar    = null;

// ─── Map Init ─────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView(LOJA_CENTER, 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  // Origin marker (restaurant)
  L.marker(DEMO_ROUTE[0], {
    icon: L.divIcon({
      className: '',
      html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">🏪</div>',
      iconAnchor: [14, 28]
    })
  }).addTo(map).bindPopup('🏪 Punto de recogida');

  // Destination marker
  L.marker(DEMO_ROUTE[DEMO_ROUTE.length - 1], {
    icon: L.divIcon({
      className: '',
      html: '<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))">🏠</div>',
      iconAnchor: [14, 28]
    })
  }).addTo(map).bindPopup('🏠 Destino del cliente');

  // Route line (full dashed)
  L.polyline(DEMO_ROUTE, {
    color: '#6C63FF', weight: 3, opacity: 0.4, dashArray: '8 6'
  }).addTo(map);

  // Traveled route line (starts empty, fills as driver moves)
  routeLine = L.polyline([], {
    color: '#00C896', weight: 4, opacity: 0.8
  }).addTo(map);

  // Place driver marker at start
  driverMarker = L.marker(DEMO_ROUTE[0], {
    icon: createDriverIcon()
  }).addTo(map).bindPopup('🚴 Repartidor');

  // Fit map to show full route
  map.fitBounds(L.latLngBounds(DEMO_ROUTE).pad(0.15));
}

function createDriverIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      font-size:32px;line-height:1;
      filter:drop-shadow(0 3px 8px rgba(0,0,0,.7));
      transition: all 0.4s ease;
    ">🚴</div>`,
    iconAnchor: [16, 32]
  });
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
function connectSocket() {
  socket = io(TRACKING_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    reconnectionAttempts: Infinity
  });

  socket.on('connect', () => {
    connected = true;
    setConnStatus('connected', `Conectado · ${socket.id.substring(0, 8)}`);
    addLog('Conectado al Tracking Server');
    if (currentOrderId) {
      socket.emit('join_order', { orderId: currentOrderId, role: 'repartidor' });
    }
  });

  socket.on('disconnect', () => {
    connected = false;
    setConnStatus('disconnected', 'Desconectado');
    addLog('Desconectado del servidor', '⚠️');
  });

  socket.on('connect_error', () => {
    setConnStatus('connecting', 'Reconectando...');
  });

  socket.on('order_info', (order) => {
    addLog(`Pedido #${order.id} cargado`, '✅');
    currentStatus = order.status || 'Pendiente';
    updateStatusButtons();
  });

  socket.on('peer_joined', ({ role }) => {
    if (role === 'cliente') {
      addLog('Cliente conectado al pedido', '📱');
      showToast('📱 El cliente está viendo tu ubicación', 'info');
    }
  });

  socket.on('event_published', ({ routingKey, published }) => {
    addLog(`RabbitMQ → ${routingKey} [${published ? '✅' : '⚠️'}]`, '🐇');
  });
}

// ─── Join Order ───────────────────────────────────────────────────────────────
async function joinOrder(orderId) {
  orderId = (orderId || '').trim().toUpperCase();
  if (!orderId || orderId.length < 4) {
    showToast('Ingresa un ID de pedido válido', 'error');
    return;
  }

  try {
    const res = await fetch(`${TRACKING_URL}/api/orders/${orderId}`);
    if (!res.ok) { showToast('Pedido no encontrado', 'error'); return; }
    const order = await res.json();

    currentOrderId = orderId;

    // Show panels
    document.getElementById('order-panel').style.display  = 'block';
    document.getElementById('gps-panel').style.display    = 'block';
    document.getElementById('status-panel').style.display = 'block';

    // Fill order info
    document.getElementById('oi-id').textContent       = order.id;
    document.getElementById('oi-customer').textContent  = order.customer_name;
    document.getElementById('oi-address').textContent   = order.address;
    updateBadge(order.status || 'Pendiente');

    currentStatus = order.status || 'Pendiente';
    updateStatusButtons();

    // Reset map
    resetMap();

    if (!socket || !socket.connected) connectSocket();
    else socket.emit('join_order', { orderId, role: 'repartidor' });

    addLog(`Unido al pedido #${orderId}`, '🔌');
    showToast(`Pedido #${orderId} listo`, 'success');
  } catch (err) {
    showToast('Error al conectar con el servidor', 'error');
    console.error(err);
  }
}

// ─── Map reset ────────────────────────────────────────────────────────────────
function resetMap() {
  simIndex = 0;
  if (routeLine) routeLine.setLatLngs([]);
  if (driverMarker) driverMarker.setLatLng(DEMO_ROUTE[0]);
  map.fitBounds(L.latLngBounds(DEMO_ROUTE).pad(0.15));
  updateProgressBar(0);
  document.getElementById('eta-display').textContent = calcETA(0);
}

// ─── GPS / Simulation ─────────────────────────────────────────────────────────
function startSimulation() {
  if (!currentOrderId) { showToast('Unéte a un pedido primero', 'error'); return; }
  if (simInterval) return;

  simIndex    = 0;
  simStartTime = Date.now();

  document.getElementById('btn-sim').style.display      = 'none';
  document.getElementById('btn-stop-sim').style.display = 'inline-flex';

  // Reset visual state
  routeLine.setLatLngs([]);
  driverMarker.setLatLng(DEMO_ROUTE[0]);
  updateProgressBar(0);

  addLog('Simulación de ruta iniciada', '▶');
  showToast('▶ Simulando entrega... (~' + calcETA(0) + ')', 'info');

  // ✅ Auto: cambiar a Recogiendo al arrancar
  if (currentStatus === 'Pendiente') {
    sendStatus('Recogiendo');
  }

  // Send first position immediately
  sendPosition(DEMO_ROUTE[0]);

  // Flag para emitir 'En camino' solo una vez
  let encaminoSent = false;
  const ENCAMINO_THRESHOLD = Math.floor(DEMO_ROUTE.length * 0.25); // ~25% de ruta

  simInterval = setInterval(() => {
    simIndex++;

    if (simIndex >= DEMO_ROUTE.length) {
      stopSimulation();
      addLog('¡Ruta completada! Pedido listo para marcar como entregado', '🏁');
      showToast('🏁 Ruta completada — marca como Entregado', 'success');
      // Resaltar botón Entregado
      const btnEntregado = document.getElementById('btn-entregado');
      if (btnEntregado) {
        btnEntregado.style.animation = 'pulse-green 1s ease-in-out infinite';
        btnEntregado.style.borderColor = 'var(--success)';
        btnEntregado.style.color = 'var(--success)';
      }
      // Auto-pan to destination
      map.setView(DEMO_ROUTE[DEMO_ROUTE.length - 1], 16, { animate: true });
      return;
    }


    sendPosition(DEMO_ROUTE[simIndex]);
    updateProgressBar(simIndex);

    // ✅ Auto: cambiar a En camino al superar el 25% de la ruta
    if (!encaminoSent && simIndex >= ENCAMINO_THRESHOLD && currentStatus === 'Recogiendo') {
      encaminoSent = true;
      sendStatus('En camino');
    }

    // Update ETA on every step
    const remaining = DEMO_ROUTE.length - 1 - simIndex;
    const etaSecs   = Math.ceil((remaining * SIM_INTERVAL_MS) / 1000);
    document.getElementById('eta-display').textContent = formatETA(etaSecs);

    // Add traveled segment to green line
    routeLine.setLatLngs(DEMO_ROUTE.slice(0, simIndex + 1));


  }, SIM_INTERVAL_MS);
}

function stopSimulation() {
  if (simInterval) { clearInterval(simInterval); simInterval = null; }
  document.getElementById('btn-sim').style.display      = 'inline-flex';
  document.getElementById('btn-stop-sim').style.display = 'none';
}

function useRealGPS() {
  if (!navigator.geolocation) {
    showToast('Geolocalización no disponible', 'error'); return;
  }
  navigator.geolocation.watchPosition(
    (pos) => sendPosition([pos.coords.latitude, pos.coords.longitude]),
    (err) => showToast(`GPS error: ${err.message}`, 'error'),
    { enableHighAccuracy: true, maximumAge: 2000 }
  );
  addLog('GPS real activado 📍', '📍');
  showToast('📍 GPS real activado', 'success');
}

function sendPosition([lat, lng]) {
  if (!socket || !socket.connected || !currentOrderId) return;
  socket.emit('location_update', { orderId: currentOrderId, lat, lng });

  // Smooth marker movement
  if (driverMarker) {
    driverMarker.setLatLng([lat, lng]);
  }
  map.panTo([lat, lng], { animate: true, duration: 0.8 });

  document.getElementById('gps-display').textContent =
    `📍 Lat: ${lat.toFixed(6)}  Lng: ${lng.toFixed(6)}`;
}

// ─── ETA helpers ──────────────────────────────────────────────────────────────
function calcETA(fromIndex) {
  const remaining = DEMO_ROUTE.length - 1 - fromIndex;
  const secs = Math.ceil((remaining * SIM_INTERVAL_MS) / 1000);
  return formatETA(secs);
}

function formatETA(seconds) {
  if (seconds <= 0) return '¡Llegó!';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function updateProgressBar(index) {
  const pct = Math.round((index / (DEMO_ROUTE.length - 1)) * 100);
  const bar   = document.getElementById('progress-fill');
  const label = document.getElementById('progress-label');
  if (bar)   bar.style.width = pct + '%';
  if (label) label.textContent = pct + '%';
}

// ─── Status Update ────────────────────────────────────────────────────────────
const STATUS_FLOW = ['Pendiente', 'Recogiendo', 'En camino', 'Entregado'];

function sendStatus(status) {
  if (!currentOrderId || !socket || !socket.connected) {
    showToast('Conéctate a un pedido primero', 'error'); return;
  }
  socket.emit('status_update', { orderId: currentOrderId, status });
  currentStatus = status;
  updateStatusButtons();
  updateBadge(status);
  addLog(`Estado → ${status}`, '📢');
  showToast(`Estado enviado: ${status}`, 'success');

  // Clear Entregado pulse animation if it was active
  if (status === 'Entregado') {
    const btnEntregado = document.getElementById('btn-entregado');
    if (btnEntregado) {
      btnEntregado.style.animation = '';
      btnEntregado.style.borderColor = '';
      btnEntregado.style.color = '';
    }
  }

  // If "En camino", auto-start simulation if not running
  if (status === 'En camino' && !simInterval) {
    setTimeout(startSimulation, 500);
  }
}


function updateStatusButtons() {
  const order = STATUS_FLOW.indexOf(currentStatus);
  document.getElementById('btn-recogiendo').disabled = order >= STATUS_FLOW.indexOf('Recogiendo');
  document.getElementById('btn-encamino').disabled   = order >= STATUS_FLOW.indexOf('En camino');
  document.getElementById('btn-entregado').disabled  = order >= STATUS_FLOW.indexOf('Entregado');

  if (currentStatus === 'Recogiendo') document.getElementById('btn-recogiendo').classList.add('active');
  if (currentStatus === 'En camino')  document.getElementById('btn-encamino').classList.add('active');
  if (currentStatus === 'Entregado')  document.getElementById('btn-entregado').classList.add('active');
}

function updateBadge(status) {
  const el  = document.getElementById('oi-status');
  const map = {
    'Pendiente':  'badge badge-pending',
    'Recogiendo': 'badge badge-picking',
    'En camino':  'badge badge-transit',
    'Entregado':  'badge badge-done',
  };
  el.className  = map[status] || 'badge badge-pending';
  el.textContent = status;
}

// ─── Activity Log ─────────────────────────────────────────────────────────────
function addLog(msg, icon = '📌') {
  const log  = document.getElementById('activity-log');
  const time = new Date().toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const el   = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `<span class="log-time">${time}</span><span>${icon} ${msg}</span>`;
  log.prepend(el);
  while (log.children.length > 30) log.removeChild(log.lastChild);
}

// ─── Connection Status ────────────────────────────────────────────────────────
function setConnStatus(state, label) {
  const dot = document.getElementById('conn-dot');
  dot.className = 'conn-dot ' + state;
  document.getElementById('conn-label').textContent = label;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons  = { success:'✅', info:'ℹ️', warning:'⚠️', error:'❌' };
  const titles = { success:'Éxito', info:'Info', warning:'Atención', error:'Error' };
  const cont   = document.getElementById('toast-container');
  const toast  = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div class="toast-body">
      <div class="toast-title">${titles[type] || type}</div>
      <div class="toast-msg">${message}</div>
    </div>`;
  cont.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
initMap();
