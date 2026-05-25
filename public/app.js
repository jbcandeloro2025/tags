/**
 * ============================================================
 * TAGS TRACKER - Frontend Application
 * ============================================================
 * Lógica do mapa, requisições à API e manipulação de DOM.
 * Tecnologias: Leaflet.js, Vanilla JS ES6+
 * ============================================================
 */

'use strict';

// ─── Configuração Global ──────────────────────────────────────────────────────

const CONFIG = {
  // Intervalo de atualização automática (ms)
  POLL_INTERVAL: 30_000,

  // Número de pontos de histórico a buscar
  HISTORY_LIMIT: 100,

  // Centro padrão do mapa (Brasil)
  DEFAULT_CENTER: [-15.7942, -47.8822],
  DEFAULT_ZOOM: 5,

  // Endpoints da API
  API: {
    LATEST: '/api/location/latest',
    HISTORY: '/api/location/history',
    CLEAR: '/api/location/clear',
    HEALTH: '/api/health',
    STATS: '/api/stats',
  },

  // Paleta de cores para os dispositivos
  DEVICE_COLORS: [
    '#10b981', // emerald
    '#06b6d4', // cyan
    '#8b5cf6', // violet
    '#f59e0b', // amber
    '#ef4444', // red
    '#ec4899', // pink
    '#3b82f6', // blue
    '#84cc16', // lime
    '#f97316', // orange
    '#14b8a6', // teal
  ],
};

// ─── Estado da Aplicação ──────────────────────────────────────────────────────

const state = {
  // Instância do mapa Leaflet
  map: null,

  // Camada de tiles
  tileLayer: null,

  // Marcadores no mapa { device_name: L.Marker }
  markers: {},

  // Linhas de histórico { device_name: L.Polyline }
  polylines: {},

  // Dados dos dispositivos { device_name: locationObject }
  devices: {},

  // Dispositivo atualmente selecionado
  selectedDevice: null,

  // Mapa de cores por dispositivo { device_name: colorString }
  deviceColors: {},

  // Contador de dispositivos (para atribuir cor ciclicamente)
  colorIndex: 0,

  // Timer do polling
  pollTimer: null,

  // Se o mapa foi centrado automaticamente pela primeira vez
  initialFitDone: false,

  // Se a rota está sendo exibida
  routeVisible: true,
};

// ─── Utilitários ──────────────────────────────────────────────────────────────

/**
 * Formata a diferença de tempo de forma legível.
 * Ex: "Há 2 min", "Há 5 h", "Agora"
 */
function timeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return 'Agora';
  if (diffSec < 60) return `Há ${diffSec}s`;
  if (diffMin < 60) return `Há ${diffMin} min`;
  if (diffHour < 24) return `Há ${diffHour}h`;
  return `Há ${diffDay}d`;
}

/**
 * Formata data/hora completa para exibição.
 */
function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Retorna uma cor para o dispositivo (cíclica).
 */
function getDeviceColor(deviceName) {
  if (!state.deviceColors[deviceName]) {
    state.deviceColors[deviceName] = CONFIG.DEVICE_COLORS[state.colorIndex % CONFIG.DEVICE_COLORS.length];
    state.colorIndex++;
  }
  return state.deviceColors[deviceName];
}

/**
 * Gera o HTML do ícone de marcador customizado.
 */
function createMarkerIcon(color) {
  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div class="marker-pulse" style="background: ${color}20; border: 2px solid ${color}60;"></div>
      <div class="marker-pin" style="background: ${color};">
        <div class="marker-pin-inner"></div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 40],
    popupAnchor: [0, -42],
  });
}

/**
 * Gera o HTML interno do popup de um marcador.
 */
