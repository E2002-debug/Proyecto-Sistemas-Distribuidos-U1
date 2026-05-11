// ─── Config ───────────────────────────────────────────────────────────────────
const TRACKING_URL  = 'http://localhost:3000';
const NOTIF_URL     = 'http://localhost:5002';

// Loja, Ecuador — ruta de simulación por el centro
const LOJA_CENTER   = [-3.9931, -79.2042];
const DEMO_ROUTE = [
  [-3.9870, -79.2070], // Restaurante (origen)
  [-3.9882, -79.2060],
  [-3.9895, -79.2052],
  [-3.9908, -79.2044],
  [-3.9919, -79.2038],
  [-3.9929, -79.2033],
  [-3.9938, -79.2026],
  [-3.9947, -79.2020],
  [-3.9955, -79.2015],
  [-3.9960, -79.2010], // Destino (cliente)
];

// ─── State ────────────────────────────────────────────────────────────────────
let socket      = null;
let map         = null;
let driverMarker = null;
let routePolyline= null;
let currentOrderId = null;
let simInterval = null;
let simIndex    = 0;
let sseSource   = null;

// ─── Map Init ─────────────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView(LOJA_CENTER, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  // Destination marker
  L.marker(DEMO_ROUTE[DEMO_ROUTE.length - 1], {
    icon: L.divIcon({ className:'', html:'<div style="font-size:28px;line-height:1">🏠</div>', iconAnchor:[14,28] })
  }).addTo(map).bindPopup('📍 Dirección de entrega');

  // Route preview
  routePolyline = L.polyline(DEMO_ROUTE, { color:'#6C63FF', weight:3, opacity:0.5, dashArray:'8 6' }).addTo(map);
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
function connectSocket() {
  socket = io(TRACKING_URL, { transports: ['websocket'] });

  socket.on('connect', () => {
    setConnStatus('connected', `Conectado · ${socket.id.substring(0,8)}`);
    if (currentOrderId) socket.emit('join_order', { orderId: currentOrderId, role: 'cliente' });
  });

  socket.on('disconnect', () => setConnStatus('disconnected', 'Desconectado'));
  socket.on('connect_error', () => setConnStatus('connecting', 'Reconectando...'));

  // Order info from server
  socket.on('order_info', (order) => {
    showOrderPanel(order);
    log(`Pedido #${order.id} conectado`, 'ℹ️');
  });

  // Real-time location update
  socket.on('location_update', ({ lat, lng, timestamp }) => {
    updateDriverMarker(lat, lng);
    document.getElementById('coords-display').textContent =
      `📍 Lat: ${lat.toFixed(6)}  Lng: ${lng.toFixed(6)}`;
    updateETA(lat, lng);
  });

  // Status update from driver
  socket.on('status_update', ({ status, timestamp }) => {
    updateTimeline(status, timestamp);
    showToast(getStatusMessage(status), getStatusType(status));
  });

  socket.on('peer_joined', ({ role }) => {
    if (role === 'repartidor') showToast('🚴 Tu repartidor se ha conectado', 'info');
  });
}

// ─── Track Order ──────────────────────────────────────────────────────────────
async function trackOrder() {
  const input = document.getElementById('order-id-input');
  const orderId = input.value.trim().toUpperCase();
  if (!orderId || orderId.length < 4) {
    showToast('Por favor ingresa un ID de pedido válido', 'error');
    return;
  }

  // Verify order exists
  try {
    const res = await fetch(`${TRACKING_URL}/api/orders/${orderId}`);
    if (!res.ok) { showToast('❌ Pedido no encontrado', 'error'); return; }
    const order = await res.json();
    currentOrderId = orderId;
    showOrderPanel(order);
    document.getElementById('order-panel').style.display = 'block';
    document.getElementById('timeline-panel').style.display = 'block';
    document.getElementById('notif-panel').style.display = 'block';

    if (!socket || !socket.connected) connectSocket();
    else socket.emit('join_order', { orderId, role: 'cliente' });

    subscribeSSE(orderId);
    log(`Siguiendo pedido #${orderId}`, '📡');
    showToast(`Siguiendo pedido #${orderId}`, 'success');
  } catch (err) {
    showToast('Error al conectar con el servidor', 'error');
    console.error(err);
  }
}

// ─── SSE Notifications ────────────────────────────────────────────────────────
function subscribeSSE(orderId) {
  if (sseSource) sseSource.close();
  sseSource = new EventSource(`${NOTIF_URL}/api/notifications/stream?order_id=${orderId}`);

  sseSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'connected') return;
    addNotification(data);
  };

  sseSource.onerror = () => {
    console.warn('[SSE] Reconectando...');
  };
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function showOrderPanel(order) {
  document.getElementById('oi-id').textContent      = order.id;
  document.getElementById('oi-driver').textContent  = order.delivery_person_name || '—';
  document.getElementById('oi-address').textContent = order.address;
  document.getElementById('order-panel').style.display    = 'block';
  document.getElementById('timeline-panel').style.display = 'block';
  document.getElementById('notif-panel').style.display    = 'block';

  // Set confirmed time
  document.getElementById('time-pendiente').textContent = fmtTime(order.created_at);
  document.getElementById('dot-pendiente').classList.add('done');

  // If order already has a non-pending status, restore full timeline
  if (order.status && order.status !== 'Pendiente') {
    updateTimeline(order.status, order.updated_at);
  }

  // If already delivered, show Llegó immediately
  if (order.status === 'Entregado') {
    const etaEl = document.getElementById('eta-value');
    etaEl.textContent = '\u00a1Lleg\u00f3!';
    etaEl.style.fontSize = '1.4rem';
  }

  // Load historical notifications from notification-service
  loadHistoricalNotifications(order.id);
}

