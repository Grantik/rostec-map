// ============================================================
// Ростех × Маркетплейсы — карта пересечений (optimized)
// ============================================================

const DATA_BASE = './data';
const DATA_FILES = ['rostec', 'marketplaces', 'timelines', 'cities', 'acquisitions', 'meta'];
const DATA = {};

const STATUS_COLORS = { acute_def: '#d94a3d', mod_def: '#c08642', neutral: '#a5a472', mod_surp: '#6b8aa8', strong_surp: '#4a7ba8' };
const OP_COLORS = { WB: '#1e78d4', Ozon: '#00b4c8' };
const ACQ_COLOR = '#e8b84a';
const STATUS_LABELS = { acute_def:'Острый дефицит', mod_def:'Умеренный дефицит', neutral:'Нейтрально', mod_surp:'Умеренный избыток', strong_surp:'Выраженный избыток' };

const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

const TO_RAD = Math.PI / 180;
function hav(la1, lo1, la2, lo2) {
  const R = 6371;
  const dLa = (la2 - la1) * TO_RAD, dLo = (lo2 - lo1) * TO_RAD;
  const a = Math.sin(dLa/2)**2 + Math.cos(la1*TO_RAD)*Math.cos(la2*TO_RAD)*Math.sin(dLo/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function statusAtYear(r, year) {
  const tl = DATA.timelines[r.n];
  if (!tl) return r.status;
  let chosen = null;
  for (const e of tl) if (e.year <= year && (!chosen || e.year > chosen.year)) chosen = e;
  return chosen ? chosen.status : r.status;
}

function eventAtYear(n, year) {
  const tl = DATA.timelines[n];
  if (!tl) return null;
  const e = tl.find(x => x.year === year);
  return e && e.event ? e.event : null;
}

function radiusPx(staff, zoom) {
  const s = Number(staff) || 200;
  const base = Math.max(3, Math.min(10, Math.sqrt(s) * 0.13));
  const zf = Math.max(0.65, Math.min(1.6, (zoom - 3) * 0.28));
  return base * zf;
}

function mpSizePx(jobs, zoom) {
  const j = Number(jobs) || 1500;
  const base = Math.max(5, Math.min(13, Math.sqrt(j) / 8));
  const zf = Math.max(0.7, Math.min(1.5, (zoom - 3) * 0.26));
  return base * zf;
}

function parseDate(s) {
  if (!s) return { year: null };
  const [y, m] = s.split('-');
  return { year: parseInt(y, 10), month: m ? parseInt(m, 10) : null };
}

function rafThrottle(fn) {
  let scheduled = false, lastArgs;
  return function(...args) {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn.apply(this, lastArgs);
    });
  };
}