function createPopupContent(location, color) {
  const batteryHtml = location.battery_level !== null && location.battery_level !== undefined
    ? `
      <div class="tracker-popup-row">
        <span class="tracker-popup-label">Bateria</span>
        <span class="tracker-popup-value tracker-popup-battery">
          <div class="battery-bar">
            <div class="battery-fill" style="
              width: ${location.battery_level}%;
              background: ${location.battery_level > 50 ? '#10b981' : location.battery_level > 20 ? '#f59e0b' : '#ef4444'};
            "></div>
          </div>
          ${location.battery_level}%
        </span>
      </div>
    `
    : '';

  return `
    <div class="tracker-popup">
      <div class="tracker-popup-header">
        <div class="tracker-popup-color-dot" style="background: ${color};"></div>
        <span class="tracker-popup-device-name">${escapeHtml(location.device_name)}</span>
      </div>
      <div class="tracker-popup-row">
        <span class="tracker-popup-label">Latitude</span>
        <span class="tracker-popup-value">${location.latitude.toFixed(6)}</span>
      </div>
      <div class="tracker-popup-row">
        <span class="tracker-popup-label">Longitude</span>
        <span class="tracker-popup-value">${location.longitude.toFixed(6)}</span>
      </div>
      ${batteryHtml}
      <div class="tracker-popup-row">
        <span class="tracker-popup-label">Captura</span>
        <span class="tracker-popup-value" style="font-family: 'Inter', sans-serif; font-size: 10px;">
          ${formatDateTime(location.created_at)}
        </span>
      </div>
    </div>
  `;
}

/**
 * Escapa caracteres HTML para prevenir XSS.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}

/**
 * Formata coordenadas para exibição.
 */
function formatCoord(value) {
  return parseFloat(value).toFixed(6);
}

// ─── Sistema de Toast Notifications ──────────────────────────────────────────

const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
  },

  show(message, type = 'info', duration = 4000) {
    if (!this.container) return;

    const icons = {
      success: `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`,
      error: `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>`,
      info: `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`,
      warning: `<svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>`,
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;

    this.container.appendChild(toast);

    // Remove após a duração
    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  },
};

// ─── Modal de Confirmação ─────────────────────────────────────────────────────

const Modal = {
  el: null,
  backdrop: null,
  confirmBtn: null,
  cancelBtn: null,
  tokenInput: null,
  errorEl: null,
  onConfirm: null,

  init() {
    this.el = document.getElementById('modal-clear');
    this.backdrop = document.getElementById('modal-backdrop');
    this.confirmBtn = document.getElementById('modal-confirm-btn');
    this.cancelBtn = document.getElementById('modal-cancel-btn');
    this.tokenInput = document.getElementById('modal-token-input');
    this.errorEl = document.getElementById('modal-error');

    this.cancelBtn.addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());

    this.confirmBtn.addEventListener('click', () => {
      const token = this.tokenInput.value.trim();
      if (!token) {
        this.showError('Informe o token de autenticação.');
        return;
      }
      this.onConfirm && this.onConfirm(token);
    });

    // Fecha com ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.classList.contains('hidden')) {
        this.close();
      }
    });
  },

  open(onConfirm) {
    this.onConfirm = onConfirm;
    this.tokenInput.value = '';
    this.hideError();
    this.el.classList.remove('hidden');
    setTimeout(() => this.tokenInput.focus(), 100);
  },

  close() {
    this.el.classList.add('hidden');
    this.onConfirm = null;
  },

  showError(msg) {
    this.errorEl.textContent = msg;
    this.errorEl.classList.remove('hidden');
  },

  hideError() {
    this.errorEl.classList.add('hidden');
    this.errorEl.textContent = '';
  },

  setLoading(loading) {
    this.confirmBtn.disabled = loading;
    this.cancelBtn.disabled = loading;
    this.confirmBtn.innerHTML = loading
      ? `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Limpando...`
      : `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg> Confirmar`;
  },
};

// ─── Mapa Leaflet ──────────────────────────────────────────────────────────────

