// ============================================================
// Ростех × Маркетплейсы — карта пересечений
// Данные: data/*.json (fetch at load)
// ============================================================

const DATA_BASE = './data';
const DATA_FILES = ['rostec', 'marketplaces', 'timelines', 'cities', 'acquisitions', 'meta'];
const DATA = {}; // filled on load

const STATUS_COLORS = { acute_def: '#d94a3d', mod_def: '#c08642', neutral: '#a5a472', mod_surp: '#6b8aa8', strong_surp: '#4a7ba8' };
const OP_COLORS = { WB: '#1e78d4', Ozon: '#00b4c8' };
const ACQ_COLOR = '#e8b84a';
const STATUS_LABELS = { acute_def:'Острый дефицит', mod_def:'Умеренный дефицит', neutral:'Нейтрально', mod_surp:'Умеренный избыток', strong_surp:'Выраженный избыток' };

const isMobile = () => window.matchMedia('(max-width: 820px)').matches;

// ============================================================
// Helpers
// ============================================================
function hav(la1, lo1, la2, lo2) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa/2)**2 + Math.cos(toRad(la1))*Math.cos(toRad(la2))*Math.sin(dLo/2)**2;
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

// Parse "YYYY" or "YYYY-MM" → year int, and full label
function parseDate(s) {
  if (!s) return { year: null, label: '?' };
  const [y, m] = s.split('-');
  return { year: parseInt(y, 10), month: m ? parseInt(m, 10) : null, label: s };
}