async function loadAllData() {
  const loadingDetail = document.getElementById('loading-detail');
  for (const name of DATA_FILES) {
    if (loadingDetail) loadingDetail.textContent = `${name}.json`;
    try {
      const r = await fetch(`${DATA_BASE}/${name}.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      DATA[name] = await r.json();
    } catch (e) {
      console.error(`Failed to load ${name}:`, e);
      if (loadingDetail) loadingDetail.innerHTML = `<span style="color:var(--accent)">Ошибка ${name}.json: ${e.message}</span>`;
      throw e;
    }
  }
  DATA.rostec_clean = DATA.rostec.filter(r => !r.is_dup);
  DATA.rostec_by_n = new Map(DATA.rostec_clean.map(r => [r.n, r]));
  DATA.mp_by_key = new Map(DATA.marketplaces.map(m => [m.op + '|' + m.location, m]));

  // Prekomputing все попарные дистанции навсегда — 143 × 60 = 8580 пар, считаем раз
  DATA.distances = new Map();
  DATA.rostec_clean.forEach(r => {
    const row = [];
    DATA.marketplaces.forEach(m => {
      const d = hav(r.lat, r.lng, m.lat, m.lng);
      row.push({ mp: m, dist: Math.round(d * 10) / 10, mp_key: m.op + '|' + m.location });
    });
    row.sort((a, b) => a.dist - b.dist);
    DATA.distances.set(r.n, row);
  });
}

const map = L.map('map', {
  center: [58, 72],
  zoom: isMobile() ? 3 : 4,
  minZoom: 2.5, maxZoom: 12,
  preferCanvas: true,
  zoomControl: false,
  attributionControl: false,
  fadeAnimation: false,
});
L.control.zoom({ position: 'bottomleft' }).addTo(map);

const canvasRenderer = L.canvas({ padding: 0.5 });
const countriesLayer = L.layerGroup().addTo(map);
const pairLinesLayer = L.layerGroup().addTo(map);
const mpLayer = L.layerGroup().addTo(map);
const rostecLayer = L.layerGroup().addTo(map);
const acqLayer = L.layerGroup().addTo(map);
const citiesLayer = L.layerGroup().addTo(map);

const rostecMarkers = new Map();
const mpMarkers = new Map();
const acqMarkers = new Map();

let currentYear = 2028;
let radius = 50;
let lastZoom;
let lastResult = null;

function buildCities() {
  DATA.cities.forEach(c => {
    const icon = L.divIcon({
      className: `city-label ${c.kind === 'major' ? 'major' : (c.kind === 'hot' ? 'hot' : '')}`,
      html: c.name, iconSize: null, iconAnchor: [0, 6],
    });
    const m = L.marker([c.lat, c.lng], { icon, interactive: false, keyboard: false });
    m.__kind = c.kind;
    citiesLayer.addLayer(m);
  });
}

function updateCitiesVisibility() {
  const cb = document.getElementById('cb-cities');
  const show = cb ? cb.checked : true;
  const z = map.getZoom();
  citiesLayer.getLayers().forEach(l => {
    if (!show) { l.setOpacity(0); return; }
    const k = l.__kind;
    let visible = false;
    if (k === 'major') visible = z >= 4;
    else if (k === 'hot') visible = z >= 5;
    l.setOpacity(visible ? 1 : 0);
  });
}

function popupRostec(r, year, pairs) {
  const s = statusAtYear(r, year);
  const color = STATUS_COLORS[s];
  const ev = eventAtYear(r.n, year);
  const pairsHtml = pairs.length ? `<div class="pair-list"><div class="pl-title">РЦ в ≤${radius} км · ${pairs.length}</div>${pairs.map(p => `<div class="pair ${p.mp.planned ? 'planned' : ''}"><span>${p.mp.op} · ${p.mp.location}</span><span class="yr">${p.mp.year}${p.mp.planned ? '·план' : ''} · ${p.dist} км</span></div>`).join('')}</div>` : '';
  return `<div class="pop"><div class="kind">Ростех · ${r.staff ? r.staff.toLocaleString('ru') + ' чел.' : 'н/д'}</div><h3>${r.name}</h3><div class="status-chip" style="color:${color}">${STATUS_LABELS[s] || s}</div><div class="row"><span class="k">Город</span><span class="v">${r.city || r.region}</span></div>${r.mode ? `<div class="row"><span class="k">Режим</span><span class="v">${r.mode}</span></div>` : ''}${ev ? `<div class="row"><span class="k">${year}</span><span class="v">${ev}</span></div>` : ''}${r.news ? `<div class="row"><span class="k">Контекст</span><span class="v" style="color:var(--text-dim)">${r.news.length > 160 ? r.news.slice(0,160)+'…' : r.news}</span></div>` : ''}${pairsHtml}</div>`;
}

function popupMP(mp, pairedRostec) {
  const opColor = OP_COLORS[mp.op];
  const plan = mp.planned ? ` <span style="color:var(--accent)">[план ${mp.year}]</span>` : '';
  return `<div class="pop"><div class="kind" style="color:${opColor}">${mp.op} · ${mp.planned ? 'Планируемый' : 'Действующий'}</div><h3>${mp.location}${plan}</h3><div class="row"><span class="k">Регион</span><span class="v">${mp.region}</span></div><div class="row"><span class="k">Запуск</span><span class="v">${mp.date || mp.year}</span></div>${mp.area ? `<div class="row"><span class="k">Площадь</span><span class="v">${mp.area} тыс м²</span></div>` : ''}${mp.jobs ? `<div class="row"><span class="k">Раб. мест</span><span class="v">${mp.jobs.toLocaleString('ru')}</span></div>` : ''}${mp.inv ? `<div class="row"><span class="k">Инвестиции</span><span class="v">${mp.inv} млрд ₽</span></div>` : ''}${pairedRostec.length ? `<div class="pair-list"><div class="pl-title">Ростех в ≤${radius} км · ${pairedRostec.length}</div>${pairedRostec.slice(0,10).map(p => `<div class="pair" style="color:${STATUS_COLORS[p.r.status]}"><span>${p.r.name}</span><span class="yr">${p.dist} км</span></div>`).join('')}${pairedRostec.length > 10 ? `<div class="pair"><span style="color:var(--text-dimmer)">…ещё ${pairedRostec.length-10}</span></div>` : ''}</div>` : ''}</div>`;
}

function popupAcq(ev) {
  return `<div class="pop"><div class="kind" style="color:${ACQ_COLOR}">М&A · ${ev.date}</div><h3>${ev.asset}</h3><div class="row"><span class="k">Покупатель</span><span class="v">${ev.acquirer}</span></div><div class="row"><span class="k">Локация</span><span class="v">${ev.city}, ${ev.region}</span></div><div class="row"><span class="k">Отрасль</span><span class="v">${ev.industry}</span></div>${ev.stake_pct ? `<div class="row"><span class="k">Доля</span><span class="v">${ev.stake_pct}%</span></div>` : ''}${ev.staff_est ? `<div class="row"><span class="k">Оц. штат</span><span class="v">~${ev.staff_est.toLocaleString('ru')} чел.</span></div>` : ''}${ev.notes ? `<div class="row"><span class="k">Комментарий</span><span class="v" style="color:var(--text-dim)">${ev.notes}</span></div>` : ''}${ev.source_url ? `<div class="row"><span class="k">Источник</span><span class="v"><a class="source-link" href="${ev.source_url}" target="_blank" rel="noopener">${ev.source_title || 'ссылка'}</a></span></div>` : ''}</div>`;
}

function getActiveStatuses() { return new Set([...document.querySelectorAll('.status-cb:checked')].map(c => c.value)); }
function getActiveOps() { const set = new Set(); document.querySelectorAll('.mp-cb:checked').forEach(c => set.add(c.value)); return set; }
function getShowPlanned() {
  return {
    WB: !!document.querySelector('.mp-cb-planned[value="WB-pl"]:checked'),
    Ozon: !!document.querySelector('.mp-cb-planned[value="Ozon-pl"]:checked'),
  };
}
function getShowAcq() { const el = document.getElementById('cb-acquisitions'); return el ? el.checked : true; }

function computePairs() {
  const statuses = getActiveStatuses();
  const ops = getActiveOps();
  const planFlags = getShowPlanned();

  const visibleMPKeys = new Set();
  DATA.marketplaces.forEach(m => {
    if (m.year > currentYear) return;
    if (!ops.has(m.op)) return;
    if (m.planned && !planFlags[m.op]) return;
    visibleMPKeys.add(m.op + '|' + m.location);
  });

  const rostecPairs = new Map();
  const mpPairs = new Map();

  DATA.rostec_clean.forEach(r => {
    const curSt = statusAtYear(r, currentYear);
    if (!statuses.has(curSt)) return;
    const pre = DATA.distances.get(r.n);
    const pairs = [];
    for (const d of pre) {
      if (d.dist > radius) break; // предотсортировано, можно break
      if (!visibleMPKeys.has(d.mp_key)) continue;
      pairs.push(d);
    }
    if (pairs.length) {
      rostecPairs.set(r.n, { pairs, status: curSt });
      for (const d of pairs) {
        if (!mpPairs.has(d.mp_key)) mpPairs.set(d.mp_key, []);
        mpPairs.get(d.mp_key).push({ r, dist: d.dist });
      }
    }
  });

  return { rostecPairs, mpPairs, visibleMPKeys };
}

function render() {
  const result = computePairs();
  lastResult = result;
  const { rostecPairs, mpPairs } = result;
  const zoom = map.getZoom();

  // Rostec markers — reuse
  rostecMarkers.forEach(m => { if (rostecLayer.hasLayer(m)) rostecLayer.removeLayer(m); });
  rostecPairs.forEach(({ status }, n) => {
    const r = DATA.rostec_by_n.get(n);
    let m = rostecMarkers.get(n);
    const color = STATUS_COLORS[status];
    const rad = radiusPx(r.staff, zoom);
    if (!m) {
      m = L.circleMarker([r.lat, r.lng], {
        radius: rad, fillColor: color, color: '#07090c',
        weight: 1.3, fillOpacity: 0.92, opacity: 1, renderer: canvasRenderer,
      });
      m.bindPopup('', { maxWidth: 340 });
      m.on('popupopen', () => {
        const p = lastResult.rostecPairs.get(n);
        if (p) m.setPopupContent(popupRostec(r, currentYear, p.pairs));
      });
      m.bindTooltip(`${r.name} · ${r.city || r.region}`, { direction: 'top' });
      rostecMarkers.set(n, m);
    } else {
      m.setRadius(rad);
      m.setStyle({ fillColor: color });
    }
    rostecLayer.addLayer(m);
    if (m.isPopupOpen()) m.setPopupContent(popupRostec(r, currentYear, rostecPairs.get(n).pairs));
  });

  // MP markers
  mpMarkers.forEach(m => { if (mpLayer.hasLayer(m)) mpLayer.removeLayer(m); });
  mpPairs.forEach((pairedRostec, key) => {
    const mp = DATA.mp_by_key.get(key);
    let m = mpMarkers.get(key);
    const opColor = OP_COLORS[mp.op];
    const sz = mpSizePx(mp.jobs, zoom);
    const borderStyle = mp.planned ? 'dashed' : 'solid';
    const fill = mp.planned
      ? `background-image:repeating-linear-gradient(45deg,${opColor} 0,${opColor} 2.5px,rgba(255,255,255,0.1) 2.5px,rgba(255,255,255,0.1) 5px);`
      : `background:${opColor};`;
    const html = `<div style="width:${sz}px;height:${sz}px;${fill}border:1.5px ${borderStyle} #f4f4f6;box-shadow:0 0 10px ${opColor}80;"></div>`;
    const icon = L.divIcon({ className: 'mp-marker', html, iconSize: [sz, sz], iconAnchor: [sz/2, sz/2] });
    if (!m) {
      m = L.marker([mp.lat, mp.lng], { icon });
      m.bindPopup('', { maxWidth: 340 });
      m.on('popupopen', () => {
        const p = lastResult.mpPairs.get(key) || [];
        m.setPopupContent(popupMP(mp, p));
      });
      m.bindTooltip(`${mp.op} · ${mp.location}${mp.planned ? ' (план)' : ''}`, { direction: 'top' });
      mpMarkers.set(key, m);
    } else {
      m.setIcon(icon);
    }
    mpLayer.addLayer(m);
    if (m.isPopupOpen()) m.setPopupContent(popupMP(mp, pairedRostec));
  });

  // Lines
  pairLinesLayer.clearLayers();
  rostecPairs.forEach(({ pairs, status }, n) => {
    const r = DATA.rostec_by_n.get(n);
    const lineColor = status === 'acute_def' ? '#d94a3d' : status === 'mod_def' ? '#7a5533' : '#2a3344';
    const weight = status === 'acute_def' ? 1.2 : 0.7;
    const opacity = status === 'acute_def' ? 0.7 : 0.35;
    for (const d of pairs) {
      L.polyline([[r.lat, r.lng], [d.mp.lat, d.mp.lng]], {
        color: lineColor, weight, opacity,
        dashArray: d.mp.planned ? '3,3' : null,
        renderer: canvasRenderer,
      }).addTo(pairLinesLayer);
    }
  });

  // Acquisitions
  acqMarkers.forEach(m => { if (acqLayer.hasLayer(m)) acqLayer.removeLayer(m); });
  if (getShowAcq()) {
    DATA.acquisitions.events.forEach(ev => {
      const { year } = parseDate(ev.date);
      if (!year || year > currentYear) return;
      let m = acqMarkers.get(ev.id);
      const sz = ev.staff_est ? Math.max(10, Math.min(24, Math.sqrt(ev.staff_est) / 6 * Math.max(1, (zoom - 2) * 0.4))) : 12;
      if (!m) {
        const icon = L.divIcon({
          className: 'acq-marker',
          html: `<div style="width:${sz}px;height:${sz}px;background:${ACQ_COLOR};border:1.5px solid #2a1f0a;transform:rotate(45deg);box-shadow:0 0 12px ${ACQ_COLOR}aa;"></div>`,
          iconSize: [sz*1.5, sz*1.5], iconAnchor: [sz*0.75, sz*0.75],
        });
        m = L.marker([ev.lat, ev.lng], { icon });
        m.bindPopup(popupAcq(ev), { maxWidth: 380 });
        m.bindTooltip(`М&A ${ev.date}: ${ev.asset}`, { direction: 'top' });
        acqMarkers.set(ev.id, m);
      }
      acqLayer.addLayer(m);
    });
  }

  // UI updates
  const nRostec = rostecPairs.size;
  const elNow = document.getElementById('ticker-now');
  if (elNow) elNow.textContent = nRostec;
  const elMR = document.getElementById('meta-radius');
  if (elMR) elMR.textContent = radius;
  const elSN = document.getElementById('sheet-n');
  if (elSN) elSN.textContent = nRostec;

  const parts = [];
  let firstStar = null;
  rostecPairs.forEach(({}, n) => {
    if (firstStar) return;
    const ev = eventAtYear(n, currentYear);
    if (ev && ev.includes('★')) firstStar = `${DATA.rostec_by_n.get(n).name}: ${ev}`;
  });
  if (firstStar) parts.push(firstStar);
  const mpEvs = DATA.marketplaces.filter(m => m.year === currentYear && result.visibleMPKeys.has(m.op + '|' + m.location)).slice(0, 2);
  if (mpEvs.length) parts.push(mpEvs.map(m => `◼ ${m.location}${m.planned ? ' (план)' : ''}`).join(' · '));
  if (getShowAcq()) {
    const acqThisYear = DATA.acquisitions.events.filter(e => parseDate(e.date).year === currentYear);
    if (acqThisYear.length) parts.push(`◆ М&A: ${acqThisYear[0].asset}${acqThisYear.length > 1 ? ` (+${acqThisYear.length - 1})` : ''}`);
  }
  const elEvent = document.getElementById('tl-event');
  if (elEvent) elEvent.textContent = parts.join('  │  ') || '';

  updateLead(nRostec);
  updateCitiesVisibility();
}

const renderThrottled = rafThrottle(render);

function updateLead(n) {
  const el = document.getElementById('lead-text');
  const sub = document.getElementById('lead-sub');
  if (!el || !sub) return;
  const acqCountTotal = DATA.acquisitions.events.filter(e => parseDate(e.date).year <= currentYear).length;
  if (currentYear <= 2020) {
    el.textContent = 'Маркетплейсы — разрозненные точки.';
    sub.textContent = `В ${currentYear} г. ${n} пр-тий Ростеха имеют РЦ ≤${radius} км. Москва, Подмосковье, Казань.`;
  } else if (currentYear <= 2024) {
    el.textContent = 'Зона соприкосновения расширяется.';
    sub.textContent = `${currentYear} г.: ${n} пр-тий в радиусе ${radius} км. Санкции, ГОЗ. Экспансия WB/Ozon.`;
  } else {
    el.textContent = 'Проблема становится структурной.';
    sub.textContent = `${currentYear} г.: ${n} пр-тий. ВПК-кластер скупает гражданские активы (${acqCountTotal} М&A).`;
  }
}

async function initApp() {
  try { await loadAllData(); } catch (e) { return; }
  lastZoom = map.getZoom();

  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
    const topo = await r.json();
    const geo = topojson.feature(topo, topo.objects.countries);
    L.geoJSON(geo, {
      style: f => f.properties.name === 'Russia'
        ? { fillColor: '#0e1218', weight: 0.8, color: '#1e2430', fillOpacity: 1 }
        : { fillColor: '#0a0d12', weight: 0.4, color: '#171c24', fillOpacity: 1 }
    }).addTo(countriesLayer);
  } catch (e) { console.warn('countries failed:', e); }

  buildCities();

  document.getElementById('ticker-total').textContent = DATA.rostec_clean.length;
  const counts = {};
  DATA.rostec_clean.forEach(r => counts[r.status] = (counts[r.status]||0) + 1);
  Object.keys(counts).forEach(k => { const el = document.getElementById('c-'+k); if (el) el.textContent = counts[k]; });
  document.getElementById('c-wb-open').textContent = DATA.marketplaces.filter(m => m.op==='WB' && !m.planned).length;
  document.getElementById('c-oz-open').textContent = DATA.marketplaces.filter(m => m.op==='Ozon' && !m.planned).length;
  document.getElementById('c-wb-pl').textContent = DATA.marketplaces.filter(m => m.op==='WB' && m.planned).length;
  document.getElementById('c-oz-pl').textContent = DATA.marketplaces.filter(m => m.op==='Ozon' && m.planned).length;
  document.getElementById('c-acq').textContent = DATA.acquisitions.events.length;

  function countYear(year) {
    let n = 0;
    DATA.rostec_clean.forEach(r => {
      const pre = DATA.distances.get(r.n);
      for (const d of pre) {
        if (d.dist > 50) break;
        if (d.mp.year <= year) { n++; break; }
      }
    });
    return n;
  }
  document.getElementById('st-2019').textContent = countYear(2019);
  document.getElementById('st-2024').textContent = countYear(2024);
  document.getElementById('st-2028').textContent = countYear(2028);

  const meta = DATA.meta;
  document.getElementById('data-version').innerHTML = `Обновлено: <strong style="color:var(--text)">${meta.last_updated}</strong><br>Ростех: ${meta.datasets.rostec.count} · РЦ: ${meta.datasets.marketplaces.count} · М&A: ${meta.datasets.acquisitions.count}<br><span style="color:var(--text-dimmer)">${meta.attribution}</span>`;

  // Events
  document.querySelectorAll('.status-cb, .mp-cb, .mp-cb-planned').forEach(cb => cb.addEventListener('change', render));
  document.getElementById('cb-acquisitions').addEventListener('change', render);

  const radiusEl = document.getElementById('radius');
  const radiusValEl = document.getElementById('radius-val');
  radiusEl.addEventListener('input', e => {
    radius = parseInt(e.target.value, 10);
    radiusValEl.textContent = radius;
    renderThrottled();
  });

  const yearEl = document.getElementById('year-slider');
  const yearValEl = document.getElementById('year-val');
  yearEl.addEventListener('input', e => {
    currentYear = parseInt(e.target.value, 10);
    yearValEl.textContent = currentYear;
    renderThrottled();
  });

  document.querySelectorAll('.cluster-btn').forEach(b => {
    b.addEventListener('click', () => {
      map.flyTo([parseFloat(b.dataset.lat), parseFloat(b.dataset.lng)], parseInt(b.dataset.zoom, 10), { duration: 0.8 });
      if (isMobile()) document.getElementById('sidebar').classList.remove('open');
    });
  });

  // Zoom — ТОЛЬКО на zoomend, и перерисовываем только при существенном изменении
  map.on('zoomend', () => {
    const z = map.getZoom();
    if (Math.abs(z - lastZoom) >= 0.5) {
      lastZoom = z;
      renderThrottled();
    } else {
      updateCitiesVisibility();
    }
  });
  map.on('moveend', updateCitiesVisibility);

  document.getElementById('cb-cities').addEventListener('change', e => {
    if (e.target.checked) { if (!map.hasLayer(citiesLayer)) citiesLayer.addTo(map); }
    else citiesLayer.remove();
    updateCitiesVisibility();
  });

  let playing = false, timer = null;
  document.getElementById('play-btn').addEventListener('click', function() {
    playing = !playing;
    this.classList.toggle('on', playing);
    this.textContent = playing ? '⏸ Пауза' : '▶ Проиграть';
    if (playing) {
      if (currentYear >= 2028) {
        currentYear = 2019; yearEl.value = 2019; yearValEl.textContent = 2019; render();
      }
      timer = setInterval(() => {
        currentYear++;
        if (currentYear > 2028) {
          playing = false; this.classList.remove('on'); this.textContent = '▶ Проиграть';
          clearInterval(timer); return;
        }
        yearEl.value = currentYear; yearValEl.textContent = currentYear;
        render();
      }, 1200);
    } else { clearInterval(timer); }
  });

  const sidebar = document.getElementById('sidebar');
  const sheetToggle = document.getElementById('sheet-toggle');
  const sheetClose = document.getElementById('sheet-close');
  if (sheetToggle) sheetToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  if (sheetClose) sheetClose.addEventListener('click', () => sidebar.classList.remove('open'));

  let touchStartY = 0, touchCurY = 0, tracking = false;
  sidebar.addEventListener('touchstart', e => {
    if (sidebar.scrollTop === 0) { touchStartY = e.touches[0].clientY; touchCurY = touchStartY; tracking = true; }
    else tracking = false;
  }, { passive: true });
  sidebar.addEventListener('touchmove', e => {
    if (tracking && sidebar.scrollTop === 0) touchCurY = e.touches[0].clientY;
  }, { passive: true });
  sidebar.addEventListener('touchend', () => {
    if (tracking && touchCurY - touchStartY > 60) sidebar.classList.remove('open');
    tracking = false;
  });

  window.addEventListener('resize', rafThrottle(() => map.invalidateSize()));

  render();
  document.getElementById('loading').classList.add('hidden');
}

// ============================================================
// ONBOARDING — welcome + spotlight hints
// ============================================================
const WELCOME_KEY = 'rostec-map:welcome-seen-v1';

const HINTS = {
  years: {
    target: '#timeline',
    title: 'Годы',
    body: 'Тяни ползунок или жми <strong>▶ Проиграть</strong> — увидишь как нарастает число пересечений с 2019 по 2028. Главная кривая: <strong>43 → 105</strong>.',
    placement: 'top',
  },
  ticker: {
    target: '.ticker',
    title: 'Ключевая цифра',
    body: 'Число Ростех-предприятий, у которых в радиусе 50 км есть РЦ WB или Ozon в выбранный год. Пересчитывается на лету при движении ползунка.',
    placement: 'bottom',
  },
  filters: {
    target: null, // выбираем в зависимости от экрана
    title: 'Фильтры и детали',
    body: 'Статусы пр-тий, М&A-события, радиус пересечения, горячие кластеры (Ижевск, Пермь, Уфа, Ростов…). На мобиле — кнопка «Детали» внизу.',
    placement: 'auto',
  },
};

function showWelcome() {
  const w = document.getElementById('welcome');
  if (!w) return;
  w.classList.remove('hidden-init');
  w.style.display = 'flex';
}

function hideWelcome() {
  const w = document.getElementById('welcome');
  if (!w) return;
  w.style.display = 'none';
  try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) {}
}

function ensureSpotlight() {
  let sp = document.querySelector('.hint-spotlight');
  if (!sp) {
    sp = document.createElement('div');
    sp.className = 'hint-spotlight';
    document.getElementById('hint-overlay').appendChild(sp);
  }
  return sp;
}

function showHint(key) {
  const hint = HINTS[key];
  if (!hint) return;
  hideWelcome();

  // Для "filters" таргет зависит от экрана
  let targetSel = hint.target;
  if (key === 'filters') {
    targetSel = isMobile() ? '#sheet-toggle' : '#sidebar';
    // На мобиле: если sheet закрыт, подсветим кнопку; если открыт — сайдбар
    if (isMobile() && document.getElementById('sidebar').classList.contains('open')) {
      targetSel = '#sidebar';
    }
  }

  const target = document.querySelector(targetSel);
  if (!target) return;

  const overlay = document.getElementById('hint-overlay');
  overlay.classList.remove('hidden-init');
  overlay.style.display = 'block';
  overlay.setAttribute('aria-hidden', 'false');

  const sp = ensureSpotlight();
  const bubble = document.getElementById('hint-bubble');

  const rect = target.getBoundingClientRect();
  const pad = 8;
  sp.style.left = (rect.left - pad) + 'px';
  sp.style.top = (rect.top - pad) + 'px';
  sp.style.width = (rect.width + pad * 2) + 'px';
  sp.style.height = (rect.height + pad * 2) + 'px';

  // bubble
  bubble.innerHTML = `
    <button class="hint-close" aria-label="Закрыть">✕</button>
    <div class="hint-title">${hint.title}</div>
    <div>${hint.body}</div>
  `;

  // Позиционирование тултипа
  const vw = window.innerWidth, vh = window.innerHeight;
  const bubbleMaxWidth = Math.min(280, vw - 40);
  bubble.style.maxWidth = bubbleMaxWidth + 'px';
  bubble.style.visibility = 'hidden';
  bubble.style.display = 'block';
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;

  let placement = hint.placement;
  if (placement === 'auto') {
    // Ставим с той стороны, где больше места
    const space = { top: rect.top, bottom: vh - rect.bottom, left: rect.left, right: vw - rect.right };
    placement = Object.keys(space).reduce((a, b) => space[a] > space[b] ? a : b);
  }

  let bx, by;
  if (placement === 'top') {
    bx = rect.left + rect.width/2 - bw/2;
    by = rect.top - bh - 14;
  } else if (placement === 'bottom') {
    bx = rect.left + rect.width/2 - bw/2;
    by = rect.bottom + 14;
  } else if (placement === 'left') {
    bx = rect.left - bw - 14;
    by = rect.top + rect.height/2 - bh/2;
  } else { // right
    bx = rect.right + 14;
    by = rect.top + rect.height/2 - bh/2;
  }
  // Clamp
  bx = Math.max(12, Math.min(bx, vw - bw - 12));
  by = Math.max(12, Math.min(by, vh - bh - 12));
  bubble.style.left = bx + 'px';
  bubble.style.top = by + 'px';
  bubble.style.visibility = 'visible';

  bubble.querySelector('.hint-close').onclick = hideHint;
  overlay.querySelector('.hint-backdrop').onclick = hideHint;
}

function hideHint() {
  const overlay = document.getElementById('hint-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
}

function initOnboarding() {
  const seen = (() => { try { return localStorage.getItem(WELCOME_KEY); } catch (e) { return null; } })();
  if (!seen) showWelcome();

  document.getElementById('welcome-start').addEventListener('click', hideWelcome);
  document.getElementById('welcome-close').addEventListener('click', hideWelcome);
  document.getElementById('welcome').querySelector('.welcome-backdrop').addEventListener('click', hideWelcome);

  document.querySelectorAll('.welcome-hint-btn').forEach(b => {
    b.addEventListener('click', () => showHint(b.dataset.hint));
  });

  document.getElementById('show-welcome-btn').addEventListener('click', () => {
    if (isMobile()) document.getElementById('sidebar').classList.remove('open');
    showWelcome();
  });

  // Закрытие hint по Esc
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideHint(); hideWelcome(); }
  });

  // При ресайзе — прячем подсказку (позиция уплыла)
  window.addEventListener('resize', hideHint);
}

initApp();
initOnboarding();