const MapManager = {
  /**
   * Inicializa o mapa Leaflet com o tile layer do OpenStreetMap.
   */
  init() {
    // Cria o mapa
    state.map = L.map('map', {
      center: CONFIG.DEFAULT_CENTER,
      zoom: CONFIG.DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });

    // Adiciona controle de zoom em posição customizada
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    // Tile layer OpenStreetMap (gratuito, sem API key)
    state.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      minZoom: 2,
    }).addTo(state.map);

    // Oculta overlay de carregamento após o primeiro tile
    state.tileLayer.once('load', () => {
      const overlay = document.getElementById('map-loading');
      if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        setTimeout(() => overlay.style.display = 'none', 600);
      }
    });

    // Também remove o overlay após 3s (fallback)
    setTimeout(() => {
      const overlay = document.getElementById('map-loading');
      if (overlay && overlay.style.display !== 'none') {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        setTimeout(() => overlay.style.display = 'none', 600);
      }
    }, 3000);
  },

  /**
   * Adiciona ou atualiza um marcador no mapa.
   */
  upsertMarker(location) {
    const { device_name, latitude, longitude } = location;
    const color = getDeviceColor(device_name);
    const latlng = L.latLng(latitude, longitude);
    const icon = createMarkerIcon(color);
    const popupContent = createPopupContent(location, color);

    if (state.markers[device_name]) {
      // Atualiza marcador existente com animação suave
      const marker = state.markers[device_name];
      marker.setLatLng(latlng);
      marker.setIcon(icon);
      marker.setPopupContent(popupContent);
    } else {
      // Cria novo marcador
      const marker = L.marker(latlng, { icon })
        .bindPopup(popupContent, {
          maxWidth: 280,
          minWidth: 200,
        })
        .addTo(state.map);

      // Ao clicar no marcador, seleciona o dispositivo
      marker.on('click', () => {
        DeviceList.selectDevice(device_name);
      });

      state.markers[device_name] = marker;
    }
  },

  /**
   * Remove um marcador do mapa.
   */
  removeMarker(deviceName) {
    if (state.markers[deviceName]) {
      state.map.removeLayer(state.markers[deviceName]);
      delete state.markers[deviceName];
    }
  },

  /**
   * Desenha a polilinha de histórico para um dispositivo.
   */
  drawPolyline(deviceName, historyPoints, color) {
    // Remove polilinha anterior
    this.clearPolyline(deviceName);

    if (historyPoints.length < 2) return;

    // Ordena do mais antigo para o mais recente
    const sorted = [...historyPoints].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    const latlngs = sorted.map((p) => [p.latitude, p.longitude]);

    // Linha da rota com gradiente visual (linha decorativa mais grossa)
    const polylineDecor = L.polyline(latlngs, {
      color: color,
      weight: 6,
      opacity: 0.15,
      smoothFactor: 1.5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(state.map);

    // Linha principal
    const polyline = L.polyline(latlngs, {
      color: color,
      weight: 2.5,
      opacity: 0.85,
      dashArray: null,
      smoothFactor: 1.5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(state.map);

    // Marcadores de pontos de passagem (círculos menores)
    const waypointMarkers = [];
    sorted.forEach((point, i) => {
      // Mostra apenas alguns pontos intermediários para não poluir
      if (i === 0 || i === sorted.length - 1 || (sorted.length > 5 && i % Math.ceil(sorted.length / 10) === 0)) {
        const circle = L.circleMarker([point.latitude, point.longitude], {
          radius: i === sorted.length - 1 ? 0 : 4, // Não mostra círculo no último (tem marcador principal)
          fillColor: color,
          fillOpacity: 0.7,
          color: 'rgba(255,255,255,0.5)',
          weight: 1,
        });

        if (i !== sorted.length - 1) {
          circle.bindTooltip(`
            <div style="font-family: Inter, sans-serif; font-size: 11px; color: #cbd5e1; background: rgba(15,23,42,0.95); border: 1px solid rgba(71,85,105,0.5); border-radius: 8px; padding: 6px 10px;">
              <div style="color: ${color}; font-weight: 600; margin-bottom: 3px;">${escapeHtml(point.device_name)}</div>
              <div>${formatDateTime(point.created_at)}</div>
              <div style="font-family: JetBrains Mono, monospace; color: #94a3b8; margin-top: 2px;">${formatCoord(point.latitude)}, ${formatCoord(point.longitude)}</div>
            </div>
          `, { className: 'tracker-tooltip', direction: 'top' });
          circle.addTo(state.map);
          waypointMarkers.push(circle);
        }
      }
    });

    // Armazena referências para remoção posterior
    state.polylines[deviceName] = {
      main: polyline,
      decor: polylineDecor,
      waypoints: waypointMarkers,
    };
  },

  /**
   * Remove a polilinha de histórico de um dispositivo.
   */
  clearPolyline(deviceName) {
    if (state.polylines[deviceName]) {
      const { main, decor, waypoints } = state.polylines[deviceName];
      if (main) state.map.removeLayer(main);
      if (decor) state.map.removeLayer(decor);
      if (waypoints) waypoints.forEach((m) => state.map.removeLayer(m));
      delete state.polylines[deviceName];
    }
  },

  /**
   * Centraliza o mapa em todos os dispositivos ativos.
   */
  fitAllDevices() {
    const deviceList = Object.values(state.devices);
    if (deviceList.length === 0) return;

    if (deviceList.length === 1) {
      const d = deviceList[0];
      state.map.setView([d.latitude, d.longitude], 14, { animate: true, duration: 1 });
      return;
    }

    const latlngs = deviceList.map((d) => [d.latitude, d.longitude]);
    const bounds = L.latLngBounds(latlngs).pad(0.2);
    state.map.fitBounds(bounds, { animate: true, duration: 1 });
  },
};

// ─── Lista de Dispositivos (Sidebar) ──────────────────────────────────────────

const DeviceList = {
  listEl: null,
  searchEl: null,
  countBadge: null,
  searchQuery: '',

  init() {
    this.listEl = document.getElementById('device-list');
    this.searchEl = document.getElementById('device-search');
    this.countBadge = document.getElementById('device-count-badge');

    this.searchEl.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.render();
    });
  },

  /**
   * Renderiza a lista de dispositivos.
   */
  render() {
    const devices = Object.values(state.devices);

    // Remove skeleton
    const skeleton = this.listEl.querySelector('.device-skeleton');
    if (skeleton) skeleton.remove();

    // Filtra pela busca
    const filtered = this.searchQuery
      ? devices.filter((d) => d.device_name.toLowerCase().includes(this.searchQuery))
      : devices;

    // Ordena por mais recente primeiro
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Atualiza o badge de contagem
    this.countBadge.textContent = devices.length;

    if (filtered.length === 0) {
      this.listEl.innerHTML = `
        <div class="py-8 text-center text-slate-500 text-sm">
          ${this.searchQuery ? 'Nenhum dispositivo encontrado.' : 'Aguardando dados...'}
        </div>
      `;
      return;
    }

    // Renderiza cada dispositivo
    this.listEl.innerHTML = '';
    filtered.forEach((device) => {
      const el = this.createDeviceItem(device);
      this.listEl.appendChild(el);
    });
  },

  /**
   * Cria o elemento HTML de um item de dispositivo.
   */
  createDeviceItem(location) {
    const color = getDeviceColor(location.device_name);
    const isActive = state.selectedDevice === location.device_name;

    const item = document.createElement('div');
    item.className = `device-item${isActive ? ' active' : ''}`;
    item.style.setProperty('--device-color', color);
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Dispositivo ${location.device_name}`);
    item.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    item.dataset.device = location.device_name;

    // Barra de cor lateral
    item.style.cssText += ``;
    const colorBar = document.createElement('div');
    colorBar.style.cssText = `
      position: absolute; left: 0; top: 6px; bottom: 6px;
      width: 3px; border-radius: 999px; background: ${color};
      opacity: ${isActive ? 1 : 0};
      transition: opacity 0.2s;
    `;
    item.appendChild(colorBar);

    // Bateria
    const batteryHtml = location.battery_level !== null && location.battery_level !== undefined
      ? `
        <span class="device-item-battery">
          <svg class="w-3 h-3" style="color: ${location.battery_level > 50 ? '#10b981' : location.battery_level > 20 ? '#f59e0b' : '#ef4444'}" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/>
          </svg>
          <span style="color: ${location.battery_level > 50 ? '#10b981' : location.battery_level > 20 ? '#f59e0b' : '#ef4444'}">${location.battery_level}%</span>
        </span>
      `
      : '<span class="device-item-time" style="font-size:10px;">Bat: N/A</span>';

    item.innerHTML += `
      <div class="device-item-header" style="padding-left: 10px;">
        <div class="device-item-color" style="background: ${color};"></div>
        <span class="device-item-name">${escapeHtml(location.device_name)}</span>
      </div>
      <div class="device-item-footer" style="padding-left: 10px;">
        <span class="device-item-time">${timeAgo(location.created_at)}</span>
        ${batteryHtml}
      </div>
    `;

    // Eventos
    item.addEventListener('click', () => this.selectDevice(location.device_name));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.selectDevice(location.device_name);
      }
    });

    // Hover effect
    item.addEventListener('mouseenter', () => {
      colorBar.style.opacity = '0.5';
    });
    item.addEventListener('mouseleave', () => {
      if (!item.classList.contains('active')) {
        colorBar.style.opacity = '0';
      }
    });

    return item;
  },

  /**
   * Seleciona um dispositivo: centraliza o mapa e carrega histórico.
   */
  async selectDevice(deviceName) {
    const wasSelected = state.selectedDevice === deviceName;

    // Deseleciona anterior
    if (state.selectedDevice) {
      // Remove polilinha anterior
      MapManager.clearPolyline(state.selectedDevice);
    }

    if (wasSelected) {
      // Toggle: deseleciona
      state.selectedDevice = null;
      this.render();
      SelectedPanel.hide();
      document.getElementById('btn-toggle-route').classList.add('hidden');
      return;
    }

    state.selectedDevice = deviceName;
    state.routeVisible = true;

    // Atualiza UI da lista
    this.render();

    // Centraliza o mapa no dispositivo selecionado
    const location = state.devices[deviceName];
    if (location) {
      state.map.setView([location.latitude, location.longitude], 15, {
        animate: true,
        duration: 0.8,
      });

      // Abre popup do marcador
      if (state.markers[deviceName]) {
        setTimeout(() => state.markers[deviceName].openPopup(), 300);
      }

      // Mostra painel de info
      SelectedPanel.show(location);
    }

    // Carrega e desenha histórico
    await this.loadAndDrawHistory(deviceName);

    // Mostra botão de toggle de rota
    document.getElementById('btn-toggle-route').classList.remove('hidden');
  },

  /**
   * Carrega o histórico do dispositivo via API e desenha no mapa.
   */
  async loadAndDrawHistory(deviceName) {
    try {
      const url = `${CONFIG.API.HISTORY}?device=${encodeURIComponent(deviceName)}&limit=${CONFIG.HISTORY_LIMIT}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const points = data.data || [];

      const color = getDeviceColor(deviceName);
      MapManager.drawPolyline(deviceName, points, color);

      // Atualiza contagem de pontos no painel
      const countEl = document.getElementById('selected-history-count');
      if (countEl) countEl.textContent = `${points.length} ponto${points.length !== 1 ? 's' : ''}`;

    } catch (err) {
      console.error('[ERROR] Falha ao carregar histórico:', err);
    }
  },
};

