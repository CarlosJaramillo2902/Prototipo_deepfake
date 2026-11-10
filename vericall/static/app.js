'use strict';
/* VeriCall · interfaz
   Secciones: utilidades · navegación · directorio · preparación · llamada · deepfake propio ·
   solicitud de pago · vista de decisión · grabación · gobierno · bitácora · inicio. */

// ================= Utilidades =================
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const money = v => `$ ${Number(v).toLocaleString('es-CO', {maximumFractionDigits: 2})}`;
const FRAME_INTERVAL_MS = 500;
const COLORS = {ok: '#14875f', warn: '#c98a1b', danger: '#c0392f', none: '#c8d4da'};
const toneOfModel = s => s === null || s === undefined ? 'none' : s >= .75 ? 'danger' : s <= .25 ? 'ok' : 'warn';

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined && text !== null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function error(message) { $('global-error').textContent = message || ''; $('global-error').hidden = !message; if (message) window.scrollTo({top: 0, behavior: 'smooth'}); }
async function api(url, options) {
  const response = await fetch(url, options);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('El servidor devolvió una respuesta inesperada. Revisa que siga ejecutándose.'); }
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la solicitud.');
  return payload;
}
function setSegment(group, button) {
  group.querySelectorAll('button').forEach(b => { const on = b === button; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
}

const ACTIONS = {
  autorizar_pendiente_confirmacion: {label: 'Autorizar', tone: 'ok',
    explain: () => 'Riesgo bajo. El analista confirma y el pago sale. Siempre puede frenarlo si algo le parece raro.'},
  revisar_canal_alterno: {label: 'Verificar por otro canal', tone: 'warn',
    explain: r => `El pago queda retenido. Llama al número registrado${r && r.name ? ` de ${r.name}` : ''} (nunca a uno dado en la llamada) y libéralo solo si confirma.`},
  bloquear_y_escalar: {label: 'Bloquear y escalar', tone: 'danger',
    explain: r => r && r.is_cfo
      ? 'Riesgo alto. Bloqueo automático y alerta a seguridad. Como el solicitante es el CFO, solo otro directivo autorizado puede liberarlo.'
      : 'Riesgo alto. Bloqueo automático y alerta a seguridad. Seguridad investiga y solo el CFO puede liberarlo, tras verificar por canal alterno.'},
};
const ROLE_LABEL = {analista: 'Analista de tesorería', cfo: 'CFO del cliente', directivo: 'Otro directivo autorizado', seguridad: 'Seguridad TI del cliente'};
const COMPONENT_ORDER = ['authenticity', 'profile', 'history', 'account', 'connection'];
const SOURCE_TEXT = {simulated: 'Video de ejemplo', file: 'Video propio', camera: 'Mi cámara', screen: 'Ventana de Zoom / Meet', deepfake_camera: 'Mi cámara con deepfake'};

// Medidor semicircular 0–100 con las tres bandas.
function gauge(value, {bands = [30, 70], label = ''} = {}) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 200 122'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', value === null ? 'Sin puntaje' : `Puntaje ${Math.round(value)} de 100`);
  const r = 78, cx = 100, cy = 100;
  const point = v => { const a = Math.PI * (1 - v / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
  const arc = (a, b, color, width) => {
    const [x1, y1] = point(a), [x2, y2] = point(b), path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`);
    Object.entries({fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'butt'}).forEach(([k, v]) => path.setAttribute(k, v));
    svg.append(path);
  };
  arc(0, bands[0], '#d5ede1', 14); arc(bands[0], bands[1], '#f6e6c3', 14); arc(bands[1], 100, '#f5d2ce', 14);
  if (value !== null) {
    const tone = value > bands[1] ? 'danger' : value > bands[0] ? 'warn' : 'ok';
    arc(0, Math.max(0.5, Math.min(100, value)), COLORS[tone], 14);
    const [nx, ny] = point(Math.min(100, value)), needle = document.createElementNS(ns, 'circle');
    Object.entries({cx: nx, cy: ny, r: 9, fill: '#fff', stroke: COLORS[tone], 'stroke-width': 4}).forEach(([k, v]) => needle.setAttribute(k, v));
    svg.append(needle);
  }
  const text = (y, content, size, weight, color) => {
    const t = document.createElementNS(ns, 'text');
    Object.entries({x: cx, y, 'text-anchor': 'middle', 'font-size': size, 'font-weight': weight, fill: color}).forEach(([k, v]) => t.setAttribute(k, v));
    t.textContent = content; svg.append(t);
  };
  text(94, value === null ? '—' : String(Math.round(value)), 36, 750, '#132b36');
  text(116, label, 11, 550, '#6c818b');
  return svg;
}

// Línea de tiempo de la señal por cuadro.
function drawTimeline(svg, frames, start, end, onSelect) {
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  const add = (tag, attrs, content) => {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (content !== undefined) el.textContent = content;
    svg.append(el); return el;
  };
  const x = t => 34 + (t - start) / Math.max(end - start, .01) * 664, y = s => 122 - s * 108;
  add('rect', {x: 34, y: y(1), width: 664, height: y(.75) - y(1), fill: '#fcebea'});
  add('rect', {x: 34, y: y(.25), width: 664, height: y(0) - y(.25), fill: '#e5f4ec'});
  for (const v of [0, .25, .5, .75, 1]) {
    add('line', {x1: 34, x2: 698, y1: y(v), y2: y(v), stroke: '#e2e9ed', 'stroke-dasharray': '3 5'});
    add('text', {x: 26, y: y(v) + 3, fill: '#8a9ea7', 'font-size': 10, 'text-anchor': 'end'}, String(v * 100));
  }
  let prev = null;
  for (const f of frames) {
    if (f.fake_score === null) { prev = null; continue; }
    if (prev) add('line', {x1: x(prev.timestamp), y1: y(prev.fake_score), x2: x(f.timestamp), y2: y(f.fake_score), stroke: '#9fb7c0', 'stroke-width': 2});
    prev = f;
  }
  for (const f of frames) {
    const attrs = {cx: x(f.timestamp), cy: f.fake_score === null ? 130 : y(f.fake_score), r: onSelect ? 4.5 : 3, fill: COLORS[toneOfModel(f.fake_score)]};
    if (onSelect) Object.assign(attrs, {tabindex: 0, role: 'button', 'aria-label': `Ver instante ${f.timestamp} s`, style: 'cursor:pointer'});
    const c = add('circle', attrs), title = document.createElementNS(ns, 'title');
    title.textContent = `${f.timestamp.toFixed(1)} s · ${f.fake_score === null ? 'sin rostro' : Math.round(f.fake_score * 100)}`; c.append(title);
    if (onSelect) { c.addEventListener('click', () => onSelect(f.timestamp)); c.addEventListener('keydown', e => { if (e.key === 'Enter') onSelect(f.timestamp); }); }
  }
  add('text', {x: 34, y: 146, fill: '#8a9ea7', 'font-size': 10}, onSelect ? '0 s' : clock(start));
  add('text', {x: 698, y: 146, fill: '#8a9ea7', 'font-size': 10, 'text-anchor': 'end'}, onSelect ? `${end.toFixed(1)} s` : clock(end));
}

// ================= Navegación =================
const VIEWS = ['llamada', 'grabacion', 'gobierno', 'bitacora'];
function route() {
  const view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'llamada';
  document.querySelectorAll('[data-view]').forEach(section => { section.hidden = section.dataset.view !== view; });
  document.querySelectorAll('[data-nav]').forEach(a => { a.classList.toggle('active', a.dataset.nav === view); a.toggleAttribute('aria-current', a.dataset.nav === view); });
  error('');
  if (view === 'gobierno') loadGovernance().catch(err => error(err.message));
  if (view === 'bitacora') loadHistory().catch(err => error(err.message));
}
window.addEventListener('hashchange', route);
document.querySelectorAll('dialog [data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

// ================= Directorio =================
function requesterOf(id) { return state.directory.find(e => e.id === id) || null; }
function requesterLabel(id) { const p = requesterOf(id); return p ? `${p.name} · ${p.title}` : 'Persona no enrolada'; }
function showProfile(select) {
  const card = document.querySelector(`[data-profile-for="${select.id}"]`);
  const person = requesterOf(select.value);
  card.replaceChildren();
  if (!person) { card.className = 'profile warn'; card.append(node('strong', 'No enrolado. '), document.createTextNode('Sin perfil ni historial: el pago irá directo a revisión.')); return; }
  const p = person.profile;
  const problem = !p.consent_active ? 'Consentimiento revocado: no se usa su biometría y el pago va por canal alterno.'
    : p.expired ? `Perfil vencido (${p.age_days} días): debe re-enrolarse; el pago irá a revisión.` : null;
  card.className = `profile ${problem ? 'warn' : ''}`;
  card.append(node('strong', problem ? 'Requiere revisión. ' : 'Enrolado. '), document.createTextNode(problem || `Número registrado ${person.registered_phone} · pagos habituales hasta ${money(person.habitual_max_amount)}, de ${person.usual_hours[0]} a ${person.usual_hours[1]} h.`));
}
function fillDirectory(executives) {
  state.directory = executives;
  document.querySelectorAll('[data-directory]').forEach(select => {
    select.replaceChildren(...executives.map(e => { const o = node('option', `${e.name} · ${e.title}`); o.value = e.id; return o; }));
    const unknown = node('option', 'Persona no enrolada'); unknown.value = 'no_enrolado'; select.append(unknown);
    select.addEventListener('change', () => { showProfile(select); if (select.id === 'live-requester') renderSetupChoice(); });
    showProfile(select);
  });
}

// ================= Preparación de la llamada =================
const state = {samples: [], directory: [], scenarios: [], safeMode: false, recording: {selected: null, mode: 'samples', blob: null, running: false}};
const setup = {tab: 'scenarios', scenario: null, source: 'simulated', sample: null, own: null, filter: 'all'};

document.querySelectorAll('[data-setup-tab]').forEach(button => button.addEventListener('click', () => {
  setup.tab = button.dataset.setupTab; setSegment(button.parentElement, button);
  document.querySelectorAll('[data-setup-panel]').forEach(p => { p.hidden = p.dataset.setupPanel !== setup.tab; });
  if (setup.tab === 'manual') { setup.scenario = null; markScenario(null); } else if (!setup.scenario) setup.source = 'simulated';
  renderSetupChoice();
}));

function renderScenarios() {
  const grid = $('scenario-grid'); grid.replaceChildren();
  for (const scenario of state.scenarios) {
    const card = node('button', undefined, 'scenario'); card.type = 'button'; card.dataset.scenario = scenario.id;
    const thumb = node('div', undefined, 'thumb');
    const sample = state.samples.find(s => s.id === scenario.sample_id);
    if (sample) { const v = node('video'); v.muted = true; v.preload = 'metadata'; v.src = `${sample.media_url}#t=3`; v.setAttribute('aria-hidden', 'true'); thumb.append(v); }
    else if (scenario.swap_preset) thumb.style.backgroundImage = `url(/api/faceswap/presets/${scenario.swap_preset}.jpg)`;
    const expected = ACTIONS[scenario.expected];
    thumb.append(node('span', expected ? `Suele: ${expected.label}` : 'Resultado abierto', `tag ${expected ? expected.tone : ''}`));
    card.append(thumb, node('strong', scenario.title), node('p', scenario.story));
    card.addEventListener('click', () => chooseScenario(scenario));
    grid.append(card);
  }
}
function markScenario(id) { document.querySelectorAll('.scenario').forEach(c => c.classList.toggle('selected', c.dataset.scenario === id)); }
async function chooseScenario(scenario) {
  if (live.active) return;
  setup.scenario = scenario; setup.source = scenario.source; setup.own = null;
  setup.sample = state.samples.find(s => s.id === scenario.sample_id) || null;
  markScenario(scenario.id);
  $('live-requester').value = scenario.requester_id; showProfile($('live-requester'));
  renderSetupChoice();
  if (scenario.source === 'deepfake_camera') await chooseSwapPreset(scenario.swap_preset);
}

document.querySelectorAll('[data-source]').forEach(card => card.addEventListener('click', () => {
  if (live.active) return;
  setup.source = card.dataset.source; setup.scenario = null;
  document.querySelectorAll('[data-source]').forEach(c => c.setAttribute('aria-checked', String(c === card)));
  document.querySelectorAll('[data-source-panel]').forEach(p => { p.hidden = p.dataset.sourcePanel !== setup.source; });
  renderSetupChoice();
}));

function sampleButton(sample, selected, onChoose) {
  const b = node('button', undefined, `sample ${selected ? 'selected' : ''}`); b.type = 'button'; b.dataset.sample = sample.id; b.disabled = !sample.available;
  b.append(node('span', sample.person), node('span', sample.reference_label === 'fake' ? 'Manipulado' : 'Original', `tag ${sample.reference_label === 'fake' ? 'danger' : 'ok'}`));
  b.setAttribute('aria-pressed', String(selected)); b.addEventListener('click', () => onChoose(sample));
  return b;
}
function renderLiveSamples() {
  const list = $('live-sample-list'); list.replaceChildren();
  for (const sample of state.samples.filter(s => setup.filter === 'all' || s.reference_label === setup.filter)) {
    list.append(sampleButton(sample, setup.sample && setup.sample.id === sample.id && !setup.own, s => {
      if (live.active) return; setup.sample = s; clearOwnVideo(); renderLiveSamples(); renderSetupChoice();
    }));
  }
}
$('sample-filter').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; setup.filter = b.dataset.filter; setSegment($('sample-filter'), b); renderLiveSamples();
});