async function loadHistoricalNotifications(orderId) {
  try {
    const res = await fetch(`${NOTIF_URL}/api/notifications?order_id=${orderId}`);
    if (!res.ok) return;
    const notifications = await res.json();
    // Show oldest first (array comes DESC, so reverse)
    notifications.reverse().forEach(n => {
      addNotification({
        message:   n.message,
        type:      n.type,
        timestamp: n.created_at
      });
    });
  } catch (err) {
    console.warn('[Client] No se pudo cargar historial de notificaciones:', err);
  }
}

function updateDriverMarker(lat, lng) {
  if (!driverMarker) {
    driverMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="font-size:32px;line-height:1;filter:drop-shadow(0 3px 8px rgba(0,0,0,.6))">🚴</div>',
        iconAnchor: [16, 32]
      })
    }).addTo(map).bindPopup('🚴 Repartidor en camino');

    // Draw traveled route trail
    window._trailLine = L.polyline([[lat, lng]], {
      color: '#00C896', weight: 4, opacity: 0.7
    }).addTo(map);
  } else {
    driverMarker.setLatLng([lat, lng]);
    if (window._trailLine) {
      window._trailLine.addLatLng([lat, lng]);
    }
  }
  map.panTo([lat, lng], { animate: true, duration: 1.2 });
}

function updateETA(lat, lng) {
  const dest    = DEMO_ROUTE[DEMO_ROUTE.length - 1];
  const distM   = map.distance([lat, lng], dest); // metros
  // Cycling speed ~200m/min = 3.33 m/s
  const etaSecs = Math.ceil(distM / 3.33);
  const etaEl   = document.getElementById('eta-value');
  if (!etaEl) return;

  if (distM < 20) {
    etaEl.textContent = '¡Llegó!';
    etaEl.style.fontSize = '1.4rem';
    return;
  }

  const m = Math.floor(etaSecs / 60);
  const s = etaSecs % 60;
  etaEl.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const STATUS_ORDER = ['Pendiente','Recogiendo','En camino','Entregado'];
const STATUS_DOTS  = {
  'Recogiendo': 'recogiendo',
  'En camino':  'encamino',
  'Entregado':  'entregado',
};

function updateTimeline(status, ts) {
  const key = STATUS_DOTS[status];
  if (!key) return;

  const idx = STATUS_ORDER.indexOf(status);

  // Mark all steps UP TO current as done
  STATUS_ORDER.slice(1, idx + 1).forEach((s, i) => {
    const k = STATUS_DOTS[s];
    if (!k) return;
    const dot  = document.getElementById(`dot-${k}`);
    const time = document.getElementById(`time-${k}`);
    if (dot) {
      dot.classList.remove('active');
      dot.classList.add('done');
    }
    // Only set the timestamp for the CURRENT step (the others we don't have exact timestamps)
    if (s === status && time) {
      time.textContent = fmtTime(ts);
    } else if (time && time.textContent === '—') {
      // Leave blank — will be filled by SSE or historical notifs
      time.textContent = '—';
    }
  });

  // Show toast & handle delivery
  if (status === 'Entregado') {
    const etaEl = document.getElementById('eta-value');
    etaEl.textContent  = '\u00a1Lleg\u00f3!';
    etaEl.style.fontSize = '1.4rem';
    showToast('\uD83C\uDF89 \u00a1Tu pedido ha llegado!', 'success');
  } else {
    showToast(getStatusMessage(status), getStatusType(status));
  }
}

function addNotification(notif) {
  const list = document.getElementById('notif-list');
  // Remove placeholder
  const placeholder = list.querySelector('[style*="color:var(--text-muted)"]');
  if (placeholder) placeholder.remove();

  const el = document.createElement('div');
  el.className = `notif-item ${notif.type || 'info'}`;
  el.innerHTML = `
    <span class="notif-msg">${notif.message}</span>
    <span class="notif-time">${fmtTime(notif.timestamp)}</span>
  `;
  list.prepend(el);

  // Sync timeline timestamps from notification status field
  const STATUS_TO_DOT = {
    'recogiendo': 'recogiendo',
    'en_camino':  'encamino',
    'entregado':  'entregado',
  };
  if (notif.status) {
    const k = STATUS_TO_DOT[notif.status];
    if (k) {
      const timeEl = document.getElementById(`time-${k}`);
      if (timeEl && timeEl.textContent === '—') {
        timeEl.textContent = fmtTime(notif.timestamp);
      }
    }
  }
}


function getStatusMessage(status) {
  const map = {
    'Recogiendo': '🏪 El repartidor está recogiendo tu pedido',
    'En camino':  '🚴 Tu repartidor está en camino',
    'Entregado':  '✅ ¡Pedido entregado!',
  };
  return map[status] || `Estado: ${status}`;
}
function getStatusType(status) {
  return { 'Recogiendo':'warning', 'En camino':'info', 'Entregado':'success' }[status] || 'info';
}

function setConnStatus(state, label) {
  const dot = document.getElementById('conn-dot');
  dot.className = 'conn-dot ' + state;
  document.getElementById('conn-label').textContent = label;
}

function log(msg, icon='📌') {
  console.log(`${icon} ${msg}`);
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('es-EC', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  } catch { return iso; }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = { success:'✅', info:'ℹ️', warning:'⚠️', error:'❌' };
  const titles = { success:'Éxito', info:'Información', warning:'Atención', error:'Error' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${icons[type]||'ℹ️'}</div>
    <div class="toast-body">
      <div class="toast-title">${titles[type]||'Info'}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
initMap();