// ─── Painel de Dispositivo Selecionado ────────────────────────────────────────

const SelectedPanel = {
  el: null,

  init() {
    this.el = document.getElementById('selected-device-info');
    document.getElementById('btn-close-selected').addEventListener('click', () => {
      DeviceList.selectDevice(state.selectedDevice); // Toggle
    });
  },

  show(location) {
    const color = getDeviceColor(location.device_name);

    document.getElementById('selected-device-color').style.background = color;
    document.getElementById('selected-device-name').textContent = location.device_name;
    document.getElementById('selected-lat').textContent = formatCoord(location.latitude);
    document.getElementById('selected-lng').textContent = formatCoord(location.longitude);
    document.getElementById('selected-time').textContent = timeAgo(location.created_at);

    const batRow = document.getElementById('selected-bat-row');
    if (location.battery_level !== null && location.battery_level !== undefined) {
      document.getElementById('selected-bat').textContent = `${location.battery_level}%`;
      batRow.style.display = 'flex';
    } else {
      batRow.style.display = 'none';
    }

    document.getElementById('selected-history-count').textContent = '...';

    this.el.classList.remove('hidden');
  },

  hide() {
    this.el.classList.add('hidden');
  },

  update(location) {
    if (state.selectedDevice !== location.device_name) return;

    document.getElementById('selected-lat').textContent = formatCoord(location.latitude);
    document.getElementById('selected-lng').textContent = formatCoord(location.longitude);
    document.getElementById('selected-time').textContent = timeAgo(location.created_at);

    if (location.battery_level !== null && location.battery_level !== undefined) {
      document.getElementById('selected-bat').textContent = `${location.battery_level}%`;
      document.getElementById('selected-bat-row').style.display = 'flex';
    }
  },
};