function clearOwnVideo() { if (setup.own) URL.revokeObjectURL(setup.own.url); setup.own = null; $('live-file').value = ''; $('live-file-name').hidden = true; }
async function sha256(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
$('live-file').addEventListener('change', async () => {
  const file = $('live-file').files[0]; if (!file) return;
  if (file.size > 300 * 1024 * 1024) { error('Usa un video de hasta 300 MB.'); $('live-file').value = ''; return; }
  if (setup.own) URL.revokeObjectURL(setup.own.url);
  const own = {url: URL.createObjectURL(file), name: file.name, hash: null}; setup.own = own;
  $('live-file-name').hidden = false; $('live-file-name').textContent = `${file.name} · calculando huella…`; renderSetupChoice();
  try { own.hash = await sha256(file); } catch { error('No se pudo leer el video.'); clearOwnVideo(); renderSetupChoice(); return; }
  if (setup.own === own) { $('live-file-name').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB · SHA-256 ${own.hash.slice(0, 12)}…`; renderSetupChoice(); }
});

function setupReady() {
  if (setup.source === 'simulated') return Boolean(setup.sample);
  if (setup.source === 'file') return Boolean(setup.own && setup.own.hash);
  if (setup.source === 'deepfake_camera') return Boolean(swap.sourceId);
  return true;
}
function renderSetupChoice() {
  const box = $('setup-choice'); box.replaceChildren();
  const s = setup.scenario;
  if (s) {
    box.append(node('strong', s.title), node('span', s.story));
    box.append(node('div', s.lesson, 'lesson'));
  } else {
    const detail = setup.source === 'simulated' ? (setup.sample ? `${setup.sample.person} · ${setup.sample.reference_label === 'fake' ? 'versión manipulada' : 'original'}` : 'Elige un video de la lista.')
      : setup.source === 'file' ? (setup.own ? setup.own.name : 'Elige un archivo.')
      : setup.source === 'deepfake_camera' ? (swap.sourceId ? `Tu cámara con el rostro de ${swap.label}.` : 'Elige el rostro que vas a suplantar.')
      : setup.source === 'camera' ? 'Tu cámara web, como interlocutor real.' : 'El navegador te pedirá elegir la ventana.';
    box.append(node('strong', SOURCE_TEXT[setup.source]), node('span', detail));
  }
  $('live-start').disabled = !setupReady();
  $('live-start').textContent = ['camera', 'screen', 'deepfake_camera'].includes(setup.source) ? 'Conectar y empezar' : 'Iniciar llamada';
}

// ================= Llamada =================
const live = {session: null, active: false, stream: null, startedAt: 0, frames: [], latencies: [], failures: 0, clock: null, alert: false, sawFace: false, sawMultiple: false, last: null, requests: 0};

function addEvent(text, kind = '') {
  const list = $('call-events');
  if (list.querySelector('.muted')) list.replaceChildren();
  const item = node('li', undefined, kind);
  item.append(node('time', clock(live.startedAt ? (performance.now() - live.startedAt) / 1000 : 0)), node('span', text));
  list.prepend(item);
}
function setLiveGauge(score, label) { $('live-gauge').replaceChildren(gauge(score === null ? null : score * 100, {bands: [25, 75], label})); }
function resetRoom() {
  Object.assign(live, {frames: [], latencies: [], alert: false, sawFace: false, sawMultiple: false, last: null, requests: 0});
  $('call-events').replaceChildren(node('li', 'Sin eventos todavía.', 'muted'));
  $('call-requests').replaceChildren();
  setLiveGauge(null, 'señal visual');
  setStatus('neutral', 'Reuniendo evidencia…', 'Se necesitan al menos 4 cuadros con rostro.');
  $('live-frames').textContent = '0'; $('live-coverage').textContent = '—'; $('live-latency').textContent = '—';
  $('live-alert').hidden = true; $('call-stage').classList.remove('alerting');
  $('live-timeline').replaceChildren(); clearOverlay();
  $('evidence-gate').textContent = 'Reuniendo evidencia…';
  document.querySelector('#call-stage .ended')?.remove();
}
function setStatus(tone, title, text) { $('live-status').className = `status-line ${tone}`; $('live-status').textContent = title; $('live-status-text').textContent = text; }
function clearOverlay() { const c = $('live-overlay'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }
function drawFaces(faces) {
  const video = $('live-video'), canvas = $('live-overlay');
  const w = canvas.clientWidth, h = canvas.clientHeight, ratio = window.devicePixelRatio || 1;
  if (canvas.width !== w * ratio || canvas.height !== h * ratio) { canvas.width = w * ratio; canvas.height = h * ratio; }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, w, h);
  if (!video.videoWidth) return;
  const scale = Math.min(w / video.videoWidth, h / video.videoHeight), sw = video.videoWidth * scale, sh = video.videoHeight * scale;
  const ox = (w - sw) / 2, oy = (h - sh) / 2;
  ctx.font = '700 12px Inter, -apple-system, sans-serif'; ctx.lineWidth = 2.5;
  for (const face of faces) {
    const [bx, by, bw, bh] = face.box, left = ox + bx * sw, top = oy + by * sh, color = COLORS[toneOfModel(face.fake_score)];
    ctx.strokeStyle = color; ctx.beginPath(); ctx.roundRect?.(left, top, bw * sw, bh * sh, 10); ctx.stroke();
    const label = String(Math.round(face.fake_score * 100)), lw = ctx.measureText(label).width + 14;
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect?.(left, Math.max(0, top - 24), lw, 20, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, left + 7, Math.max(14, top - 10));
  }
}
function captureFrame() {
  const video = $('live-video');
  if (video.readyState < 2 || !video.videoWidth) return Promise.resolve(null);
  const maxSide = setup.source === 'screen' ? 1600 : 960, scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = live.canvas || (live.canvas = document.createElement('canvas'));
  canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .85));
}
function showLiveState(result) {
  const recent = result.recent_window, call = result.call;
  live.frames.push(result.frame);
  $('live-frames').textContent = String(call.sampled_frames);
  $('live-coverage').textContent = `${Math.round(call.face_coverage * 100)} %`;
  const recentLat = live.latencies.slice(-10);
  $('live-latency').textContent = `${Math.round(recentLat.reduce((a, b) => a + b, 0) / recentLat.length)} ms`;
  const score = recent.fake_score;
  if (!recent.sufficient_face_evidence) {
    setLiveGauge(null, 'señal visual');
    setStatus('neutral', score === null && !result.frame.faces.length ? 'Sin rostro visible' : 'Reuniendo evidencia…', 'Se necesitan al menos 4 cuadros con rostro y 50 % de cobertura en la ventana reciente.');
  } else {
    setLiveGauge(score, 'señal visual');
    if (recent.verdict === 'likely_manipulated') setStatus('danger', 'Posible deepfake', 'Señal alta de manipulación facial en los últimos segundos.');
    else if (recent.verdict === 'inconclusive') setStatus('warn', 'Zona incierta', 'La señal no permite concluir autenticidad. Un pago irá a revisión.');
    else setStatus('ok', 'Sin señales fuertes', 'Señal baja. No equivale a una identidad verificada.');
  }
  drawFaces(result.frame.faces);
  const end = Math.max(result.elapsed_seconds, 10), start = Math.max(0, end - 120);
  drawTimeline($('live-timeline'), live.frames.filter(f => f.timestamp >= start), start, end, null);
  if (!live.sawFace && result.frame.faces.length) { live.sawFace = true; addEvent('Primer rostro detectado; comienza la evaluación.'); }
  if (!live.sawMultiple && result.frame.faces.length > 1) { live.sawMultiple = true; addEvent('Aparecen varios rostros: no se sabe cuál es el solicitante.', 'warn'); }
  if (result.alert !== live.alert) {
    live.alert = result.alert; $('live-alert').hidden = !result.alert; $('call-stage').classList.toggle('alerting', result.alert);
    addEvent(result.alert ? `Alerta: señal alta de manipulación (${Math.round(score * 100)}).` : 'La señal reciente bajó de la zona de alerta.', result.alert ? 'danger' : '');
  }
  $('evidence-gate').textContent = call.sufficient_face_evidence
    ? `Evidencia suficiente: ${call.face_frames} cuadros con rostro.`
    : `Reuniendo evidencia (${call.face_frames}/4 cuadros con rostro). Si registras el pago ahora, irá a revisión.`;
}
async function liveLoop(sessionId) {
  while (live.active && live.session === sessionId) {
    const started = performance.now();
    try {
      const blob = await captureFrame();
      if (blob) {
        const data = new FormData(); data.append('frame', blob, 'frame.jpg');
        const sent = performance.now();
        const result = await api(`/api/live/sessions/${sessionId}/frames`, {method: 'POST', body: data});
        if (!live.active || live.session !== sessionId) return;
        live.latencies.push(performance.now() - sent); live.failures = 0;
        showLiveState(result); live.last = result;
      }
    } catch (err) {
      live.failures += 1;
      if (live.failures >= 3) { error(`Se detuvo el monitoreo: ${err.message}`); endCall(); return; }
    }
    await sleep(Math.max(0, FRAME_INTERVAL_MS - (performance.now() - started)));
  }
}
async function openSource() {
  const video = $('live-video');
  video.srcObject = null; video.removeAttribute('src');
  if (setup.source === 'simulated' || setup.source === 'file') {
    video.src = setup.source === 'file' ? setup.own.url : setup.sample.media_url; video.loop = true;
  } else {
    if (!navigator.mediaDevices) throw new Error('Este navegador no permite capturar video. Abre la aplicación en http://127.0.0.1.');
    live.stream = setup.source === 'screen'
      ? await navigator.mediaDevices.getDisplayMedia({video: {frameRate: 10}, audio: false})
      : await navigator.mediaDevices.getUserMedia({video: {width: {ideal: 1280}, height: {ideal: 720}}, audio: false});
    live.stream.getVideoTracks()[0].addEventListener('ended', () => { if (live.active) { addEvent('Se dejó de compartir la fuente.'); endCall(); } });
    video.srcObject = setup.source === 'deepfake_camera' ? await startSwap(live.stream) : live.stream;
  }
  await video.play();
}
function showRoom(show) { $('call-setup').hidden = show; $('call-room').hidden = !show; window.scrollTo({top: 0}); }
$('live-start').addEventListener('click', () => {
  error('');
  if (!$('live-consent').checked) { error('Confirma que los participantes autorizaron el análisis de la llamada.'); return; }
  if (!setupReady()) return;
  resetRoom(); showRoom(true);
  $('call-caller-name').textContent = requesterLabel($('live-requester').value);
  $('live-end').hidden = true;
  if (setup.source === 'simulated' || setup.source === 'file') {
    $('incoming-name').textContent = requesterLabel($('live-requester').value); $('incoming').hidden = false;
  } else connectCall();
});
$('incoming-accept').addEventListener('click', () => { $('incoming').hidden = true; connectCall(); });
$('incoming-decline').addEventListener('click', () => { $('incoming').hidden = true; showRoom(false); });
async function connectCall() {
  const source = setup.source, data = new FormData();
  data.set('consent', 'yes'); data.set('source', source); data.set('requester_id', $('live-requester').value); data.set('caller', requesterLabel($('live-requester').value));
  if (source === 'simulated') data.set('sample_id', setup.sample.id);
  if (source === 'file') data.set('video_sha256', setup.own.hash);
  if (source === 'deepfake_camera') data.set('faceswap_source_id', swap.sourceId);
  live.startedAt = 0;
  try {
    await openSource();
    const session = await api('/api/live/sessions', {method: 'POST', body: data});
    Object.assign(live, {session: session.session_id, active: true, startedAt: performance.now(), failures: 0});
    $('live-end').hidden = false; $('request-payment').disabled = false;
    $('swap-pill').hidden = source !== 'deepfake_camera';
    live.clock = setInterval(() => { $('call-clock').textContent = clock((performance.now() - live.startedAt) / 1000); }, 500);
    const detail = source === 'simulated' ? ` · ${setup.sample.person}` : source === 'file' ? ` · ${setup.own.name}` : source === 'deepfake_camera' ? ` · rostro de ${swap.label}` : '';
    addEvent(`Llamada conectada (${SOURCE_TEXT[source].toLowerCase()}${detail}).`);
    liveLoop(session.session_id);
  } catch (err) {
    stopMedia(); showRoom(false);
    error(err.name === 'NotAllowedError' ? 'No se otorgó permiso para capturar video. Autoriza la cámara o la pantalla en el navegador.' : err.message);
  }
}
function stopMedia() {
  const video = $('live-video'); video.pause(); stopSwap(); $('swap-pill').hidden = true;
  if (live.stream) { live.stream.getTracks().forEach(t => t.stop()); live.stream = null; }
  video.srcObject = null; video.removeAttribute('src'); video.load();
}
function endCall() {
  if (!live.active) return;
  const session = live.session;
  live.active = false; clearInterval(live.clock);
  addEvent('Llamada finalizada. Las imágenes no se guardaron.');
  stopMedia(); clearOverlay();
  live.alert = false; $('live-alert').hidden = true; $('call-stage').classList.remove('alerting');
  fetch(`/api/live/sessions/${session}/end`, {method: 'POST'}).catch(() => {});
  live.session = null; $('request-payment').disabled = true; $('live-end').hidden = true;
  const ended = node('div', undefined, 'incoming ended');
  ended.append(node('strong', 'Llamada finalizada'), node('p', live.requests ? `${live.requests} solicitud(es) registradas en la bitácora.` : 'No se registraron solicitudes de pago.'));
  const actions = node('div', undefined, 'incoming-actions');
  const again = node('button', 'Nueva llamada', 'btn primary'); again.type = 'button'; again.addEventListener('click', () => showRoom(false));
  const log = node('a', 'Ver bitácora', 'btn ghost'); log.href = '#bitacora';
  actions.append(again, log); ended.append(actions); $('call-stage').append(ended);
}
$('live-end').addEventListener('click', endCall);
window.addEventListener('pagehide', () => { if (live.session) navigator.sendBeacon(`/api/live/sessions/${live.session}/end`); });
window.addEventListener('resize', () => { if (live.last) drawFaces(live.last.frame.faces); });

// ================= Deepfake con la cámara propia =================
// El navegador manda tu cámara al motor (~10–15 cuadros/s), dibuja la respuesta en un lienzo y ese
// lienzo se vuelve la llamada: el detector ve exactamente lo que transmitiría un atacante.
const swap = {sourceId: null, label: '', presetId: null, running: false, raw: null, canvas: null, work: null};
function markPreset(id) { document.querySelectorAll('#swap-presets button').forEach(b => b.classList.toggle('selected', b.dataset.preset === id)); }
async function chooseSwapSource(data, label, presetId = null) {
  $('swap-status').textContent = 'Preparando el rostro de origen…'; swap.sourceId = null; renderSetupChoice();
  try {
    const result = await api('/api/faceswap/sources', {method: 'POST', body: data});
    Object.assign(swap, {sourceId: result.source_id, label, presetId});
    markPreset(presetId); $('swap-status').textContent = `Listo: suplantarás a ${label}.`;
  } catch (err) { markPreset(null); $('swap-status').textContent = err.message; if (setup.scenario) error(err.message); }
  renderSetupChoice();
}
function chooseSwapPreset(id) {
  const data = new FormData(); data.set('preset_id', id);
  const person = (state.samples.find(s => s.id === id) || {}).person || id;
  $('swap-photo').value = ''; return chooseSwapSource(data, person, id);
}
async function loadSwapPresets() {
  const presets = await api('/api/faceswap/presets'), grid = $('swap-presets'); grid.replaceChildren();
  if (!presets.length) grid.append(node('p', 'Faltan los videos DFD. Ejecuta python scripts/download_assets.py --only samples', 'help'));
  for (const preset of presets) {
    const b = node('button'); b.type = 'button'; b.dataset.preset = preset.id;
    const img = node('img'); img.src = preset.thumbnail; img.alt = preset.person; img.loading = 'lazy';
    b.append(img, node('span', preset.person));
    b.addEventListener('click', () => { if (!live.active) chooseSwapPreset(preset.id); });
    grid.append(b);
  }
}
$('swap-photo').addEventListener('change', () => {
  const file = $('swap-photo').files[0];
  if (!file || live.active) return;
  if (!$('swap-consent').checked) { $('swap-status').textContent = 'Marca primero que la persona de la foto lo autorizó.'; $('swap-photo').value = ''; return; }
  const data = new FormData(); data.set('consent', 'yes'); data.set('photo', file);
  chooseSwapSource(data, 'la persona de la foto');
});
async function startSwap(stream) {
  const raw = node('video'); raw.muted = true; raw.playsInline = true; raw.srcObject = stream;
  await raw.play();
  const scale = Math.min(1, 960 / Math.max(raw.videoWidth, raw.videoHeight));
  const width = Math.round(raw.videoWidth * scale), height = Math.round(raw.videoHeight * scale);
  const canvas = node('canvas'), work = node('canvas');
  canvas.width = work.width = width; canvas.height = work.height = height;
  canvas.getContext('2d').drawImage(raw, 0, 0, width, height);
  Object.assign(swap, {running: true, raw, canvas, work});
  swapLoop(raw);
  return canvas.captureStream(15);
}
async function swapLoop(raw) {
  let failures = 0;
  while (swap.running && swap.raw === raw) {
    try {
      swap.work.getContext('2d').drawImage(raw, 0, 0, swap.work.width, swap.work.height);
      const blob = await new Promise(resolve => swap.work.toBlob(resolve, 'image/jpeg', .85));
      const data = new FormData(); data.append('frame', blob, 'frame.jpg'); data.set('source_id', swap.sourceId);
      const response = await fetch('/api/faceswap/frame', {method: 'POST', body: data});
      if (!response.ok) throw new Error((await response.json()).error || 'Falló el intercambio de rostro.');
      const bitmap = await createImageBitmap(await response.blob());
      if (swap.raw !== raw) return;
      swap.canvas.getContext('2d').drawImage(bitmap, 0, 0, swap.canvas.width, swap.canvas.height); bitmap.close();
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures >= 5) { error(`Se detuvo el deepfake: ${err.message}`); endCall(); return; }
      await sleep(200);
    }
  }
}
function stopSwap() { swap.running = false; if (swap.raw) { swap.raw.pause(); swap.raw.srcObject = null; } swap.raw = null; }

// ================= Solicitud de pago (diálogo) =================
function prefillPayment(form, transfer = {}) {
  form.reset();
  form.elements.amount.value = transfer.amount || '500000';
  form.elements.limit.value = transfer.limit || '1000000';
  form.elements.new_beneficiary.checked = Boolean(transfer.new_beneficiary);
}
$('request-payment').addEventListener('click', () => {
  const form = $('transfer-form'), analyst = form.elements.analyst.value;
  prefillPayment(form, setup.scenario ? setup.scenario.transfer : {});
  if (analyst) form.elements.analyst.value = analyst;
  form.querySelector('.form-error').hidden = true;
  form.hidden = false; $('dialog-decision').hidden = true; $('dialog-title').textContent = 'Solicitud de pago';
  $('payment-dialog').showModal();
  form.elements.amount.focus();
});
$('transfer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, problem = form.querySelector('.form-error'), submit = form.querySelector('[type=submit]');
  if (!live.session) { problem.textContent = 'La llamada terminó.'; problem.hidden = false; return; }
  problem.hidden = true; submit.disabled = true; submit.textContent = 'Evaluando…';
  try {
    const entry = await api(`/api/live/sessions/${live.session}/transfer`, {method: 'POST', body: new FormData(form)});
    live.requests += 1;
    const action = ACTIONS[entry.decision.action];
    addEvent(`Pago de ${money(entry.decision.inputs.amount)}: ${action.label} (${entry.decision.score}/100).`, action.tone);
    $('dialog-title').textContent = 'Recomendación de VeriCall';
    form.hidden = true; $('dialog-decision').hidden = false;
    renderDecision(entry, $('dialog-decision'), resolution => {
      addEvent(`Pago ${resolution.outcome === 'release' ? 'liberado' : 'frenado'} por ${resolution.actor} (${resolution.role_label}).`, resolution.outcome === 'release' ? 'ok' : 'danger');
      updateRequest(entry.decision_id, resolution);
    });
    addRequest(entry);
    refreshSide();
  } catch (err) { problem.textContent = err.message; problem.hidden = false; }
  finally { submit.disabled = false; submit.textContent = 'Evaluar solicitud'; }
});
function addRequest(entry) {
  const action = ACTIONS[entry.decision.action];
  const item = node('button', undefined, `request ${action.tone}`); item.type = 'button'; item.dataset.id = entry.decision_id;
  const body = node('div'); body.append(node('strong', `${money(entry.decision.inputs.amount)} · ${action.label}`), node('small', `Puntaje ${entry.decision.score}/100 · ${new Date(entry.timestamp_utc).toLocaleTimeString('es-CO')}`));
  item.append(node('span', undefined, 'bar'), body, node('span', 'Pendiente', 'tag warn'));
  item.addEventListener('click', () => openDetail(entry.decision_id));
  $('call-requests').prepend(item);
}
function updateRequest(id, resolution) {
  const tag = document.querySelector(`#call-requests [data-id="${id}"] .tag`);
  if (tag) { tag.textContent = resolution.outcome === 'release' ? 'Liberado' : 'Frenado'; tag.className = `tag ${resolution.outcome === 'release' ? 'ok' : 'danger'}`; }
}

// ================= Vista de decisión (común) =================
function releasers(entry) {
  const requester = entry.decision.inputs.requester || {};
  if (entry.decision.action === 'bloquear_y_escalar') return requester.is_cfo ? ['directivo'] : ['cfo'];
  return ['analista', 'cfo'];
}
function renderDecision(entry, container, onResolved) {
  const d = entry.decision, action = ACTIONS[d.action], requester = d.inputs.requester || {};
  const root = node('div', undefined, 'decision');

  const verdict = node('div', undefined, `verdict ${action.tone}`);
  const text = node('div');
  text.append(node('p', `Recomendación${requester.name ? ` · ${requester.name}` : ''} · ${money(d.inputs.amount)}`, 'eyebrow'), node('h3', action.label), node('p', action.explain(requester)));
  if (d.safe_mode) text.append(node('p', 'Modo seguro activo: todo pago pasa a verificación alterna.', 'help'));
  verdict.append(text, gauge(d.score, {label: 'riesgo del pago'}));
  root.append(verdict);

  const why = node('div');
  why.append(node('h4', 'Por qué'));
  const ol = node('ol', undefined, 'reasons');
  ol.append(...(d.top_reasons || d.reasons.map(r => r.text).slice(0, 3)).map(t => node('li', t)));
  why.append(ol); root.append(why);

  const how = node('details', undefined, 'disclosure');
  how.append(node('summary', 'Cómo se calculó el puntaje'));
  if (d.components) {
    const grid = node('div', undefined, 'components');
    for (const key of COMPONENT_ORDER) {
      const c = d.components[key]; if (!c) continue;
      const row = node('div', undefined, `component ${c.measured ? '' : 'off'}`), meter = node('div', undefined, 'meter'), fill = node('span');
      fill.style.width = `${c.points}%`; fill.style.background = c.points >= 50 ? COLORS.danger : c.points > 0 ? COLORS.warn : COLORS.ok; meter.append(fill);
      row.append(node('span', c.label), meter, node('b', c.measured ? `+${c.points}` : 'sin medir')); grid.append(row);
    }
    how.append(grid);
  }
  const all = node('ul', undefined, 'all-reasons');
  all.append(...d.reasons.map(r => node('li', `${r.text}${r.points ? ` (+${r.points})` : ''}${r.forces_review ? ' · obliga a revisar' : ''}`)));
  const det = entry.detection || {};
  if (det.decision_basis) all.append(node('li', det.decision_basis === 'recent_window' ? 'Se usó la señal de los últimos segundos porque era más desfavorable que la de toda la llamada.' : 'Se usó la señal acumulada de toda la llamada.'));
  if (d.limitations) all.append(node('li', d.limitations));
  how.append(all);
  const meta = node('p', undefined, 'meta');
  meta.append(document.createTextNode(`ID ${entry.decision_id} · ${d.rule_version}${d.thresholds ? ` · ${d.thresholds.version}` : ''} · evaluó ${entry.analyst || 'sin nombre'} · `));
  const exp = node('a', 'Exportar JSON'); exp.href = `/api/decisions/${entry.decision_id}`; meta.append(exp);
  how.append(meta); root.append(how);

  const area = node('div'); root.append(area);
  if (entry.resolution) area.append(resolutionDone(entry.resolution));
  else area.append(resolveForm(entry, area, onResolved));
  container.replaceChildren(root);
}
function resolutionDone(r) {
  const released = r.outcome === 'release', box = node('div', undefined, `done ${released ? 'released' : 'rejected'}`);
  box.append(node('strong', released ? '✓ Pago liberado' : '✕ Pago frenado'));
  box.append(node('p', `${r.actor} (${r.role_label}) · ${clock(r.elapsed_seconds)} desde la recomendación · ${r.within_sla ? 'dentro' : 'fuera'} del objetivo de 15 min`));
  if (r.alternate_channel) box.append(node('p', `Canal alterno: ${r.alternate_channel}`));
  if (r.justification) box.append(node('p', `Justificación: ${r.justification}`));
  if (r.agrees_with_system === false) box.append(node('p', 'La persona se apartó de la recomendación (cuenta en la tasa de desacuerdo).'));
  return box;
}
function resolveForm(entry, area, onResolved) {
  const d = entry.decision, requester = d.inputs.requester || {}, allowed = releasers(entry);
  const form = node('form', undefined, 'resolve'); form.noValidate = true;
  form.append(node('h4', 'Decisión final'));
  const who = node('div', undefined, 'who'); who.append(node('span', 'Puede liberar:'));
  allowed.forEach(role => who.append(node('span', ROLE_LABEL[role], 'tag ok')));
  who.append(node('span', '· cualquier rol puede frenarlo', 'muted')); form.append(who);

  const grid = node('div', undefined, 'grid-2');
  const roleField = node('label', 'Tu rol', 'field'), role = node('select'); role.name = 'role';
  Object.entries(ROLE_LABEL).forEach(([value, label]) => { const o = node('option', label); o.value = value; role.append(o); });
  role.value = allowed.includes('analista') ? 'analista' : allowed[0]; roleField.append(role);
  const nameField = node('label', 'Tu nombre', 'field'), actor = node('input'); actor.name = 'actor'; actor.maxLength = 80;
  actor.value = role.value === 'analista' ? (entry.analyst || '') : ''; nameField.append(actor);
  grid.append(roleField, nameField); form.append(grid);

  const needsVerification = d.action !== 'autorizar_pendiente_confirmacion';
  let verified = null, channel = null;
  if (needsVerification) {
    const label = node('label', undefined, 'toggle'); verified = node('input'); verified.type = 'checkbox'; verified.name = 'alternate_verified'; verified.value = 'yes';
    const span = node('span', `Llamé al número registrado${requester.name ? ` de ${requester.name}` : ''} y confirmó la solicitud`);
    span.append(node('small', requester.registered_phone ? `${requester.registered_phone} · nunca un número dado en la llamada.` : 'Nunca un número dado en la llamada.'));
    label.append(verified, span); form.append(label);
    const channelField = node('label', 'Canal usado y resultado', 'field'); channel = node('input'); channel.name = 'channel'; channel.maxLength = 200;
    channel.placeholder = 'Ej.: llamé al número registrado; confirmó monto y beneficiario'; channelField.append(channel); form.append(channelField);
  }
  const justField = node('label', undefined, 'field'), just = node('textarea'); just.name = 'justification'; just.maxLength = 500; just.rows = 2;
  justField.append(document.createTextNode(needsVerification ? 'Justificación (obligatoria)' : 'Justificación (obligatoria solo si frenas el pago)'), just);
  form.append(justField);

  const sla = node('p', undefined, 'sla'); form.append(sla);
  const created = new Date(entry.timestamp_utc).getTime();
  const tick = () => { const s = Math.max(0, (Date.now() - created) / 1000); sla.textContent = `${needsVerification ? 'Pago retenido' : 'Esperando confirmación'} hace ${clock(s)} · objetivo ≤ 15:00`; sla.classList.toggle('late', s > 900); };
  tick(); const timer = setInterval(() => { if (!form.isConnected) clearInterval(timer); else tick(); }, 1000);

  const problem = node('p', undefined, 'form-error'); problem.hidden = true; problem.setAttribute('role', 'alert'); form.append(problem);
  const actions = node('div', undefined, 'resolve-actions');
  const reject = node('button', 'Frenar pago', 'btn danger'); reject.type = 'button'; reject.dataset.outcome = 'reject';
  const release = node('button', needsVerification ? 'Liberar tras verificar' : 'Confirmar y liberar', 'btn success'); release.type = 'button'; release.dataset.outcome = 'release';
  actions.append(reject, release); form.append(actions);
  form.addEventListener('submit', e => e.preventDefault());
  for (const button of [reject, release]) button.addEventListener('click', async () => {
    const data = new FormData(form); data.set('outcome', button.dataset.outcome);
    problem.hidden = true; reject.disabled = release.disabled = true;
    try {
      const resolution = await api(`/api/decisions/${entry.decision_id}/resolution`, {method: 'POST', body: data});
      clearInterval(timer); area.replaceChildren(resolutionDone(resolution));
      if (onResolved) onResolved(resolution);
      refreshSide();
    } catch (err) { problem.textContent = err.message; problem.hidden = false; reject.disabled = release.disabled = false; }
  });
  return form;
}
async function openDetail(id) {
  try {
    const entry = await api(`/api/decisions/${id}`);
    renderDecision(entry, $('detail-body'), resolution => { updateRequest(id, resolution); loadHistory().catch(() => {}); });
    $('detail-dialog').showModal();
  } catch (err) { error(err.message); }
}

// ================= Grabación =================
const rec = state.recording;
function renderRecordingSamples(filter = rec.filter || 'all') {
  rec.filter = filter; const list = $('sample-list'); list.replaceChildren();
  for (const s of state.samples.filter(x => filter === 'all' || x.reference_label === filter)) list.append(sampleButton(s, rec.selected && rec.selected.id === s.id, chooseRecordingSample));
}
$('recording-filter').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setSegment($('recording-filter'), b); renderRecordingSamples(b.dataset.filter); });
function resetResult() { $('result-panel').hidden = true; $('progress-panel').hidden = true; $('recording-decision').replaceChildren(); error(''); }
function setPreview(url) { $('preview').src = url; $('preview-placeholder').hidden = true; }
function chooseRecordingSample(sample) {
  if (rec.running) return;
  rec.selected = sample; renderRecordingSamples(); resetResult(); setPreview(sample.media_url);
  $('video-caption').textContent = `${sample.person} · etiqueta del editor: ${sample.reference_label === 'fake' ? 'manipulado' : 'original'}. El detector solo recibe los píxeles.`;
}
function setRecordingMode(mode) {
  if (rec.running) return;
  rec.mode = mode; $('sample-section').hidden = mode !== 'samples'; $('upload-section').hidden = mode !== 'custom';
  setSegment($('samples-tab').parentElement, mode === 'samples' ? $('samples-tab') : $('upload-tab'));
  resetResult();
  if (mode === 'samples' && rec.selected) chooseRecordingSample(rec.selected);
  else if (mode === 'custom' && rec.blob) setPreview(rec.blob);
  else { $('preview').removeAttribute('src'); $('preview').load(); $('preview-placeholder').hidden = false; $('video-caption').textContent = 'La vista previa depende del códec del navegador; el análisis usa OpenCV.'; }
}
$('samples-tab').addEventListener('click', () => setRecordingMode('samples'));
$('upload-tab').addEventListener('click', () => setRecordingMode('custom'));
$('video-file').addEventListener('change', () => {
  resetResult(); const file = $('video-file').files[0];
  if (rec.blob) URL.revokeObjectURL(rec.blob); rec.blob = null; if (!file) return;
  if (file.size > 100 * 1024 * 1024) { error('El video supera los 100 MB admitidos.'); $('video-file').value = ''; return; }
  rec.blob = URL.createObjectURL(file); setPreview(rec.blob);
  $('filename').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
});
$('preview').addEventListener('error', () => { if ($('preview').getAttribute('src')) $('video-caption').textContent = 'Este navegador no reproduce el códec; el servidor puede analizarlo igual.'; });
function seek(t) { const v = $('preview'); if (v.readyState >= 1) { v.pause(); v.currentTime = t; } }
function showResult(entry) {
  const d = entry.detection;
  $('progress-panel').hidden = true; $('result-panel').hidden = false;
  $('verdict-title').textContent = {fake: 'Posible deepfake', real: 'Parece original', unknown: 'Evidencia insuficiente'}[d.predicted_label];
  $('confidence-text').textContent = `Señal visual ${d.fake_score === null ? '—' : Math.round(d.fake_score * 100)}/100 · ` + (d.verdict === 'inconclusive' ? 'zona incierta: requiere revisión.' : d.verdict === 'likely_manipulated' ? 'señal alta de manipulación facial.' : 'señal baja; no equivale a identidad verificada.');
  $('face-count').textContent = `${d.face_frames} / ${d.sampled_frames}`;
  $('coverage').textContent = `${Math.round(d.face_coverage * 100)} %`;
  $('elapsed').textContent = `${d.elapsed_seconds.toFixed(1)} s`;
  const sample = state.samples.find(s => s.id === entry.sample_id), cmp = $('reference-comparison');
  cmp.hidden = !sample;
  if (sample) {
    const match = d.predicted_label === sample.reference_label;
    cmp.className = `note ${d.predicted_label === 'unknown' ? '' : match ? 'ok' : 'bad'}`;
    cmp.textContent = d.predicted_label === 'unknown' ? 'La evidencia no permitió clasificar esta muestra.'
      : match ? 'Coincide con la etiqueta del editor en este ejemplo (no demuestra desempeño general).'
      : `No coincide con la etiqueta del editor: ${sample.reference_label === 'fake' ? 'un deepfake no detectado' : 'una falsa alarma'}.`;
  }
  drawTimeline($('timeline'), d.frames, 0, d.duration_seconds, seek);
  const card = node('div', undefined, 'card'); renderDecision(entry, card); $('recording-decision').replaceChildren(card);
  const tech = $('technical-data'); tech.replaceChildren();
  for (const [k, v] of [['Decisión', entry.decision_id], ['Fecha UTC', entry.timestamp_utc], ['SHA-256 del video', entry.video_sha256], ['Modelo', `${d.model.id} @ ${d.model.revision.slice(0, 10)}`], ['Pipeline', d.pipeline_version], ['Reglas y umbrales', `${entry.decision.rule_version} · ${entry.decision.thresholds ? entry.decision.thresholds.version : '—'}`], ['Video', `${d.width} × ${d.height} · ${d.fps} fps · ${d.duration_seconds} s`], ['Sello en bitácora', entry.integrity ? `#${entry.integrity.seq} · ${entry.integrity.hash}` : '—']]) tech.append(node('dt', k), node('dd', v));
  const body = $('frame-table'); body.replaceChildren();
  for (const f of d.frames) {
    const row = node('tr'); row.append(node('td', `${f.timestamp.toFixed(2)} s`), node('td', f.faces.length), node('td', f.fake_score === null ? 'Sin rostro' : Math.round(f.fake_score * 100)));
    const cell = node('td'), b = node('button', 'Ver', 'btn ghost'); b.type = 'button'; b.style.padding = '4px 10px'; b.addEventListener('click', () => seek(f.timestamp)); cell.append(b); row.append(cell); body.append(row);
  }
}
$('analysis-form').addEventListener('submit', async event => {
  event.preventDefault(); if (rec.running) return; error('');
  const data = new FormData(event.target);
  if (rec.mode === 'samples' && !rec.selected) { error('Elige un video de ejemplo.'); return; }
  data.set('sample_id', rec.mode === 'samples' ? rec.selected.id : 'custom');
  if (rec.mode === 'custom') { const file = $('video-file').files[0]; if (!file) { error('Selecciona un video para analizar.'); return; } data.set('video', file); }
  rec.running = true; $('form-fields').disabled = true; resetResult(); $('progress-panel').hidden = false;
  $('progress-bar').value = 0; $('progress-percent').textContent = '0 %'; $('progress-message').textContent = 'Enviando video';
  try {
    const submitted = await api('/api/analyses', {method: 'POST', body: data});
    let job;
    do {
      await sleep(700); job = await api(submitted.status_url);
      $('progress-message').textContent = job.message; $('progress-percent').textContent = `${job.progress} %`; $('progress-bar').value = job.progress;
    } while (job.status === 'queued' || job.status === 'running');
    if (job.status === 'failed') throw new Error(job.message);
    showResult(job.result); refreshSide();
  } catch (err) { error(err.message); $('progress-panel').hidden = true; }
  finally { rec.running = false; $('form-fields').disabled = false; }
});

// ================= Gobierno =================
const STATUS = {aceptable: ['Aceptable', 'ok'], alerta: ['Alerta', 'warn'], critico: ['Crítico', 'danger'], sin_datos: ['Sin medir', '']};
async function loadGovernance() {
  const board = await api('/api/governance');
  const grid = $('kpi-grid'); grid.replaceChildren();
  for (const m of board.metrics) {
    const [label, tone] = STATUS[m.status], tile = node('div', undefined, `kpi ${m.status}`);
    tile.title = m.bands;
    tile.append(node('h3', m.criterion), node('div', m.value === null ? '—' : `${m.value}${m.unit === '%' ? ' %' : ` ${m.unit}`}`, 'value'),
      node('span', label, `tag ${tone}`), node('div', `Meta ${m.target} · ${m.metric}`, 'target'), node('p', m.detail));
    grid.append(tile);
  }
  const triggers = $('trigger-list'); triggers.replaceChildren();
  if (!board.triggers.length) triggers.append(node('li', 'Sin disparadores activos.', 'none'));
  for (const t of board.triggers) { const li = node('li', undefined, /crítico|liberado/i.test(t.text) ? 'critical' : ''); li.append(node('strong', t.text), node('span', t.action)); triggers.append(li); }
  const m = board.monitoring, dl = $('monitoring-data'); dl.replaceChildren();
  for (const [k, v] of [['Decisiones', m.decisions], ['Pendientes de resolver', m.pending_queue], ['Desacuerdo del analista', m.disagreement_rate === null ? '—' : `${m.disagreement_rate} % (${m.resolved} resueltas)`], ['Ataques simulados', m.simulated_attacks], ['Llamadas legítimas simuladas', m.simulated_legitimate]]) dl.append(node('dt', k), node('dd', String(v)));
  $('governance-note').textContent = board.note;
  $('versions-text').textContent = `${board.versions.rules} · ${board.versions.thresholds} · modelo ${board.versions.model_revision.slice(0, 8)}. ${board.versions.approval}`;
  applySafeMode(board.safe_mode);
}
function applySafeMode(safe) {
  state.safeMode = safe.active;
  $('safe-mode-chip').hidden = !safe.active; $('safe-mode-banner').hidden = !safe.active;
  if (safe.active) $('safe-mode-text').textContent = `Activado por ${safe.actor}: «${safe.reason}».`;
  $('safe-mode-button').textContent = safe.active ? 'Levantar modo seguro' : 'Activar modo seguro';
  $('safe-mode-button').className = `btn block ${safe.active ? 'primary' : 'danger'}`;
}
$('refresh-governance').addEventListener('click', () => loadGovernance().catch(err => error(err.message)));
$('safe-mode-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target, problem = form.querySelector('.form-error'); problem.hidden = true;
  const data = new FormData(form); data.set('active', state.safeMode ? 'no' : 'yes');
  try { await api('/api/governance/safe-mode', {method: 'POST', body: data}); form.elements.reason.value = ''; await loadGovernance(); loadIntegrity().catch(() => {}); }
  catch (err) { problem.textContent = err.message; problem.hidden = false; }
});