// ============================================================
// DATA LOAD
// ============================================================
async function loadAllData() {
  const loadingDetail = document.getElementById('loading-detail');
  for (const name of DATA_FILES) {
    loadingDetail.textContent = `${name}.json`;
    try {
      const r = await fetch(`${DATA_BASE}/${name}.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      DATA[name] = await r.json();
    } catch (e) {
      console.error(`Failed to load ${name}:`, e);
      loadingDetail.innerHTML = `<span style="color:var(--accent)">Ошибка загрузки ${name}.json: ${e.message}</span>`;
      throw e;
    }
  }
  // filter is_dup once
  DATA.rostec_clean = DATA.rostec.filter(r => !r.is_dup);
}

// ============================================================
// MAP INIT
// ============================================================
const map = L.map('map', {
  center: [58, 72],
  zoom: isMobile() ? 3 : 4,
  minZoom: 2.5, maxZoom: 12,
  preferCanvas: true,
  zoomControl: false,
  attributionControl: false,
});
L.control.zoom({ position: 'bottomleft' }).addTo(map);

// Layers
const countriesLayer = L.layerGroup().addTo(map);
const pairLinesLayer = L.layerGroup().addTo(map);
const mpLayer = L.layerGroup().addTo(map);
const rostecLayer = L.layerGroup().addTo(map);
const acqLayer = L.layerGroup().addTo(map);
const citiesLayer = L.layerGroup().addTo(map);

// State
let currentYear = 2028;
let radius = 50;

// ============================================================
// CITY LABELS
// ============================================================
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
  const show = document.getElementById('cb-cities').checked;
  const z = map.getZoom();
  if (!show) { citiesLayer.getLayers().forEach(l => l.setOpacity(0)); return; }
  citiesLayer.getLayers().forEach(l => {
    const k = l.__kind;
    let visible = false;
    if (k === 'major') visible = z >= 4;
    else if (k === 'hot') visible = z >= 5;
    l.setOpacity(visible ? 1 : 0);
  });
}

// ============================================================
// POPUPS
// ============================================================
function popupRostec(r, year, pairs) {
  const s = statusAtYear(r, year);
  const color = STATUS_COLORS[s];
  const ev = eventAtYear(r.n, year);
  const pairsHtml = pairs.length ? `
    <div class="pair-list">
      <div class="pl-title">РЦ в ≤${radius} км · ${pairs.length}</div>
      ${pairs.map(p => `
        <div class="pair ${p.mp.planned ? 'planned' : ''}">
          <span>${p.mp.op} · ${p.mp.location}</span>
          <span class="yr">${p.mp.year}${p.mp.planned ? '·план' : ''} · ${p.dist} км</span>
        </div>
      `).join('')}
    </div>` : '';
  return `<div class="pop">
    <div class="kind">Ростех · ${r.staff ? r.staff.toLocaleString('ru') + ' чел.' : 'численность н/д'}</div>
    <h3>${r.name}</h3>
    <div class="status-chip" style="color:${color}">${STATUS_LABELS[s] || s}</div>
    <div class="row"><span class="k">Город</span><span class="v">${r.city || r.region}</span></div>
    ${r.mode ? `<div class="row"><span class="k">Режим</span><span class="v">${r.mode}</span></div>` : ''}
    ${ev ? `<div class="row"><span class="k">${year}</span><span class="v">${ev}</span></div>` : ''}
    ${r.news ? `<div class="row"><span class="k">Контекст</span><span class="v" style="color:var(--text-dim)">${r.news.length > 160 ? r.news.slice(0,160)+'…' : r.news}</span></div>` : ''}
    ${pairsHtml}
  </div>`;
}

function popupMP(mp, pairedRostec) {
  const opColor = OP_COLORS[mp.op];
  const plan = mp.planned ? ` <span style="color:var(--accent)">[план ${mp.year}]</span>` : '';
  return `<div class="pop">
    <div class="kind" style="color:${opColor}">${mp.op} · ${mp.planned ? 'Планируемый/строящийся' : 'Действующий'}</div>
    <h3>${mp.location}${plan}</h3>
    <div class="row"><span class="k">Регион</span><span class="v">${mp.region}</span></div>
    <div class="row"><span class="k">Запуск</span><span class="v">${mp.date || mp.year}</span></div>
    ${mp.area ? `<div class="row"><span class="k">Площадь</span><span class="v">${mp.area} тыс м²</span></div>` : ''}
    ${mp.jobs ? `<div class="row"><span class="k">Раб. мест</span><span class="v">${mp.jobs.toLocaleString('ru')}</span></div>` : ''}
    ${mp.inv ? `<div class="row"><span class="k">Инвестиции</span><span class="v">${mp.inv} млрд ₽</span></div>` : ''}
    ${pairedRostec.length ? `
      <div class="pair-list">
        <div class="pl-title">Ростех в ≤${radius} км · ${pairedRostec.length}</div>
        ${pairedRostec.slice(0,10).map(p => `
          <div class="pair" style="color:${STATUS_COLORS[p.r.status]}">
            <span>${p.r.name}</span>
            <span class="yr">${p.dist} км</span>
          </div>
        `).join('')}
        ${pairedRostec.length > 10 ? `<div class="pair"><span style="color:var(--text-dimmer)">…ещё ${pairedRostec.length-10}</span></div>` : ''}
      </div>` : ''}
  </div>`;
}

function popupAcq(ev) {
  return `<div class="pop">
    <div class="kind" style="color:${ACQ_COLOR}">М&A · ВПК-кластер · ${ev.date}</div>
    <h3>${ev.asset}</h3>
    <div class="row"><span class="k">Покупатель</span><span class="v">${ev.acquirer}</span></div>
    <div class="row"><span class="k">Локация</span><span class="v">${ev.city}, ${ev.region}</span></div>
    <div class="row"><span class="k">Отрасль</span><span class="v">${ev.industry}</span></div>
    ${ev.stake_pct ? `<div class="row"><span class="k">Доля</span><span class="v">${ev.stake_pct}%</span></div>` : ''}
    ${ev.staff_est ? `<div class="row"><span class="k">Оц. штат</span><span class="v">~${ev.staff_est.toLocaleString('ru')} чел.</span></div>` : ''}
    ${ev.notes ? `<div class="row"><span class="k">Комментарий</span><span class="v" style="color:var(--text-dim)">${ev.notes}</span></div>` : ''}
    ${ev.source_url ? `<div class="row"><span class="k">Источник</span><span class="v"><a class="source-link" href="${ev.source_url}" target="_blank" rel="noopener">${ev.source_title || 'ссылка'}</a></span></div>` : ''}
  </div>`;
}

// ============================================================
// FILTER STATE
// ============================================================
function getActiveStatuses() { return new Set([...document.querySelectorAll('.status-cb:checked')].map(c => c.value)); }
function getActiveOps() { const set = new Set(); document.querySelectorAll('.mp-cb:checked').forEach(c => set.add(c.value)); return set; }
function getShowPlanned() {
  return {
    WB: !!document.querySelector('.mp-cb-planned[value="WB-pl"]:checked'),
    Ozon: !!document.querySelector('.mp-cb-planned[value="Ozon-pl"]:checked'),
  };
}
function getShowAcq() { return document.getElementById('cb-acquisitions').checked; }

// ============================================================
// MAIN RECOMPUTE
// ============================================================
function recompute() {
  const statuses = getActiveStatuses();
  const ops = getActiveOps();
  const planFlags = getShowPlanned();
  const zoom = map.getZoom();

  const visibleMP = DATA.marketplaces.filter(m => {
    if (m.year > currentYear) return false;
    if (!ops.has(m.op)) return false;
    if (m.planned && !planFlags[m.op]) return false;
    return true;
  });

  const rostecPairs = new Map();
  const mpPairs = new Map();
  DATA.rostec_clean.forEach(r => {
    const curSt = statusAtYear(r, currentYear);
    if (!statuses.has(curSt)) return;
    const pairs = [];
    visibleMP.forEach(m => {
      const d = hav(r.lat, r.lng, m.lat, m.lng);
      if (d <= radius) pairs.push({ mp: m, dist: Math.round(d*10)/10 });
    });
    if (pairs.length) {
      pairs.sort((a,b) => a.dist - b.dist);
      rostecPairs.set(r.n, { pairs, status: curSt });
      pairs.forEach(({mp, dist}) => {
        const k = mp.op + '|' + mp.location;
        if (!mpPairs.has(k)) mpPairs.set(k, []);
        mpPairs.get(k).push({ r, dist });
      });
    }
  });

  // Lines
  pairLinesLayer.clearLayers();
  rostecPairs.forEach(({ pairs, status }, n) => {
    const r = DATA.rostec_clean.find(x => x.n === n);
    const lineColor = status === 'acute_def' ? '#d94a3d' : status === 'mod_def' ? '#7a5533' : '#2a3344';
    const weight = status === 'acute_def' ? 1.2 : 0.7;
    const opacity = status === 'acute_def' ? 0.7 : 0.35;
    pairs.forEach(({mp}) => {
      const line = L.polyline([[r.lat, r.lng], [mp.lat, mp.lng]], {
        color: lineColor, weight, opacity,
        dashArray: mp.planned ? '3,3' : null,
        renderer: L.canvas(),
      });
      pairLinesLayer.addLayer(line);
    });
  });

  // Rostec
  rostecLayer.clearLayers();
  rostecPairs.forEach(({ pairs, status }, n) => {
    const r = DATA.rostec_clean.find(x => x.n === n);
    const color = STATUS_COLORS[status];
    const rad = radiusPx(r.staff, zoom);
    const m = L.circleMarker([r.lat, r.lng], {
      radius: rad, fillColor: color, color: '#07090c',
      weight: 1.3, fillOpacity: 0.92, opacity: 1, renderer: L.canvas(),
    });
    m.bindPopup(popupRostec(r, currentYear, pairs), { maxWidth: 340 });
    m.bindTooltip(`${r.name} · ${r.city || r.region}`, { direction: 'top', offset: [0, -rad] });
    rostecLayer.addLayer(m);
  });

  // MP
  mpLayer.clearLayers();
  mpPairs.forEach((pairedRostec, key) => {
    const [op, loc] = key.split('|');
    const mp = DATA.marketplaces.find(m => m.op === op && m.location === loc);
    const opColor = OP_COLORS[op];
    const sz = mpSizePx(mp.jobs, zoom);
    const borderStyle = mp.planned ? 'dashed' : 'solid';
    const fill = mp.planned
      ? `background-image: repeating-linear-gradient(45deg, ${opColor} 0, ${opColor} 2.5px, rgba(255,255,255,0.1) 2.5px, rgba(255,255,255,0.1) 5px);`
      : `background: ${opColor};`;
    const icon = L.divIcon({
      className: 'mp-marker',
      html: `<div style="width:${sz}px;height:${sz}px;${fill}border:1.5px ${borderStyle} #f4f4f6;box-shadow:0 0 10px ${opColor}80;"></div>`,
      iconSize: [sz, sz], iconAnchor: [sz/2, sz/2],
    });
    const marker = L.marker([mp.lat, mp.lng], { icon });
    marker.bindPopup(popupMP(mp, pairedRostec), { maxWidth: 340 });
    marker.bindTooltip(`${mp.op} · ${mp.location}${mp.planned ? ' (план)' : ''}`, { direction: 'top', offset: [0, -sz/2] });
    mpLayer.addLayer(marker);
  });

  // === ACQUISITIONS layer ===
  acqLayer.clearLayers();
  if (getShowAcq()) {
    const evs = DATA.acquisitions.events.filter(ev => {
      const { year } = parseDate(ev.date);
      return year && year <= currentYear;
    });
    evs.forEach(ev => {
      // Размер по оценке штата (если известно) — корень от числа / 6, мин 10 макс 24
      const sz = ev.staff_est ? Math.max(10, Math.min(24, Math.sqrt(ev.staff_est) / 6 * (zoom - 2) * 0.4)) : 12;
      // Ромб из div (rotate 45)
      const icon = L.divIcon({
        className: 'acq-marker',
        html: `<div style="width:${sz}px;height:${sz}px;background:${ACQ_COLOR};border:1.5px solid #2a1f0a;transform:rotate(45deg);box-shadow:0 0 12px ${ACQ_COLOR}aa;"></div>`,
        iconSize: [sz*1.5, sz*1.5],
        iconAnchor: [sz*0.75, sz*0.75],
      });
      const marker = L.marker([ev.lat, ev.lng], { icon });
      marker.bindPopup(popupAcq(ev), { maxWidth: 380 });
      marker.bindTooltip(`М&A ${ev.date}: ${ev.asset}`, { direction: 'top', offset: [0, -sz/2] });
      acqLayer.addLayer(marker);
    });
  }

  // UI
  const nRostec = rostecPairs.size;
  document.getElementById('ticker-now').textContent = nRostec;
  document.getElementById('meta-radius').textContent = radius;
  document.getElementById('sheet-n').textContent = nRostec;

  // Timeline event caption — M&A events tie in here too
  const parts = [];
  const starEv = [];
  rostecPairs.forEach(({}, n) => {
    const ev = eventAtYear(n, currentYear);
    if (ev && ev.includes('★')) {
      const r = DATA.rostec_clean.find(x => x.n === n);
      starEv.push(`${r.name}: ${ev}`);
    }
  });
  if (starEv.length) parts.push(starEv[0]);
  // новые РЦ этого года
  const mpEvs = visibleMP.filter(m => m.year === currentYear).slice(0, 2);
  if (mpEvs.length) parts.push(mpEvs.map(m => `◼ ${m.location}${m.planned ? ' (план)' : ''}`).join(' · '));
  // новые M&A этого года
  if (getShowAcq()) {
    const acqThisYear = DATA.acquisitions.events.filter(e => parseDate(e.date).year === currentYear);
    if (acqThisYear.length) {
      const first = acqThisYear[0];
      parts.push(`◆ М&A: ${first.asset}${acqThisYear.length > 1 ? ` (+${acqThisYear.length - 1})` : ''}`);
    }
  }
  document.getElementById('tl-event').textContent = parts.join('  │  ') || '';

  updateLead(nRostec);
  updateCitiesVisibility();
}

function updateLead(n) {
  const el = document.getElementById('lead-text');
  const sub = document.getElementById('lead-sub');
  const acqCountTotal = DATA.acquisitions.events.filter(e => parseDate(e.date).year <= currentYear).length;

  if (currentYear <= 2020) {
    el.textContent = 'Маркетплейсы — разрозненные точки.';
    sub.textContent = `В ${currentYear} г. ${n} пр-тий Ростеха имеют РЦ ≤${radius} км. Москва, Подмосковье, Казань. Остальная страна — пустая.`;
  } else if (currentYear <= 2024) {
    el.textContent = 'Зона соприкосновения расширяется.';
    sub.textContent = `${currentYear} г.: ${n} пр-тий в радиусе ${radius} км. Санкции, ГОЗ. Параллельно — экспансия WB/Ozon в регионы.`;
  } else {
    el.textContent = 'Проблема становится структурной.';
    sub.textContent = `${currentYear} г.: ${n} пр-тий. ВПК-кластер скупает гражданские активы (${acqCountTotal} документированных М&A). Конкуренция за рабочую силу — в одной зоне.`;
  }
}

// ============================================================
// INIT
// ============================================================
async function initApp() {
  try {
    await loadAllData();
  } catch (e) {
    // loading screen remains with error
    return;
  }

  // Countries (world-atlas, external CDN — acceptable for background)
  try {
    const r = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
    const topo = await r.json();
    const geo = topojson.feature(topo, topo.objects.countries);
    L.geoJSON(geo, {
      style: f => f.properties.name === 'Russia'
        ? { fillColor: '#0e1218', weight: 0.8, color: '#1e2430', fillOpacity: 1 }
        : { fillColor: '#0a0d12', weight: 0.4, color: '#171c24', fillOpacity: 1 }
    }).addTo(countriesLayer);
  } catch (e) { console.warn('countries layer failed (optional):', e); }

  buildCities();

  // Counts
  document.getElementById('ticker-total').textContent = DATA.rostec_clean.length;
  const counts = {};
  DATA.rostec_clean.forEach(r => counts[r.status] = (counts[r.status]||0) + 1);
  Object.keys(counts).forEach(k => { const el = document.getElementById('c-'+k); if (el) el.textContent = counts[k]; });
  document.getElementById('c-wb-open').textContent = DATA.marketplaces.filter(m => m.op==='WB' && !m.planned).length;
  document.getElementById('c-oz-open').textContent = DATA.marketplaces.filter(m => m.op==='Ozon' && !m.planned).length;
  document.getElementById('c-wb-pl').textContent = DATA.marketplaces.filter(m => m.op==='WB' && m.planned).length;
  document.getElementById('c-oz-pl').textContent = DATA.marketplaces.filter(m => m.op==='Ozon' && m.planned).length;
  document.getElementById('c-acq').textContent = DATA.acquisitions.events.length;

  // Хронология
  function countYear(year) {
    let n = 0;
    DATA.rostec_clean.forEach(r => {
      for (const m of DATA.marketplaces) {
        if (m.year > year) continue;
        if (hav(r.lat, r.lng, m.lat, m.lng) <= 50) { n++; break; }
      }
    });
    return n;
  }
  document.getElementById('st-2019').textContent = countYear(2019);
  document.getElementById('st-2024').textContent = countYear(2024);
  document.getElementById('st-2028').textContent = countYear(2028);

  // Data version
  const meta = DATA.meta;
  document.getElementById('data-version').innerHTML = `
    Обновлено: <strong style="color:var(--text)">${meta.last_updated}</strong><br>
    Ростех: ${meta.datasets.rostec.count} · РЦ: ${meta.datasets.marketplaces.count} · М&A: ${meta.datasets.acquisitions.count}<br>
    <span style="color:var(--text-dimmer)">${meta.attribution}</span>
  `;

  // Events
  document.querySelectorAll('.status-cb, .mp-cb, .mp-cb-planned').forEach(cb => cb.addEventListener('change', recompute));
  document.getElementById('cb-acquisitions').addEventListener('change', recompute);
  document.getElementById('radius').addEventListener('input', e => {
    radius = parseInt(e.target.value, 10);
    document.getElementById('radius-val').textContent = radius;
    recompute();
  });
  document.getElementById('year-slider').addEventListener('input', e => {
    currentYear = parseInt(e.target.value, 10);
    document.getElementById('year-val').textContent = currentYear;
    recompute();
  });
  document.querySelectorAll('.cluster-btn').forEach(b => {
    b.addEventListener('click', () => {
      map.flyTo([parseFloat(b.dataset.lat), parseFloat(b.dataset.lng)], parseInt(b.dataset.zoom, 10), { duration: 0.8 });
      if (isMobile()) document.getElementById('sidebar').classList.remove('open');
    });
  });
  map.on('zoomend', () => { recompute(); updateCitiesVisibility(); });

  // Cities toggle
  document.getElementById('cb-cities').addEventListener('change', e => {
    if (e.target.checked) citiesLayer.addTo(map); else citiesLayer.remove();
    updateCitiesVisibility();
  });

  // Play
  let playing = false, timer = null;
  document.getElementById('play-btn').addEventListener('click', function() {
    playing = !playing;
    this.classList.toggle('on', playing);
    this.textContent = playing ? '⏸ Пауза' : '▶ Проиграть';
    if (playing) {
      if (currentYear >= 2028) { currentYear = 2019; document.getElementById('year-slider').value = 2019; document.getElementById('year-val').textContent = 2019; recompute(); }
      timer = setInterval(() => {
        currentYear++;
        if (currentYear > 2028) { playing = false; this.classList.remove('on'); this.textContent = '▶ Проиграть'; clearInterval(timer); return; }
        document.getElementById('year-slider').value = currentYear;
        document.getElementById('year-val').textContent = currentYear;
        recompute();
      }, 1200);
    } else { clearInterval(timer); }
  });

  // Mobile sheet
  const sidebar = document.getElementById('sidebar');
  document.getElementById('sheet-toggle').addEventListener('click', () => sidebar.classList.toggle('open'));
  document.getElementById('sheet-close').addEventListener('click', () => sidebar.classList.remove('open'));
  let touchStartY = 0, touchCurY = 0;
  sidebar.addEventListener('touchstart', e => { if (sidebar.scrollTop === 0) { touchStartY = e.touches[0].clientY; touchCurY = touchStartY; }});
  sidebar.addEventListener('touchmove', e => { if (touchStartY && sidebar.scrollTop === 0) touchCurY = e.touches[0].clientY; });
  sidebar.addEventListener('touchend', () => { if (touchStartY && touchCurY - touchStartY > 60) sidebar.classList.remove('open'); touchStartY = 0; touchCurY = 0; });

  window.addEventListener('resize', () => { setTimeout(() => map.invalidateSize(), 100); });

  recompute();
  document.getElementById('loading').classList.add('hidden');
}

initApp();