// ─── API Client ───────────────────────────────────────────────────────────────

const API = {
  /**
   * Verifica se a API está online.
   */
  async checkHealth() {
    try {
      const res = await fetch(CONFIG.API.HEALTH, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  /**
   * Busca as últimas localizações de todos os dispositivos.
   */
  async fetchLatest() {
    const res = await fetch(CONFIG.API.LATEST, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /**
   * Busca as estatísticas do sistema.
   */
  async fetchStats() {
    const res = await fetch(CONFIG.API.STATS, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /**
   * Limpa o histórico de localizações.
   */
  async clearHistory(token) {
    const res = await fetch(CONFIG.API.CLEAR, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });
    return res;
  },
};

// ─── Status da API (Header) ───────────────────────────────────────────────────

const StatusIndicator = {
  dotEl: null,
  textEl: null,
  lastUpdateEl: null,

  init() {
    this.dotEl = document.getElementById('api-status-dot');
    this.textEl = document.getElementById('api-status-text');
    this.lastUpdateEl = document.getElementById('last-update-text');
  },

  setOnline() {
    this.dotEl.className = 'w-2 h-2 rounded-full bg-emerald-400 transition-colors duration-300';
    this.textEl.className = 'text-emerald-400';
    this.textEl.textContent = 'Online';
  },

  setOffline() {
    this.dotEl.className = 'w-2 h-2 rounded-full bg-red-400 transition-colors duration-300';
    this.textEl.className = 'text-red-400';
    this.textEl.textContent = 'Offline';
  },

  setChecking() {
    this.dotEl.className = 'w-2 h-2 rounded-full bg-yellow-400 animate-pulse transition-colors duration-300';
    this.textEl.className = 'text-yellow-400';
    this.textEl.textContent = 'Verificando...';
  },

  updateLastUpdate() {
    const now = new Date();
    this.lastUpdateEl.textContent = `Atualizado às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  },
};

// ─── Refresh do Botão ─────────────────────────────────────────────────────────

const RefreshButton = {
  btn: null,
  icon: null,
  isSpinning: false,

  init() {
    this.btn = document.getElementById('btn-refresh');
    this.icon = document.getElementById('refresh-icon');

    this.btn.addEventListener('click', () => {
      if (!this.isSpinning) {
        App.refresh(true);
      }
    });
  },

  startSpin() {
    this.isSpinning = true;
    this.icon.style.animation = 'spin 0.8s linear';
    setTimeout(() => {
      this.icon.style.animation = '';
      this.isSpinning = false;
    }, 800);
  },
};

// ─── Controlador Principal da Aplicação ──────────────────────────────────────

const App = {
  /**
   * Inicializa todos os módulos.
   */
  async init() {
    // Inicializa módulos de UI
    Toast.init();
    Modal.init();
    StatusIndicator.init();
    RefreshButton.init();
    DeviceList.init();
    SelectedPanel.init();

    // Inicializa o mapa
    MapManager.init();

    // Configura botões do header
    this.setupHeaderButtons();

    // Carrega dados iniciais
    await this.refresh(false);

    // Inicia polling automático
    this.startPolling();
  },

  /**
   * Configura os botões do header.
   */
  setupHeaderButtons() {
    // Botão: Centralizar em todos os dispositivos
    document.getElementById('btn-fit-bounds').addEventListener('click', () => {
      MapManager.fitAllDevices();
    });

    // Botão: Toggle de rota
    const toggleRouteBtn = document.getElementById('btn-toggle-route');
    toggleRouteBtn.addEventListener('click', () => {
      if (!state.selectedDevice) return;

      state.routeVisible = !state.routeVisible;

      if (state.routeVisible) {
        // Recarrega e mostra rota
        DeviceList.loadAndDrawHistory(state.selectedDevice);
        toggleRouteBtn.style.color = '';
        Toast.show('Rota visível', 'info', 2000);
      } else {
        // Oculta rota
        MapManager.clearPolyline(state.selectedDevice);
        toggleRouteBtn.style.color = '#64748b';
        Toast.show('Rota ocultada', 'info', 2000);
      }
    });

    // Botão: Limpar histórico
    document.getElementById('btn-clear-history').addEventListener('click', () => {
      Modal.open(async (token) => {
        Modal.setLoading(true);
        Modal.hideError();

        try {
          const res = await API.clearHistory(token);

          if (res.status === 401 || res.status === 403) {
            Modal.setLoading(false);
            Modal.showError('Token inválido ou sem permissão.');
            return;
          }

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            Modal.setLoading(false);
            Modal.showError(data.error || `Erro HTTP ${res.status}`);
            return;
          }

          const data = await res.json();
          Modal.close();

          // Limpa o estado local
          this.clearLocalState();

          Toast.show(`Histórico limpo! ${data.deleted} registros removidos.`, 'success');

        } catch (err) {
          Modal.setLoading(false);
          Modal.showError('Falha de conexão com o servidor.');
          console.error('[ERROR] Limpeza falhou:', err);
        }
      });
    });
  },

  /**
   * Limpa o estado local após purga do banco.
   */
  clearLocalState() {
    // Remove todos os marcadores
    Object.keys(state.markers).forEach((d) => MapManager.removeMarker(d));

    // Remove todas as polilinhas
    Object.keys(state.polylines).forEach((d) => MapManager.clearPolyline(d));

    // Limpa estado
    state.devices = {};
    state.selectedDevice = null;
    state.initialFitDone = false;

    // Atualiza UI
    DeviceList.render();
    SelectedPanel.hide();
    document.getElementById('btn-toggle-route').classList.add('hidden');
    document.getElementById('no-devices-overlay').classList.remove('hidden');
    document.getElementById('device-count-badge').textContent = '0';

    // Atualiza stats
    document.getElementById('stat-total-devices').textContent = '0';
    document.getElementById('stat-total-pings').textContent = '0';
  },

  /**
   * Faz o refresh dos dados: busca últimas localizações e atualiza o mapa.
   */
  async refresh(showFeedback = false) {
    RefreshButton.startSpin();
    StatusIndicator.setChecking();

    try {
      // Verifica saúde da API
      const isOnline = await API.checkHealth();

      if (!isOnline) {
        StatusIndicator.setOffline();
        if (showFeedback) Toast.show('API indisponível. Tentando novamente...', 'error');
        return;
      }

      StatusIndicator.setOnline();

      // Busca últimas localizações
      const { data: locations } = await API.fetchLatest();

      // Atualiza estado e UI
      const noDevicesBefore = Object.keys(state.devices).length === 0;
      const updatedDevices = new Set();

      locations.forEach((location) => {
        const { device_name } = location;
        const wasNew = !state.devices[device_name];
        state.devices[device_name] = location;
        updatedDevices.add(device_name);

        // Atualiza marcador no mapa
        MapManager.upsertMarker(location);

        // Se estava selecionado, atualiza painel de info
        if (state.selectedDevice === device_name) {
          SelectedPanel.update(location);
        }

        if (wasNew && showFeedback) {
          Toast.show(`Novo dispositivo detectado: ${device_name}`, 'info');
        }
      });

      // Remove dispositivos que não estão mais na lista
      Object.keys(state.devices).forEach((deviceName) => {
        if (!updatedDevices.has(deviceName)) {
          delete state.devices[deviceName];
          MapManager.removeMarker(deviceName);
        }
      });

      // Renderiza lista de dispositivos
      DeviceList.render();

      // Centraliza automaticamente na primeira carga com dispositivos
      if (!state.initialFitDone && locations.length > 0) {
        state.initialFitDone = true;
        setTimeout(() => MapManager.fitAllDevices(), 500);
      }

      // Mostra/oculta overlay "sem dispositivos"
      const noDevicesOverlay = document.getElementById('no-devices-overlay');
      if (locations.length === 0) {
        noDevicesOverlay.classList.remove('hidden');
      } else {
        noDevicesOverlay.classList.add('hidden');
      }

      // Atualiza estatísticas
      this.updateStats();

      // Atualiza timestamp
      StatusIndicator.updateLastUpdate();

      if (showFeedback) {
        Toast.show(`Posições atualizadas — ${locations.length} dispositivo${locations.length !== 1 ? 's' : ''}`, 'success', 2500);
      }

    } catch (err) {
      console.error('[ERROR] Refresh falhou:', err);
      StatusIndicator.setOffline();
      if (showFeedback) Toast.show('Falha ao atualizar posições.', 'error');
    }
  },

  /**
   * Atualiza as estatísticas no rodapé da sidebar.
   */
  async updateStats() {
    try {
      const { data: stats } = await API.fetchStats();
      document.getElementById('stat-total-devices').textContent = stats.total_devices ?? '—';
      document.getElementById('stat-total-pings').textContent = stats.total_locations?.toLocaleString('pt-BR') ?? '—';
    } catch {
      // Silencioso
    }
  },

  /**
   * Inicia o polling automático a cada 30 segundos.
   */
  startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);

    state.pollTimer = setInterval(() => {
      console.log('[POLL] Atualizando posições...');
      this.refresh(false);
    }, CONFIG.POLL_INTERVAL);

    console.log(`[POLL] Polling automático iniciado (intervalo: ${CONFIG.POLL_INTERVAL / 1000}s)`);
  },

  /**
   * Para o polling automático.
   */
  stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  },
};

// ─── Adicionar CSS para spin animado inline ───────────────────────────────────
const spinStyle = document.createElement('style');
spinStyle.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(spinStyle);

// ─── Bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  console.log('[APP] Tags Tracker inicializando...');
  App.init().then(() => {
    console.log('[APP] Inicialização concluída.');
  }).catch((err) => {
    console.error('[APP] Falha na inicialização:', err);
    Toast.show('Falha ao inicializar a aplicação.', 'error', 8000);
  });
});

// Limpa polling ao fechar a página
window.addEventListener('beforeunload', () => {
  App.stopPolling();
});