// ================= Bitácora =================
async function loadIntegrity() {
  const r = await api('/api/audit/verify'), chip = $('integrity-chip');
  chip.className = `chip ${r.valid ? 'ok' : 'bad'}`;
  chip.replaceChildren(node('i'), document.createTextNode(r.valid ? `Bitácora íntegra · ${r.records}` : 'Bitácora alterada'));
  const detail = $('integrity-detail');
  detail.className = `note ${r.valid ? 'ok' : 'bad'}`;
  detail.textContent = r.valid ? `✓ Verificación actual: ${r.records} registros encadenados, sin alteraciones.` : `✕ La cadena se rompe en el registro #${r.first_invalid_seq}.`;
}
async function loadHistory() {
  const entries = await api('/api/history'), body = $('history-body'); body.replaceChildren();
  loadIntegrity().catch(() => {});
  const pending = entries.filter(e => !e.resolution).length;
  $('pending-count').hidden = !pending; $('pending-count').textContent = String(pending);
  if (!entries.length) { const row = node('tr'), cell = node('td', 'Aún no hay decisiones. La primera aparecerá aquí.', 'muted'); cell.colSpan = 7; row.append(cell); body.append(row); return; }
  for (const e of entries) {
    const row = node('tr'); row.dataset.id = e.decision_id; row.tabIndex = 0;
    const action = ACTIONS[e.decision.action] || {label: e.decision.action, tone: ''};
    const origin = e.source === 'live' ? `Llamada${e.caller ? ` · ${e.caller}` : ''}` : e.sample_id ? `Grabación · ${(state.samples.find(s => s.id === e.sample_id) || {}).person || e.sample_id}` : 'Grabación propia';
    const r = e.resolution;
    const final = node('td'); final.append(r ? node('span', `${r.outcome === 'release' ? 'Liberado' : 'Frenado'} · ${r.actor}`, `tag ${r.outcome === 'release' ? 'ok' : 'danger'}`) : node('span', 'Pendiente', 'tag warn'));
    const rec_ = node('td'); rec_.append(node('span', action.label, `tag ${action.tone}`));
    row.append(node('td', new Date(e.timestamp_utc).toLocaleString('es-CO', {timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short'})),
      node('td', e.decision_id.slice(0, 8), 'mono'), node('td', origin), node('td', e.requester || '—'), node('td', `${e.decision.score}/100`), rec_, final);
    row.addEventListener('click', () => openDetail(e.decision_id));
    row.addEventListener('keydown', ev => { if (ev.key === 'Enter') openDetail(e.decision_id); });
    body.append(row);
  }
}
$('refresh-history').addEventListener('click', () => loadHistory().catch(err => error(err.message)));
function refreshSide() { loadHistory().catch(() => {}); loadGovernance().catch(() => {}); }

// ================= Inicio =================
async function initialize() {
  route();
  try {
    const [samples, health, directory, scenarios] = await Promise.all([api('/api/samples'), api('/health'), api('/api/directory'), api('/api/scenarios')]);
    state.samples = samples; state.scenarios = scenarios.scenarios;
    fillDirectory(directory.executives);
    const chip = $('model-chip'); chip.className = `chip ${health.model.available ? 'ok' : 'bad'}`;
    chip.replaceChildren(node('i'), document.createTextNode(health.model.available ? 'Modelo local' : 'Falta el modelo'));
    renderScenarios(); renderLiveSamples(); renderRecordingSamples();
    setLiveGauge(null, 'señal visual');
    loadSwapPresets().catch(() => {});
    const first = samples.find(s => s.available);
    if (first) chooseRecordingSample(first); else error('Faltan los videos públicos. Descárgalos con: python scripts/download_assets.py --only samples');
    if (state.scenarios.length) chooseScenario(state.scenarios[0]);
    if (!health.model.available) error('Faltan archivos del modelo. Instálalos con: python scripts/download_assets.py');
    renderSetupChoice();
    await Promise.all([loadHistory(), loadGovernance()]);
  } catch (err) { error(err.message); }
}
initialize();
