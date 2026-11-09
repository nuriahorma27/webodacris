/* Zona privada: respuestas del cuestionario + gestión de la boda
   (invitados, mesas, presupuesto, proveedores y tareas). */
(() => {
  'use strict';
  const D = window.GESTION_DATA;
  const $ = (s, r = document) => r.querySelector(s);
  // En pantallas táctiles todo está bloqueado hasta que se pulsa «Editar» en cada elemento (evita cambios sin querer al tocar o desplazar).
  try { if (window.matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('touch'); } catch { /* sin matchMedia */ }
  const UI_EDIT = new Set();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const eur = n => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';
  const opts = (list, sel, blank) => (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') + list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');

  /* ---------- sesión y API ---------- */
  const loginView = $('#login-view'), panelView = $('#panel-view'), loginError = $('#login-error');
  let credentials = sessionStorage.getItem('boda-admin') || '';
  const headers = () => ({ 'x-admin-auth': credentials, 'Content-Type': 'application/json' });
  const unauthorized = () => { sessionStorage.removeItem('boda-admin'); credentials = ''; showLogin('Usuario o contraseña incorrectos.'); };
  function showLogin(message = '') { panelView.hidden = true; loginView.hidden = false; loginError.textContent = message; }

  /* ---------- diálogos ---------- */
  const confirmDialog = $('#confirm');
  function ask(text, ok = 'Eliminar') {
    $('#confirm-text').textContent = text; $('#confirm-ok').textContent = ok;
    confirmDialog.showModal();
    return new Promise(res => { confirmDialog.onclose = () => res(confirmDialog.returnValue === 'ok'); });
  }
  $('#confirm-cancel').onclick = () => { confirmDialog.returnValue = 'no'; confirmDialog.close('no'); };
  $('#confirm-ok').onclick = () => confirmDialog.close('ok');

  /* ---------- almacenamiento por secciones (con guardado automático) ---------- */
  const SEC = {};           // seccion -> { rev, data, timer, saving, again }
  const saveState = $('#save-state');
  const setSave = (t, bad) => { saveState.textContent = t; saveState.classList.toggle('bad', !!bad); };

  const defaults = {
    invitados: () => ({ invitados: [], columnas: ['Dirección', 'Alergias', 'Invitación entregada', 'Regalo', 'Cantidad (regalo)', 'Agradecimiento enviado'].map(n => ({ id: uid(), nombre: n, tipo: /entregada|^Regalo|enviado/.test(n) ? 'sino' : n.startsWith('Cantidad') ? 'numero' : 'texto' })), grupos: ['Familia de la novia', 'Familia del novio', 'Amigos de la novia', 'Amigos del novio', 'Amigos comunes', 'Trabajo', 'Otros'], vinculos: {} }),
    mesas: () => ({ mesas: [] }),
    presupuesto: () => ({ partidas: initialPartidas() }),
    proveedores: () => ({ manuales: [], autoPagos: {} }),
    tareas: () => ({ estados: {}, detalles: {}, custom: { ov: {}, borradas: [], nuevas: [], catsBorradas: [] }, resp: [] })
  };
  const CATS_INICIALES = ['Iglesia', 'Banquete', 'Música', 'Decoración y flores', 'Fotografía y vídeo', 'La novia', 'El novio', 'Papelería', 'Transporte', 'Detalles y regalos', 'Viaje de novios', 'Otros'];
  const newPartida = (categoria, concepto) => ({ id: uid(), categoria, concepto, proveedor: '', estimado: 0, pagado: 0, ...(D.MENU_CONCEPTOS.includes(concepto) ? { tipo: 'menu', precioUnidad: 0, cantidad: 0 } : {}) });
  const initialPartidas = () => CATS_INICIALES.flatMap(c => (D.CATEGORIAS_ESTANDAR[c] || []).map(x => newPartida(c, x)));

  // fetch con límite de tiempo: si el servidor tarda demasiado, se avisa en vez de quedarse colgado.
  async function fetchT(url, opts = {}, ms = 30000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'El servidor tarda demasiado en responder.' : 'Sin conexión con el servidor.'); }
    finally { clearTimeout(t); }
  }
  const PENDING = {};
  function loadSec(name, force) {
    if (SEC[name] && !force) return Promise.resolve(SEC[name].data);
    if (PENDING[name]) return PENDING[name];
    return (PENDING[name] = loadSecNow(name).finally(() => { delete PENDING[name]; }));
  }
  async function loadSecNow(name) {
    const res = await fetchT(`/api/gestion/${name}`, { headers: headers() });
    if (res.status === 401) { unauthorized(); throw new Error('401'); }
    if (!res.ok) throw new Error('No se ha podido cargar.');
    const { rev, data } = await res.json();
    const base = defaults[name]();
    SEC[name] = { rev, data: data ? { ...base, ...data } : base, timer: null, saving: false, again: false, fresh: !data };
    if (name === 'invitados' && data) {
      const d = SEC[name].data, ejemplo = defaults.invitados().grupos, usados = new Set(d.invitados.map(g => g.grupo));
      const limpios = d.grupos.filter(g => usados.has(g) || !ejemplo.includes(g));
      if (limpios.length !== d.grupos.length) { d.grupos = limpios; markDirty(name, true); }
    }
    if (name === 'invitados') { const d0 = SEC[name].data; const c1 = ensureBusCols(d0), c2 = fillSino(d0); if (c1 || c2) markDirty(name, true); }
    if (!data) markDirty(name);   // primera vez: guarda los valores de partida
    return SEC[name].data;
  }
  // Historial: cada tanda de cambios seguidos (menos de 1 s entre ellos) es un paso que se puede deshacer.
  const HIST = {};
  const hist = name => HIST[name] || (HIST[name] = { undo: [], redo: [], snap: null, pending: false, settle: null });
  function baseline(name) { const h = hist(name); h.snap = JSON.stringify(SEC[name].data); }
  function markDirty(name, noHistory) {
    const s = SEC[name]; if (!s) return;
    if (!noHistory) {
      const h = hist(name);
      if (h.snap === null) h.snap = '{}';
      if (!h.pending) { h.undo.push(h.snap); if (h.undo.length > 60) h.undo.shift(); h.redo = []; h.pending = true; }
      clearTimeout(h.settle); h.settle = setTimeout(() => { h.snap = JSON.stringify(SEC[name].data); h.pending = false; updateUndoButtons(); }, 1000);
      updateUndoButtons();
    }
    if (name === 'presupuesto') renderAlerts();
    setSave('Guardando…'); clearTimeout(s.timer); s.timer = setTimeout(() => flush(name), 700);
  }
  const TAB_SECTION = { invitados: 'invitados', mesas: 'mesas', presupuesto: 'presupuesto', proveedores: 'proveedores', tareas: 'tareas' };
  function updateUndoButtons() {
    const name = TAB_SECTION[current], h = name && HIST[name];
    const u = $('#undo'), r = $('#redo'); if (!u || !r) return;
    u.disabled = !h || !h.undo.length; r.disabled = !h || !h.redo.length;
    u.title = h?.undo.length ? `Deshacer (${h.undo.length})` : 'Nada que deshacer';
    const w = $('#undo-wrap'); if (w) w.hidden = !name;
  }
  function restore(name, json) {
    SEC[name].data = { ...defaults[name](), ...JSON.parse(json) };
    hist(name).snap = json; hist(name).pending = false; clearTimeout(hist(name).settle);
    markDirty(name, true); TABS[current].render(); updateUndoButtons();
  }
  function undo() {
    const name = TAB_SECTION[current], h = name && HIST[name]; if (!h || !h.undo.length) return;
    const cur = JSON.stringify(SEC[name].data); h.redo.push(cur); restore(name, h.undo.pop()); setSave('Cambio deshecho ✓');
  }
  function redo() {
    const name = TAB_SECTION[current], h = name && HIST[name]; if (!h || !h.redo.length) return;
    h.undo.push(JSON.stringify(SEC[name].data)); restore(name, h.redo.pop()); setSave('Cambio rehecho ✓');
  }
  async function flush(name) {
    const s = SEC[name];
    if (s.saving) { s.again = true; return; }
    s.saving = true;
    try {
      const res = await fetchT(`/api/gestion/${name}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ data: s.data, rev: s.rev }) });
      if (res.status === 401) return unauthorized();
      if (res.status === 409) { setSave('Otra persona ha guardado cambios: recarga la página para verlos.', true); return; }
      if (!res.ok) { setSave('No se ha podido guardar. Reintentando…', true); s.timer = setTimeout(() => flush(name), 4000); return; }
      s.rev = (await res.json()).rev; setSave('Guardado ✓');
    } catch { setSave('Sin conexión. Reintentando…', true); s.timer = setTimeout(() => flush(name), 4000); }
    finally { s.saving = false; if (s.again) { s.again = false; flush(name); } }
  }
  window.addEventListener('beforeunload', e => { if (Object.values(SEC).some(s => s.timer && (s.saving || s.again || saveState.textContent === 'Guardando…'))) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- respuestas del cuestionario ---------- */
  let respData = null;       // { columns, rows, summary }
  async function loadRespuestas() {
    const res = await fetchT('/api/respuestas', { headers: headers() });
    if (res.status === 401) { unauthorized(); throw new Error('401'); }
    if (!res.ok) throw new Error('No se han podido cargar las respuestas.');
    respData = await res.json();
    return respData;
  }
  const LONG_FIELDS = ['direccion', 'alergias'];
  function renderRespuestas() {
    const { columns, rows, summary } = respData;
    const stats = [
      [summary.respuestas, 'formularios recibidos'], [summary.personas, 'personas asisten (con acompañantes)'], [summary.noAsisten, 'no asisten'],
      [summary.idaGijon + ' / ' + summary.idaOviedo, 'bus de ida Gijón / Oviedo'], [summary.vueltaGijon + ' / ' + summary.vueltaOviedo, 'bus de vuelta Gijón / Oviedo']
    ];
    $('#stats').innerHTML = stats.map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
    $('#table').innerHTML = rows.length
      ? `<thead><tr><th></th>${columns.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr><td class="actions-cell"><button class="delete" type="button" data-index="${i}" aria-label="Eliminar" title="Eliminar">${TRASH}</button></td>${columns.map(([k]) => `<td${LONG_FIELDS.includes(k) ? ' class="long"' : ''}>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">Todavía no ha llegado ninguna respuesta.</td></tr></tbody>';
  }
  $('#table').addEventListener('click', async event => {
    const b = event.target.closest('.delete'); if (!b) return;
    const row = respData.rows[b.dataset.index];
    const name = `${row.nombre} ${row.apellidos}`.trim() || 'esta persona';
    const other = respData.rows.find(r => r.id === row.id && r.persona !== row.persona);
    if (!(await ask(other ? `Se eliminará solo a ${name}. ${other.nombre} ${other.apellidos} se mantiene.` : `Se eliminará a ${name}.`))) return;
    const res = await fetch(`/api/respuestas/${row.id}?persona=${row.persona}`, { method: 'DELETE', headers: headers() });
    if (!res.ok && res.status !== 404) return alert('No se ha podido eliminar. Inténtalo de nuevo.');
    await loadRespuestas(); render();
  });
  $('#export').onclick = async () => {
    const b = $('#export'); b.disabled = true;
    const res = await fetch('/api/respuestas?format=xlsx', { headers: headers() }); b.disabled = false;
    if (!res.ok) return alert('No se ha podido exportar el Excel.');
    download(await res.blob(), `respuestas-boda-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const download = (blob, name) => { const url = URL.createObjectURL(blob); Object.assign(document.createElement('a'), { href: url, download: name }).click(); URL.revokeObjectURL(url); };

  /* ---------- Excel (SheetJS, solo cuando hace falta) ---------- */
  let xlsxPromise;
  const getXLSX = () => xlsxPromise || (xlsxPromise = new Promise((res, rej) => {
    if (window.XLSX) return res(window.XLSX);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('No se ha podido cargar la librería de Excel.')); document.head.appendChild(s);
  }));

  /* ================= INVITADOS ================= */
  const VIENE = ['Pendiente', 'Sí', 'No'];
  const SUGERIDAS = [['Save the date enviado', 'sino'], ['Invitación enviada', 'sino'], ['Invitación entregada', 'sino'], ['Detalle entregado', 'sino'], ['Menú confirmado', 'sino'], ['Alojamiento reservado', 'sino'], ['Bus ida', 'sino'], ['Bus vuelta', 'sino'], ['Regalo', 'sino'], ['Agradecimiento enviado', 'sino'], ['Hora bus ida', 'texto'], ['Hora bus vuelta', 'texto'], ['Cantidad (regalo)', 'numero'], ['Dirección', 'texto'], ['Alergias', 'texto'], ['Menú', 'texto'], ['Mesa', 'texto'], ['Alojamiento', 'texto'], ['Notas', 'texto']];
  // Colores de las etiquetas (grupos, subgrupos, sí/no...) para que se lea de un vistazo.
  const PALETTE = ['#f4d9d4', '#f7e3c3', '#f3ecb8', '#dbe9c0', '#c9e7d9', '#c6e3ea', '#cfdcf2', '#ddd3f0', '#ecd0e6', '#f0d3c0', '#d9dfc2', '#e8d9c0', '#d0e6f0', '#e6d0d0'];
  const FIXED = { si: '#d6e8bd', no: '#f2d0c7', pendiente: '#f7e3c3', 'tal vez': '#f7e3c3', adulto: '#ebe5d3', nino: '#cfdcf2' };
  const hashIdx = v => { let h = 5381; for (const ch of norm(v)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return Math.abs(h) % PALETTE.length; };
  const tint = (v, i) => { const k = norm(v); if (!k) return ''; return ` style="background:${FIXED[k] || PALETTE[i !== undefined && i >= 0 ? i % PALETTE.length : hashIdx(v)]}"`; };
  const BUS = { bi: ['Bus ida', 'sino'], bid: ['Bus ida desde', 'lista'], bv: ['Bus vuelta', 'sino'], bva: ['Bus vuelta a', 'lista'] };
  const colOf = (inv, name) => inv.columnas.find(c => norm(c.nombre) === norm(name));
  const extraOf = (inv, g, name) => { const c = colOf(inv, name); return c ? (g.extra[c.id] ?? '') : ''; };
  const mesaMap = () => { const m = new Map(); for (const t of SEC.mesas?.data.mesas || []) for (const id of t.invitados) if (id) m.set(id, t); return m; };
  const mesaLabel = t => `Mesa ${t.numero}${t.nombre ? ' · ' + t.nombre : ''}`;
  // Cómo se lee cada filtro en un invitado.
  function fieldGetter(field) {
    const inv = SEC.invitados.data;
    if (field === 'mesa') { const mm = mesaMap(); return g => (mm.has(g.id) ? String(mm.get(g.id).numero) : 'sin'); }
    if (BUS[field]) return g => extraOf(inv, g, BUS[field][0]);
    return g => g[field];
  }
  const ui = { fopen: false, mopen: false };
  const FILTER_KEYS = ['grupo', 'subgrupo', 'viene', 'tipo', 'bi', 'bid', 'bv', 'bva', 'mesa'];
  const isFiltering = () => !!(guestFilter.q || FILTER_KEYS.some(k => guestFilter[k]));
  function filteredGuests(f = guestFilter) {
    const q = norm(f.q), getters = FILTER_KEYS.filter(k => f[k]).map(k => [k, fieldGetter(k)]);
    return SEC.invitados.data.invitados.filter(g => (!q || norm(`${fullName(g)} ${g.grupo} ${g.subgrupo}`).includes(q)) && getters.every(([k, get]) => get(g) === f[k]));
  }
  // Valores que existen de verdad para un campo, con cuántos invitados hay en cada uno (según el resto de filtros).
  function facet(field) {
    const counts = new Map(), get = fieldGetter(field);
    for (const g of filteredGuests({ ...guestFilter, [field]: '' })) { const v = get(g); if (v) counts.set(v, (counts.get(v) || 0) + 1); }
    if (guestFilter[field] && !counts.has(guestFilter[field])) counts.set(guestFilter[field], 0);
    return counts;
  }
  function filtersHtml() {
    const inv = SEC.invitados.data, chip = (k, v, n, color, label) => `<button class="fchip${guestFilter[k] === v ? ' on' : ''}" data-act="g-f" data-k="${k}" data-v="${esc(v)}"${color ? ` style="--c:${color}"` : ''}>${esc(label ?? v)} <b>${n}</b></button>`;
    const ordered = (counts, pref) => [...counts.keys()].sort((x, y) => { const i = pref.indexOf(x), j = pref.indexOf(y); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j) || x.localeCompare(y, 'es'); });
    const row = (label, html) => html ? `<div class="frow"><span class="flabel">${label}</span><div class="fchips">${html}</div></div>` : '';
    const v = facet('viene'), t = facet('tipo'), g = facet('grupo'), sg = facet('subgrupo');
    const allG = [...new Set(inv.invitados.map(x => x.grupo).filter(Boolean))];
    // Las opciones del autobús se muestran siempre (aunque ahora no haya nadie), para que se vea que el filtro existe.
    const simple = (k, label, pref) => { const f = facet(k); for (const x of pref) if (!f.has(x)) f.set(x, 0); return row(label, ordered(f, pref).map(x => chip(k, x, f.get(x), FIXED[norm(x)] || PALETTE[hashIdx(x)])).join('')); };
    const mesas = SEC.mesas?.data.mesas || [], mf = facet('mesa');
    const mesaChips = [...mf.keys()].sort((x, y) => (x === 'sin') - (y === 'sin') || Number(x) - Number(y)).map(x => { const t = mesas.find(m => String(m.numero) === x); return chip('mesa', x, mf.get(x), x === 'sin' ? '#efe6d2' : PALETTE[hashIdx(x)], x === 'sin' ? 'Sin mesa' : t ? mesaLabel(t) : `Mesa ${x}`); }).join('');
    return row('¿Viene?', ordered(v, ['Sí', 'Pendiente', 'No']).map(x => chip('viene', x, v.get(x), FIXED[norm(x)])).join(''))
      + row('Tipo', ordered(t, ['Adulto', 'Niño']).map(x => chip('tipo', x, t.get(x), FIXED[norm(x)])).join(''))
      + row('Grupo', ordered(g, allG).map(x => chip('grupo', x, g.get(x), PALETTE[Math.max(0, inv.grupos.indexOf(x)) % PALETTE.length])).join(''))
      + row('Subgrupo', ordered(sg, []).map(x => chip('subgrupo', x, sg.get(x), PALETTE[hashIdx(x)])).join(''))
      + simple('bi', 'Bus de ida', ['Sí', 'No']) + simple('bid', 'Ida desde', ['Gijón', 'Oviedo'])
      + simple('bv', 'Bus de vuelta', ['Sí', 'No']) + simple('bva', 'Vuelta a', ['Gijón', 'Oviedo'])
      + row('Mesa', mesaChips)
      + `<button class="primary mobonly" data-act="g-fclose">Ver ${filteredGuests().length} invitados</button>`;
  }
  function guestStatsArr(shown) {
    const total = SEC.invitados.data.invitados.length, n = f => shown.filter(f).length;
    return [[shown.length, isFiltering() ? `de ${total} · coinciden con el filtro` : 'personas'], [n(g => g.viene === 'Sí'), 'confirmadas'], [n(g => g.viene === 'Pendiente'), 'pendientes'], [n(g => g.viene === 'No'), 'no vienen'], [n(g => g.tipo === 'Adulto' && g.viene !== 'No'), 'adultos'], [n(g => g.tipo === 'Niño' && g.viene !== 'No'), 'niños']];
  }
  // Actualiza números y colores sin volver a dibujar la tabla (así no se pierde el sitio).
  function refreshGuestStats() {
    const box = $('#tab-invitados .stats'); if (!box) return;
    box.innerHTML = guestStatsArr(filteredGuests()).map(([x, l]) => `<div class="stat"><strong>${x}</strong><span>${l}</span></div>`).join('');
    const fb = $('#gfilters'); if (fb) fb.innerHTML = filtersHtml();
    const fc = $('#tab-invitados .fcount'); if (fc) { const n = FILTER_KEYS.filter(k => guestFilter[k]).length; fc.textContent = n ? ` · ${n}` : ''; }
    const c = $('#tab-invitados .count'); if (c) c.textContent = `${filteredGuests().length} de ${SEC.invitados.data.invitados.length}`;
  }
  function retint(el) {
    const v = el.value, inv = SEC.invitados.data;
    const color = !v ? '' : el.dataset.gmesa !== undefined ? PALETTE[hashIdx(String(SEC.mesas.data.mesas.find(t => t.id === v)?.numero))] : el.dataset.gf === 'grupo' ? (FIXED[norm(v)] || PALETTE[Math.max(0, inv.grupos.indexOf(v)) % PALETTE.length]) : (FIXED[norm(v)] || PALETTE[hashIdx(v)]);
    el.style.background = color; if (!color) el.removeAttribute('style');
  }
  const ssGet = k => { try { return sessionStorage.getItem('boda-' + k); } catch { return null; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem('boda-' + k, v); } catch { /* sin almacenamiento */ } };
  document.addEventListener('toggle', e => { if (e.target.id === 'assoc-box') { ssSet('assoc', e.target.open ? '1' : '0'); if (e.target.open) renderAssoc(); } }, true);
  const guestFilter = (() => { try { return { q: '', grupo: '', subgrupo: '', viene: '', tipo: '', bi: '', bid: '', bv: '', bva: '', mesa: '', ...JSON.parse(ssGet('filtros') || '{}') }; } catch { return { q: '', grupo: '', subgrupo: '', viene: '', tipo: '' }; } })();
  const saveFilters = () => ssSet('filtros', JSON.stringify(guestFilter));
  const fullName = g => `${g?.nombre || ''} ${g?.apellido || ''}`.trim();

  // Columnas de autobús (del cuestionario): Sí/No y desde/hacia dónde.
  function ensureBusCols(inv) {
    let changed = false;
    for (const [name, tipo] of [['Bus ida', 'sino'], ['Bus ida desde', 'lista'], ['Bus vuelta', 'sino'], ['Bus vuelta a', 'lista']]) {
      let c = colOf(inv, name);
      if (!c) { c = { id: uid(), nombre: name, tipo }; inv.columnas.push(c); changed = true; }
      if (c.tipo !== tipo) { c.tipo = tipo; changed = true; }
      if (tipo === 'lista' && !c.opciones) { c.opciones = 'Gijón,Oviedo'; changed = true; }
    }
    return changed;
  }
  // Las columnas Sí/No nunca quedan vacías: lo que no tiene valor es «No».
  function fillSino(inv) {
    let changed = false;
    for (const c of inv.columnas) if (c.tipo === 'sino') for (const g of inv.invitados) if (g.extra[c.id] !== 'Sí' && g.extra[c.id] !== 'No') { g.extra[c.id] = 'No'; changed = true; }
    return changed;
  }
  function ensureCol(inv, nombre, tipo = 'texto') {
    let c = inv.columnas.find(c => norm(c.nombre) === norm(nombre));
    if (!c) { c = { id: uid(), nombre, tipo }; inv.columnas.push(c); if (tipo === 'sino') fillSino(inv); }
    return c.id;
  }
  // Vuelca los datos de una persona del cuestionario a la ficha del invitado.
  function applyResponse(inv, g, r) {
    if (r.asistencia === 'Sí' || r.asistencia === 'No') g.viene = r.asistencia;
    const set = (col, tipo, val) => { if (val) g.extra[ensureCol(inv, col, tipo)] = val; };
    set('Dirección', 'texto', r.direccion); set('Alergias', 'texto', r.alergias);
    set('Bus ida', 'sino', r['bus-ida']); set('Bus ida desde', 'texto', r['bus-ida-origen']);
    set('Bus vuelta', 'sino', r['bus-vuelta']); set('Bus vuelta a', 'texto', r['bus-vuelta-destino']);
  }
  const respKey = r => `${r.id}:${r.persona}`;
  function suggestGuest(inv, r) {
    const n = norm(r.nombre), a = norm(r.apellidos); if (!n) return null;
    const used = new Set(Object.values(inv.vinculos));
    const cand = inv.invitados.filter(g => !used.has(g.id) && norm(g.nombre) === n);
    return cand.find(g => norm(g.apellido) === a) || cand.find(g => { const ga = norm(g.apellido); return ga && a && (ga.startsWith(a) || a.startsWith(ga)); }) || null;
  }
  const newGuest = (nombre = '', apellido = '') => ({ id: uid(), nombre, apellido, viene: 'Pendiente', grupo: '', subgrupo: '', tipo: 'Adulto', extra: {} });

  function renderInvitados() {
    const inv = SEC.invitados.data, list = inv.invitados;
    const vinculado = new Set(Object.values(inv.vinculos));
    const respByKey = new Map((respData?.rows || []).map(r => [respKey(r), r])), respOfGuest = new Map(Object.entries(inv.vinculos).map(([k, gid]) => [gid, respByKey.get(k)]));
    saveFilters();
    const shown = filteredGuests(), filtering = isFiltering(), stats = guestStatsArr(shown);
    const subgrupos = [...new Set(list.map(g => g.subgrupo).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es'));
    const cell = (g, c) => {
      const v = g.extra[c.id] ?? '';
      if (c.tipo === 'sino') return `<select data-gx="${c.id}"${tint(v || 'No')}>${opts(['Sí', 'No'], v || 'No')}</select>`;
      if (c.tipo === 'lista') return `<select data-gx="${c.id}"${tint(v)}>${opts((c.opciones || '').split(',').map(s => s.trim()).filter(Boolean), v, '—')}</select>`;
      if (c.tipo === 'numero') return `<input data-gx="${c.id}" type="number" value="${esc(v)}" />`;
      return `<div class="grow" data-v="${esc(v)}"><textarea class="cell-text" rows="1" data-gx="${c.id}" spellcheck="false">${esc(v)}</textarea></div>`;
    };
    const mm = mesaMap(), mesaList = [...(SEC.mesas?.data.mesas || [])].sort((x, y) => x.numero - y.numero);
    const mesaOpts = cur => `<option value="">—</option>` + mesaList.map(t => `<option value="${t.id}"${cur && cur.id === t.id ? ' selected' : ''}>${esc(mesaLabel(t))}</option>`).join('');
    const pend = respData ? respData.rows.filter(r => !inv.vinculos[respKey(r)]).length : 0;
    $('#tab-invitados').innerHTML = `
      <div class="stats">${stats.map(([x, l]) => `<div class="stat"><strong>${x}</strong><span>${l}</span></div>`).join('')}</div>
      <div class="toolbar tb-main">
        <input type="search" id="g-q" placeholder="Buscar…" value="${esc(guestFilter.q)}" />
        <b class="count">${shown.length} de ${list.length}</b>
        ${filtering ? '<button class="link" data-act="g-clear">Quitar filtros</button>' : ''}
        <button class="secondary fbtn" data-act="g-ftoggle">⚙ Filtros<span class="fcount">${FILTER_KEYS.filter(k => guestFilter[k]).length ? ` · ${FILTER_KEYS.filter(k => guestFilter[k]).length}` : ''}</span></button>
        <span class="grow"></span>
        <button class="primary" data-act="g-add">＋<span class="hide-m"> Invitado</span></button>
        <button class="secondary moretoggle" data-act="g-mtoggle" aria-label="Más acciones">⋯</button>
        <div class="actions-more${ui.mopen ? ' open' : ''}" id="gmore">
          <button class="secondary" data-act="g-col">＋ Columna</button>
          <button class="secondary" data-act="g-grupos">Grupos</button>
          <label class="secondary filebtn">Importar Excel<input type="file" id="g-import" accept=".xlsx,.xls,.csv" hidden /></label>
          <button class="secondary" data-act="alergias" title="Excel con las alergias, ordenadas por mesa">Descargar alergias</button>
          <button class="secondary" data-act="g-copy" title="Copia lo que ves en la tabla para pegarlo en Excel o Word">Copiar tabla</button>
          <button class="secondary" data-act="g-export">Exportar Excel</button>
        </div>
      </div>
      <div class="filters${ui.fopen ? ' open' : ''}" id="gfilters">${filtersHtml()}</div>
      <details class="assoc" id="assoc-box"${ssGet('assoc') === '1' ? ' open' : ''}><summary>Respuestas del cuestionario ${respData ? `· ${pend} sin asociar de ${respData.rows.length}` : ''}</summary><div id="assoc"></div></details>
      <datalist id="dl-sub">${[...new Set(list.map(g => g.subgrupo).filter(Boolean))].sort().map(x => `<option value="${esc(x)}">`).join('')}</datalist><div class="table-wrap tall"><table class="edit"><thead><tr><th>Nombre</th><th>Apellido</th><th>Cuestionario</th><th>Mesa</th><th>¿Viene?</th><th>Grupo</th><th>Subgrupo</th><th>Tipo</th>${inv.columnas.map(c => `<th>${esc(c.nombre)} <button class="x" data-act="g-delcol" data-id="${c.id}" title="Quitar columna">×</button></th>`).join('')}<th></th></tr></thead>
      <tbody>${shown.length ? shown.map(g => `<tr data-id="${g.id}">
        <td><input data-gf="nombre" class="c-nombre" value="${esc(g.nombre)}" /></td><td><input data-gf="apellido" class="c-apellido" value="${esc(g.apellido)}" /></td>
        <td class="center">${(() => {
          if (!vinculado.has(g.id)) return '<span class="pill">sin asociar</span>';
          const r = respOfGuest.get(g.id);
          if (!r) return '<span class="pill ok">✓ asociado</span>';
          const igual = norm(`${r.nombre} ${r.apellidos}`) === norm(fullName(g));
          return igual ? '<span class="pill ok">✓ asociado</span>' : `<span class="pill warn" title="El cuestionario dice: ${esc(`${r.nombre} ${r.apellidos}`.trim())}">≠ ${esc(`${r.nombre} ${r.apellidos}`.trim())}</span> <button class="mini" data-act="g-usename" data-id="${g.id}" title="Poner el nombre y apellidos del cuestionario">Usar este nombre</button>`;
        })()}</td>
        <td><select data-gmesa${tint(mm.has(g.id) ? mm.get(g.id).numero : '', mm.has(g.id) ? mm.get(g.id).numero - 1 : -1)}>${mesaOpts(mm.get(g.id))}</select></td>
        <td><select data-gf="viene"${tint(g.viene)}>${opts(VIENE, g.viene)}</select></td>
        <td><select data-gf="grupo"${tint(g.grupo, inv.grupos.indexOf(g.grupo))}>${opts(inv.grupos, g.grupo, '—')}</select></td><td><input data-gf="subgrupo" list="dl-sub" value="${esc(g.subgrupo)}"${tint(g.subgrupo)} /></td>
        <td><select data-gf="tipo"${tint(g.tipo)}>${opts(['Adulto', 'Niño'], g.tipo)}</select></td>
        ${inv.columnas.map(c => `<td>${cell(g, c)}</td>`).join('')}

        <td class="actions-cell"><button class="delete" data-act="g-del" data-id="${g.id}" aria-label="Eliminar">${TRASH}</button></td></tr>`).join('') : `<tr><td class="empty" colspan="${9 + inv.columnas.length}">${list.length ? 'Ningún invitado coincide con el filtro.' : 'Aún no hay invitados. Añádelos, impórtalos desde Excel o asócialos desde el cuestionario.'}</td></tr>`}</tbody></table></div>`;
    if (ssGet('assoc') === '1') renderAssoc();
  }

  let assocFilter = 'review';
  function renderAssoc() {
    const box = $('#assoc'); if (!box) return;
    if (!respData) { box.innerHTML = '<p class="muted">Cargando respuestas…</p>'; return; }
    const inv = SEC.invitados.data;
    if (!respData.rows.length) { box.innerHTML = '<p class="muted">Todavía no hay respuestas del cuestionario.</p>'; return; }
    const byId = Object.fromEntries(inv.invitados.map(g => [g.id, g]));
    const info = respData.rows.map(r => { const k = respKey(r), linked = byId[inv.vinculos[k]]; return { r, k, linked, sug: !linked && suggestGuest(inv, r) }; });
    const nLinked = info.filter(i => i.linked).length, nReview = info.length - nLinked, nSug = info.filter(i => i.sug).length;
    const list = info.filter(i => assocFilter === 'all' || (assocFilter === 'linked' ? i.linked : !i.linked));
    const row = ({ r, k, linked, sug }) => {
      const name = `${r.nombre} ${r.apellidos}`.trim() || '(sin nombre)';
      const ini = ((r.nombre || '?')[0] + (r.apellidos || '')[0]).toUpperCase().replace(/UNDEFINED/g, '');
      let st;
      if (linked) st = `<span class="pill ok">✓ ${esc(fullName(linked))}</span><button class="mini" data-act="a-pick" data-k="${esc(k)}">Cambiar</button><button class="mini ghost" data-act="a-unlink" data-k="${esc(k)}">Desasociar</button>`;
      else if (sug) st = `<span class="sug">¿Es <b>${esc(fullName(sug))}</b>?</span><button class="mini solid" data-act="a-accept" data-k="${esc(k)}" data-g="${sug.id}">Sí, asociar</button><button class="mini" data-act="a-pick" data-k="${esc(k)}">Es otra persona…</button>`;
      else st = `<span class="sug none">Sin coincidencia</span><button class="mini" data-act="a-pick" data-k="${esc(k)}">Buscar invitado…</button><button class="mini" data-act="a-create" data-k="${esc(k)}">＋ Crear invitado</button>`;
      return `<div class="assoc-row${linked ? ' is-linked' : ''}"><span class="avatar" style="background:${PALETTE[hashIdx(name)]}">${esc(ini)}</span><div class="who"><strong>${esc(name)}</strong><small>${esc(r.tipo)}${r.asistencia ? ` · <span class="pill ${r.asistencia === 'Sí' ? 'ok' : 'no'}">${r.asistencia === 'Sí' ? 'Asiste' : 'No asiste'}</span>` : ''}</small></div><div class="st">${st}</div></div>`;
    };
    const chip = (v, label, n) => `<button class="chip${assocFilter === v ? ' on' : ''}" data-act="a-filter" data-v="${v}">${label} <b>${n}</b></button>`;
    box.innerHTML = `<div class="assoc-bar"><div class="chips">${chip('review', 'Por revisar', nReview)}${chip('linked', 'Asociadas', nLinked)}${chip('all', 'Todas', info.length)}</div><span class="grow"></span>
      <button class="mini solid" data-act="a-auto"${nSug ? '' : ' disabled'}>Aceptar sugerencias (${nSug})</button><button class="mini" data-act="a-sync" title="Vuelve a copiar nombre, apellidos, dirección, alergias y bus desde el cuestionario">Actualizar fichas</button><button class="mini ghost" data-act="a-reload">↻ Recargar</button></div>
      <div class="assoc-list">${list.length ? list.map(row).join('') : `<p class="muted center">${assocFilter === 'review' ? '¡Todo asociado! 🎉' : 'Nada que mostrar.'}</p>`}</div>`;
  }
  // El nombre y los apellidos de la ficha pasan a ser los del cuestionario.
  function applyNames(inv, k, g, r) {
    if (r.nombre) g.nombre = r.nombre;
    if (r.apellidos) g.apellido = r.apellidos;
    (inv.nombresAplicados = inv.nombresAplicados || {})[k] = true;
  }
  // Asociaciones hechas antes de existir esta regla: se aplican una sola vez (luego se respetan tus correcciones a mano).
  function syncNamesOnce() {
    if (!respData || !SEC.invitados) return false;
    const inv = SEC.invitados.data; let changed = false;
    for (const [k, gid] of Object.entries(inv.vinculos)) {
      if (inv.nombresAplicados?.[k]) continue;
      const r = respData.rows.find(x => respKey(x) === k), g = inv.invitados.find(x => x.id === gid);
      if (r && g) { applyNames(inv, k, g, r); changed = true; }
    }
    return changed;
  }
  function link(k, gid) {
    const inv = SEC.invitados.data, r = respData.rows.find(r => respKey(r) === k), g = inv.invitados.find(g => g.id === gid);
    if (!r || !g) return;
    for (const key of Object.keys(inv.vinculos)) if (inv.vinculos[key] === gid) delete inv.vinculos[key];
    inv.vinculos[k] = gid; applyResponse(inv, g, r);
    // El nombre y los apellidos pasan a ser los que escribió la persona en el cuestionario.
    applyNames(inv, k, g, r);
  }

  // Nombres compuestos habituales: "María José Pérez" -> nombre "María José".
  const COMPUESTOS = ['maria jose', 'jose luis', 'jose maria', 'juan carlos', 'jose antonio', 'jose manuel', 'jose miguel', 'jose ignacio', 'jose angel', 'juan jose', 'juan antonio', 'juan manuel', 'luis miguel', 'miguel angel', 'maria del mar', 'maria del carmen', 'maria luisa', 'maria teresa', 'maria isabel', 'maria eugenia', 'maria elena', 'maria victoria', 'maria angeles', 'ana maria', 'ana isabel', 'ana belen', 'rosa maria', 'carlos alberto', 'francisco javier', 'jose carlos', 'jose ramon', 'jesus maria', 'maria pilar', 'maria dolores', 'maria paz', 'maria jesus'];
  function splitName(full) {
    const w = String(full).trim().replace(/\s+/g, ' ').split(' ');
    if (w.length < 2) return [w[0] || '', ''];
    const two = norm(w[0] + ' ' + w[1]);
    const n = w.length > 2 && COMPUESTOS.some(c => two === c) ? 2 : 1;
    return [w.slice(0, n).join(' '), w.slice(n).join(' ')];
  }
  const yesNo = v => { const x = norm(v); return x === 'si' ? 'Sí' : x === 'no' ? 'No' : String(v).trim(); };
  // Columnas conocidas del Excel de invitados -> columna de la ficha (tipo).
  const IMPORT_COLS = { 'direccion': ['Dirección', 'texto'], 'observaciones': ['Notas', 'texto'], 'alergias': ['Alergias', 'texto'], 'invitacion': ['Invitación entregada', 'sino'], 'regalo': ['Regalo', 'sino'], 'cantidad (regalo)': ['Cantidad (regalo)', 'numero'], 'agradecimientos': ['Agradecimiento enviado', 'sino'], 'agradecimiento': ['Agradecimiento enviado', 'sino'], 'bus ida': ['Bus ida', 'sino'], 'bus vuelta': ['Bus vuelta', 'sino'], 'bus ida desde': ['Bus ida desde', 'lista'], 'ida desde': ['Bus ida desde', 'lista'], 'bus vuelta a': ['Bus vuelta a', 'lista'], 'vuelta a': ['Bus vuelta a', 'lista'], 'hora vuelta': ['Hora bus vuelta', 'texto'], 'hora ida': ['Hora bus ida', 'texto'], 'alojamiento': ['Alojamiento', 'texto'], 'menu': ['Menú', 'texto'], 'notas': ['Notas', 'texto'] };
  const IGNORE_COLS = new Set(['mesas', 'mesa', '']);
  const setNote = (g, inv, text) => { const id = ensureCol(inv, 'Notas', 'texto'); g.extra[id] = g.extra[id] ? `${g.extra[id]} · ${text}` : text; };
  function autosize(root = document) {
    const areas = [...root.querySelectorAll('textarea.cell-text')];
    areas.forEach(t => { t.style.height = 'auto'; });
    areas.forEach(t => { t.style.height = Math.max(30, t.scrollHeight + 2) + 'px'; });
  }
  async function importExcel(file) {
    const X = await getXLSX();
    const wb = X.read(await file.arrayBuffer(), { type: 'array' });
    const all = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const hi = all.findIndex(r => r.some(c => /^nombre/.test(norm(c))));
    const head = (hi >= 0 ? all[hi] : []).map(norm), rows = all.slice(hi >= 0 ? hi + 1 : 0).filter(r => r.some(c => String(c).trim()));
    if (!rows.length) return alert('El archivo está vacío.');
    const col = f => head.findIndex(f);
    const iFull = col(h => h === 'nombre y apellidos' || h === 'nombre completo'), iN = col(h => h === 'nombre'), iA = col(h => h === 'apellido' || h === 'apellidos');
    const iViene = col(h => h.replace(/[¿?]/g, '') === 'viene'), iGrupo = col(h => h === 'grupo'), iSub = col(h => h === 'subgrupo'), iTipo = col(h => h.startsWith('adulto'));
    if (hi < 0 && !(iN >= 0)) { head.length = 0; }
    const nameCol = iFull >= 0 ? iFull : iN >= 0 ? iN : 0;
    const inv = SEC.invitados.data;
    if (inv.invitados.length && await ask(`Ya hay ${inv.invitados.length} invitados en la lista. ¿Quieres sustituirlos por los del Excel? (Si no, se cancela la importación y no cambia nada.)`, 'Sustituir')) { inv.invitados = []; inv.vinculos = {}; }
    else if (inv.invitados.length) return;
    ensureBusCols(inv);
    if (!inv.invitados.length) inv.grupos = [];   // los grupos de la lista sustituyen a los de ejemplo
    const K = g => `${norm(g.nombre)}|${norm(g.apellido)}|${norm(g.grupo)}|${norm(g.subgrupo)}`;
    const seen = new Set(inv.invitados.map(K));
    const extras = head.map((h, i) => (i === nameCol || i === iN || i === iA || i === iViene || i === iGrupo || i === iSub || i === iTipo || IGNORE_COLS.has(h) ? null : (IMPORT_COLS[h] || [String(all[hi][i]).trim(), 'texto'])));
    let added = 0, skipped = 0;
    for (const r of rows.slice(0)) {
      let nombre, apellido;
      if (iFull >= 0 || iA < 0) [nombre, apellido] = splitName(r[nameCol]); else { nombre = String(r[iN] ?? '').trim(); apellido = String(r[iA] ?? '').trim(); }
      if (!nombre && !apellido) continue;
      const grupo = iGrupo >= 0 ? String(r[iGrupo]).trim() : '';
      const g = newGuest(nombre, apellido);
      g.grupo = grupo; g.subgrupo = iSub >= 0 ? String(r[iSub]).trim() : '';
      if (iTipo >= 0 && /^ni/.test(norm(r[iTipo]))) g.tipo = 'Niño';
      if (iViene >= 0) { const v = norm(r[iViene]); g.viene = v === 'si' ? 'Sí' : v === 'no' ? 'No' : 'Pendiente'; if (v && !['si', 'no', 'pendiente'].includes(v)) setNote(g, inv, String(r[iViene]).trim()); }
      extras.forEach((c, i) => { const val = String(r[i] ?? '').trim(); if (!c || !val || norm(val) === 'no viene' && c[0] !== 'Dirección' && c[0] !== 'Notas') return; if (norm(val) === 'no viene') return; if (c[0] === 'Notas') return setNote(g, inv, val); g.extra[ensureCol(inv, c[0], c[1])] = c[1] === 'sino' ? yesNo(val) : c[1] === 'numero' ? (Number(val) ? String(Number(val)) : '') : val; });
      if (seen.has(K(g))) { skipped++; continue; }   // ya estaba antes de importar (así se puede repetir la importación sin duplicar)
      inv.invitados.push(g); added++;
      if (g.grupo && !inv.grupos.includes(g.grupo)) inv.grupos.push(g.grupo);
    }
    ensureBusCols(inv); fillSino(inv); markDirty('invitados'); renderInvitados(); alert(`Se han añadido ${added} invitados.${skipped ? ` Se han omitido ${skipped} (ya estaban).` : ''}`);
  }
  let excelJsPromise;
  const getExcelJS = () => excelJsPromise || (excelJsPromise = new Promise((res, rej) => {
    if (window.ExcelJS) return res(window.ExcelJS);
    const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    sc.onload = () => res(window.ExcelJS); sc.onerror = () => rej(new Error('No se ha podido cargar la librería de Excel.')); document.head.appendChild(sc);
  }));
  // Excel con la misma estructura que la lista original: hoja «1) Info invitados», tabla desde B2, columna A estrecha y paneles fijos.
  const EXPORT_COLS = [['NOMBRE Y APELLIDOS', 29], ['MESAS', 7.5], ['INVITACIÓN', 12.4], ['¿VIENE?', 11.6], ['GRUPO', 22], ['SUBGRUPO', 22], ['ADULTO/NIÑO', 14.1], ['DIRECCIÓN', 30], ['ALERGIAS', 18], ['BUS IDA', 15.8], ['BUS VUELTA', 15.8], ['HORA VUELTA', 12.9], ['REGALO', 10], ['CANTIDAD (REGALO)', 19.2], ['AGRADECIMIENTOS', 22.6]];
  const EXPORT_MAP = { 'INVITACIÓN': 'Invitación entregada', 'DIRECCIÓN': 'Dirección', 'ALERGIAS': 'Alergias', 'BUS IDA': 'Bus ida', 'BUS VUELTA': 'Bus vuelta', 'HORA VUELTA': 'Hora bus vuelta', 'REGALO': 'Regalo', 'CANTIDAD (REGALO)': 'Cantidad (regalo)', 'AGRADECIMIENTOS': 'Agradecimiento enviado' };
  async function exportGuests() {
    const E = await getExcelJS(), inv = SEC.invitados.data, mesas = SEC.mesas?.data.mesas || [];
    const colByName = Object.fromEntries(inv.columnas.map(c => [norm(c.nombre), c]));
    const used = new Set(Object.values(EXPORT_MAP).map(norm));
    const extraCols = inv.columnas.filter(c => !used.has(norm(c.nombre)));      // Notas y columnas propias, al final
    const val = (g, name) => { const c = colByName[norm(name)]; const v = c ? (g.extra[c.id] ?? '') : ''; return c?.tipo === 'sino' ? (v === 'Sí' ? 'Si' : v) : c?.tipo === 'numero' && v !== '' ? Number(v) : v; };
    const heads = [...EXPORT_COLS.map(([h]) => h), ...extraCols.map(c => c.nombre.toUpperCase())];
    const rows = inv.invitados.map(g => {
      const m = mesas.find(m => m.invitados.includes(g.id));
      return heads.map((h, i) => {
        if (h === 'NOMBRE Y APELLIDOS') return fullName(g);
        if (h === 'MESAS') return m ? m.numero : '-';
        if (h === '¿VIENE?') return g.viene === 'Sí' ? 'Si' : g.viene === 'Pendiente' ? 'Tal vez' : g.viene;
        if (h === 'GRUPO') return g.grupo; if (h === 'SUBGRUPO') return g.subgrupo; if (h === 'ADULTO/NIÑO') return g.tipo;
        if (EXPORT_MAP[h]) return val(g, EXPORT_MAP[h]);
        const c = extraCols[i - EXPORT_COLS.length]; return c ? val(g, c.nombre) : '';
      });
    });
    const wb = new E.Workbook(), ws = wb.addWorksheet('1) Info invitados', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2, showGridLines: false }] });
    ws.getColumn(1).width = 1.4;
    heads.forEach((h, i) => { ws.getColumn(i + 2).width = EXPORT_COLS[i]?.[1] || 20; });
    ws.addTable({ name: 'Table_1', ref: 'B2', headerRow: true, totalsRow: false, style: { theme: 'TableStyleMedium7', showRowStripes: true }, columns: heads.map(h => ({ name: h, filterButton: true })), rows: rows.length ? rows : [heads.map(() => '')] });
    ws.getRow(2).height = 24; ws.getRow(2).font = { bold: true, name: 'Calibri', size: 11 };
    ws.eachRow((row, n) => { if (n > 2) row.alignment = { vertical: 'middle', wrapText: false }; });
    ws.getColumn(heads.indexOf('DIRECCIÓN') + 2).alignment = { vertical: 'middle', wrapText: true };
    const buf = await wb.xlsx.writeBuffer();
    download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `LISTA_INVITADOS_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // Alergias: la columna «Alergias» (o «Intolerancias») de la ficha; se ignoran respuestas tipo «no», «ninguna»…
  const sinAlergia = v => { const t = String(v ?? '').trim().replace(/[.!]+$/, '').toLowerCase(); return !t || /^(no|-{1,}|n\/a|na|ninguna?|ningún|ninguno|nada|sin|ok|correcto|todo bien)$/.test(t) || /^(sin |no tengo|no hay|ninguna? )/.test(t); };
  function alergiaDe(g) {
    const inv = SEC.invitados.data;
    for (const c of inv.columnas) if (/alergia|intoleranc/i.test(c.nombre)) { const v = g.extra[c.id]; if (!sinAlergia(v)) return String(v).trim(); }
    return '';
  }
  async function descargarAlergias() {
    const E = await getExcelJS(), inv = SEC.invitados.data, mm = mesaMap();
    const filas = inv.invitados.map(g => ({ mesa: mm.get(g.id), nombre: fullName(g), grupo: g.grupo, alergia: alergiaDe(g) })).filter(f => f.alergia)
      .sort((a, b) => (a.mesa ? a.mesa.numero : 1e9) - (b.mesa ? b.mesa.numero : 1e9) || a.nombre.localeCompare(b.nombre, 'es'));
    const wb = new E.Workbook(), ws = wb.addWorksheet('Alergias', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { fitToPage: true, fitToWidth: 1, orientation: 'portrait' } });
    const heads = ['Mesa', 'Invitado', 'Grupo', 'Alergia / intolerancia'], TINTA = 'FF536048', LINEA = 'FFD9D2BE', thin = { style: 'thin', color: { argb: LINEA } }, borde = { top: thin, left: thin, bottom: thin, right: thin };
    ws.columns = [{ width: 22 }, { width: 32 }, { width: 22 }, { width: 46 }];
    ws.mergeCells('A1:D1'); Object.assign(ws.getCell('A1'), { value: 'Boda Cris y Pela' }); ws.getCell('A1').font = { name: 'Georgia', size: 20, bold: true, color: { argb: 'FFB28A51' } }; ws.getRow(1).height = 30;
    ws.mergeCells('A2:D2'); ws.getCell('A2').value = 'Listado de alergias e intolerancias'; ws.getCell('A2').font = { size: 14, bold: true, color: { argb: TINTA } };
    ws.mergeCells('A3:D3'); ws.getCell('A3').value = 'Sábado, 24 de julio de 2027'; ws.getCell('A3').font = { size: 10, color: { argb: 'FF7A736A' } };
    const head = ws.getRow(5); head.values = heads; head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.height = 20;
    heads.forEach((_, i) => { const c = head.getCell(i + 1); c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINTA } }; c.border = borde; });
    filas.forEach((f, i) => {
      const row = ws.getRow(6 + i); row.values = [f.mesa ? mesaLabel(f.mesa) : 'Sin mesa', f.nombre, f.grupo, f.alergia];
      for (let c = 1; c <= 4; c++) row.getCell(c).border = borde; row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    });
    if (!filas.length) ws.getCell('A6').value = 'Todavía no hay alergias registradas.';
    download(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Alergias_boda_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  const colDialog = $('#dlg-col');
  $('#dlg-col-name').innerHTML = SUGERIDAS.map(([n]) => `<option value="${esc(n)}">`).join('');
  $('#dlg-col-form').onsubmit = e => {
    e.preventDefault(); const f = e.target, nombre = f.nombre.value.trim(); if (!nombre) return;
    const inv = SEC.invitados.data;
    inv.columnas.push({ id: uid(), nombre, tipo: f.tipo.value, ...(f.tipo.value === 'lista' ? { opciones: f.opciones.value } : {}) });
    fillSino(inv); markDirty('invitados'); colDialog.close(); f.reset(); renderInvitados();
  };
  $('#dlg-col-form').nombre.addEventListener('input', e => { const s = SUGERIDAS.find(([n]) => n === e.target.value); if (s) e.target.form.tipo.value = s[1]; });
  $('#dlg-col-cancel').onclick = () => colDialog.close();

  const gruposDialog = $('#dlg-grupos');
  $('#dlg-grupos-form').onsubmit = e => {
    e.preventDefault();
    SEC.invitados.data.grupos = e.target.grupos.value.split('\n').map(s => s.trim()).filter(Boolean);
    markDirty('invitados'); gruposDialog.close(); renderInvitados();
  };
  $('#dlg-grupos-cancel').onclick = () => gruposDialog.close();

  async function invitadosClick(act, el) {
    const inv = SEC.invitados.data;
    if (act === 'g-add') { inv.invitados.push(newGuest()); fillSino(inv); markDirty('invitados'); renderInvitados(); const rows = document.querySelectorAll('#tab-invitados tbody tr'); rows[rows.length - 1]?.querySelector('input')?.focus(); }
    else if (act === 'g-del') { const g = inv.invitados.find(g => g.id === el.dataset.id); if (await ask(`Se eliminará a ${fullName(g) || 'este invitado'}.`)) { inv.invitados = inv.invitados.filter(x => x.id !== g.id); SEC.mesas.data.mesas.forEach(t => { t.invitados = t.invitados.map(x => (x === g.id ? '' : x)); }); markDirty('mesas'); for (const k of Object.keys(inv.vinculos)) if (inv.vinculos[k] === g.id) delete inv.vinculos[k]; markDirty('invitados'); renderInvitados(); } }
    else if (act === 'g-f') { const k = el.dataset.k; guestFilter[k] = guestFilter[k] === el.dataset.v ? '' : el.dataset.v; if (k === 'grupo' && guestFilter.subgrupo && !inv.invitados.some(g => g.grupo === guestFilter.grupo && g.subgrupo === guestFilter.subgrupo) && guestFilter.grupo) guestFilter.subgrupo = ''; renderInvitados(); }
    else if (act === 'g-usename') {
      const g = inv.invitados.find(x => x.id === el.dataset.id), k = Object.keys(inv.vinculos).find(x => inv.vinculos[x] === g.id), r = respData?.rows.find(x => respKey(x) === k);
      if (g && r) { applyNames(inv, k, g, r); markDirty('invitados'); renderInvitados(); }
    }
    else if (act === 'g-ftoggle') { ui.fopen = !ui.fopen; ui.mopen = false; $('#gfilters').classList.toggle('open', ui.fopen); $('#gmore').classList.remove('open'); }
    else if (act === 'g-fclose') { ui.fopen = false; $('#gfilters').classList.remove('open'); }
    else if (act === 'g-mtoggle') { ui.mopen = !ui.mopen; ui.fopen = false; $('#gmore').classList.toggle('open', ui.mopen); $('#gfilters').classList.remove('open'); }
    else if (act === 'g-clear') { Object.assign(guestFilter, { q: '', grupo: '', subgrupo: '', viene: '', tipo: '', bi: '', bid: '', bv: '', bva: '', mesa: '' }); renderInvitados(); }
    else if (act === 'g-col') colDialog.showModal();
    else if (act === 'g-delcol') { const c = inv.columnas.find(c => c.id === el.dataset.id); if (await ask(`Se quitará la columna «${c.nombre}» con todos sus datos.`, 'Quitar')) { inv.columnas = inv.columnas.filter(x => x.id !== c.id); inv.invitados.forEach(g => delete g.extra[c.id]); markDirty('invitados'); renderInvitados(); } }
    else if (act === 'g-grupos') { $('#dlg-grupos-form').grupos.value = inv.grupos.join('\n'); gruposDialog.showModal(); }
    else if (act === 'alergias') descargarAlergias().catch(e => alert(e.message));
    else if (act === 'g-copy') {
      const cols = inv.columnas, rows = filteredGuests();
      const head = ['Nombre', 'Apellido', '¿Viene?', 'Grupo', 'Subgrupo', 'Tipo', ...cols.map(c => c.nombre)];
      const clean = v => String(v ?? '').replace(/[\t\r\n]+/g, ' ');
      const tsv = [head, ...rows.map(g => [g.nombre, g.apellido, g.viene, g.grupo, g.subgrupo, g.tipo, ...cols.map(c => g.extra[c.id] ?? '')])].map(r => r.map(clean).join('\t')).join('\n');
      try { await navigator.clipboard.writeText(tsv); setSave(`Copiadas ${rows.length} filas ✓`); } catch { prompt('Copia con Ctrl+C:', tsv.slice(0, 20000)); }
    }
    else if (act === 'g-export') exportGuests().catch(e => alert(e.message));
    else if (act === 'a-pick') {
      const k = el.dataset.k, r = respData.rows.find(x => respKey(x) === k), used = new Set(Object.values(inv.vinculos));
      openPicker({ title: `Asociar a ${`${r.nombre} ${r.apellidos}`.trim()}`, includeLabel: 'Mostrar también los ya asociados', q: r.nombre,
        candidate: (g, all) => all || !used.has(g.id), badge: g => (used.has(g.id) ? 'ya asociado' : ''),
        onPick: gid => { link(k, gid); markDirty('invitados'); renderInvitados(); } });
    }
    else if (act === 'a-filter') { assocFilter = el.dataset.v; renderAssoc(); }
    else if (act === 'a-accept') { link(el.dataset.k, el.dataset.g); markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-unlink') { delete inv.vinculos[el.dataset.k]; markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-create') { const r = respData.rows.find(r => respKey(r) === el.dataset.k), g = newGuest(r.nombre, r.apellidos); inv.invitados.push(g); fillSino(inv); link(el.dataset.k, g.id); markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-auto') { for (const r of respData.rows) { if (inv.vinculos[respKey(r)]) continue; const g = suggestGuest(inv, r); if (g) link(respKey(r), g.id); } markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-sync') { for (const [k, gid] of Object.entries(inv.vinculos)) { const r = respData.rows.find(r => respKey(r) === k), g = inv.invitados.find(g => g.id === gid); if (r && g) { applyResponse(inv, g, r); applyNames(inv, k, g, r); } } markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-reload') { await loadRespuestas(); renderInvitados(); }
  }
  function invitadosInput(el, isChange) {
    const inv = SEC.invitados.data;
    if (el.id === 'g-q') { guestFilter.q = el.value; saveFilters(); if (isChange) return; clearTimeout(invitadosInput.t); invitadosInput.t = setTimeout(() => { const pos = el.selectionStart; renderInvitados(); const n = $('#g-q'); n.focus(); n.setSelectionRange(pos, pos); }, 160); return; }
    if (el.id === 'g-grupo') { guestFilter.grupo = el.value; return renderInvitados(); }
    if (el.id === 'g-viene') { guestFilter.viene = el.value; return renderInvitados(); }
    if (el.id === 'g-subgrupo') { guestFilter.subgrupo = el.value; return renderInvitados(); }
    if (el.id === 'g-tipo') { guestFilter.tipo = el.value; return renderInvitados(); }
    if (el.id === 'g-import') { if (el.files[0]) importExcel(el.files[0]).catch(e => alert(e.message)); el.value = ''; return; }
    if (el.dataset.assoc !== undefined) { if (el.value) { link(el.dataset.assoc, el.value); markDirty('invitados'); renderInvitados(); } return; }
    if (el.dataset.gmesa !== undefined) {
      const tr0 = el.closest('tr[data-id]'), gid = tr0?.dataset.id, data = SEC.mesas.data;
      data.mesas.forEach(t => { t.invitados = t.invitados.map(x => (x === gid ? '' : x)); });
      if (el.value) {
        const t = data.mesas.find(x => x.id === el.value); let i = 0;
        while (i < t.plazas && t.invitados[i]) i++;
        if (i >= t.plazas) { alert(`La ${mesaLabel(t)} está llena (${t.plazas} plazas).`); markDirty('mesas'); return renderInvitados(); }
        while (t.invitados.length < i) t.invitados.push('');
        t.invitados[i] = gid;
      }
      markDirty('mesas'); retint(el); refreshGuestStats(); return;
    }
    const tr = el.closest('tr[data-id]'); if (!tr) return;
    const g = inv.invitados.find(g => g.id === tr.dataset.id); if (!g) return;
    if (el.dataset.gf) g[el.dataset.gf] = el.value; else if (el.dataset.gx) g.extra[el.dataset.gx] = el.value; else return;
    markDirty('invitados');
    if (el.classList.contains('cell-text')) el.parentNode.dataset.v = el.value;
    if (el.dataset.gf === 'subgrupo' || el.tagName === 'SELECT') retint(el);
    refreshGuestStats();
  }

  /* ================= MESAS ================= */
  const TIPOS_MESA = { redonda: ['Redonda', 10], cuadrada: ['Cuadrada', 8], rectangular: ['Rectangular', 14] };
  const initials = g => ((g?.nombre || '?')[0] + (g?.apellido || '')[0]).toUpperCase().replace('UNDEFINED', '');
  // Geometría de la mesa: el tamaño crece con el número de sillas para que nunca se superpongan (sillas de 10 de radio, separadas 26).
  function mesaGeom(m) {
    const n = m.plazas, G = 26, OFF = 17, pts = [];
    if (m.tipo === 'redonda') {
      const R = Math.max(56, (n * G) / (2 * Math.PI)), c = R + 22, r = Math.max(32, R - OFF - 5);
      for (let i = 0; i < n; i++) { const an = (i / n) * 2 * Math.PI - Math.PI / 2; pts.push([c + R * Math.cos(an), c + R * Math.sin(an)]); }
      return { vw: 2 * c, vh: 2 * c, shape: { t: 'c', cx: c, cy: c, r }, pts };
    }
    if (m.tipo === 'cuadrada') {
      const cnt = [0, 0, 0, 0]; for (let i = 0; i < n; i++) cnt[[0, 2, 1, 3][i % 4]]++;     // arriba, derecha, abajo, izquierda
      const [top, right, bottom, left] = [cnt[0], cnt[1], cnt[2], cnt[3]], S = Math.max(76, Math.max(top, right, bottom, left) * G + 12), M = 34, vw = S + 2 * M, x0 = M, y0 = M;
      for (let i = 0; i < top; i++) pts.push([x0 + (S * (i + 1)) / (top + 1), y0 - OFF]);
      for (let i = 0; i < right; i++) pts.push([x0 + S + OFF, y0 + (S * (i + 1)) / (right + 1)]);
      for (let i = bottom - 1; i >= 0; i--) pts.push([x0 + (S * (i + 1)) / (bottom + 1), y0 + S + OFF]);
      for (let i = left - 1; i >= 0; i--) pts.push([x0 - OFF, y0 + (S * (i + 1)) / (left + 1)]);
      return { vw, vh: vw, shape: { t: 'r', x: x0, y: y0, w: S, h: S }, pts };
    }
    const ends = m.cabecera && n >= 2 ? 2 : 0, rest = n - ends, top = Math.ceil(rest / 2), bottom = rest - top, H = 50, M = 34;
    const W = Math.max(120, Math.max(top, bottom) * G + 14), x0 = M + (ends ? 6 : 0), y0 = M, vw = W + 2 * M + (ends ? 12 : 0), vh = H + 2 * M;
    for (let i = 0; i < top; i++) pts.push([x0 + (W * (i + 1)) / (top + 1), y0 - OFF]);
    if (ends) pts.push([x0 + W + OFF, y0 + H / 2]);
    for (let i = bottom - 1; i >= 0; i--) pts.push([x0 + (W * (i + 1)) / (bottom + 1), y0 + H + OFF]);
    if (ends) pts.push([x0 - OFF, y0 + H / 2]);
    return { vw, vh, shape: { t: 'r', x: x0, y: y0, w: W, h: H }, pts };
  }
  function mesaSvg(m, byId) {
    const { vw, vh, shape, pts } = mesaGeom(m), cx = shape.t === 'c' ? shape.cx : shape.x + shape.w / 2, cy = shape.t === 'c' ? shape.cy : shape.y + shape.h / 2;
    const body = shape.t === 'c' ? `<circle cx="${cx}" cy="${cy}" r="${shape.r}" class="mesa-shape" />` : `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="6" class="mesa-shape" />`;
    return `<svg viewBox="0 0 ${vw.toFixed(0)} ${vh.toFixed(0)}" class="mesa-svg" style="max-width:${Math.min(360, Math.round(vw * 1.5))}px" aria-hidden="true">${body}<text x="${cx}" y="${cy + 7}" text-anchor="middle" class="mesa-num">${m.presidencial ? '★' : m.numero}</text>${pts.map(([x, y], i) => { const g = byId[m.invitados[i]]; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" class="silla${g ? ' ocupada' : ''}" /><text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle" class="silla-t">${g ? esc(initials(g)) : i + 1}</text>`; }).join('')}</svg>`;
  }
  function renderMesas() {
    const guests = SEC.invitados.data.invitados, byId = Object.fromEntries(guests.map(g => [g.id, g])), mesas = SEC.mesas.data.mesas;
    const seated = new Set(mesas.flatMap(m => m.invitados.filter(Boolean)).filter(id => byId[id]));
    const sin = guests.filter(g => g.viene !== 'No' && !seated.has(g.id));
    const plazas = mesas.reduce((s, m) => s + m.plazas, 0), conAlergia = [...seated].filter(id => alergiaDe(byId[id])).length;
    const card = m => {
      const ocup = m.invitados.slice(0, m.plazas).filter(id => byId[id]).length, pct = Math.round((ocup / m.plazas) * 100);
      const alerg = m.invitados.slice(0, m.plazas).filter(id => byId[id] && alergiaDe(byId[id])).length;
      return `<article class="mcard${m.presidencial ? ' pres' : ''}${UI_EDIT.has(m.id) ? ' editing' : ''}" data-id="${m.id}">
        <header><span class="mnum">${m.presidencial ? '★' : m.numero}</span><input data-mf="nombre" placeholder="Nombre de la mesa (opcional)" value="${esc(m.nombre)}" /><button type="button" class="edit-btn" data-edit aria-label="Editar">${UI_EDIT.has(m.id) ? '✓ Listo' : '✎ Editar'}</button><button class="delete" data-act="m-del" aria-label="Eliminar mesa" title="Eliminar mesa">${TRASH}</button></header>
        <div class="mopts">
          <div class="seg" role="group" aria-label="Forma de la mesa">${Object.entries(TIPOS_MESA).map(([t, [l]]) => `<button class="${m.tipo === t ? 'on' : ''}" data-act="m-type" data-t="${t}">${l}</button>`).join('')}</div>
          <div class="stepper" role="group" aria-label="Plazas"><button data-act="m-plazas" data-d="-1" aria-label="Menos plazas">−</button><span>${m.plazas} plazas</span><button data-act="m-plazas" data-d="1" aria-label="Más plazas">＋</button></div>
          <label class="numlab">Nº <input data-mf="numero" type="number" min="1" value="${m.numero}" /></label>
          <button class="chipbtn${m.presidencial ? ' on' : ''}" data-act="m-pres">★ Presidencial</button>
          ${m.tipo === 'rectangular' ? `<button class="chipbtn${m.cabecera ? ' on' : ''}" data-act="m-cab">Con cabecera</button>` : ''}
        </div>
        <div class="mfill"><div class="bar"><i style="width:${pct}%"></i></div><span>${ocup}/${m.plazas} sentados${alerg ? ` · <b class="warn-t">⚠ ${alerg} con alergia</b>` : ''}</span></div>
        ${mesaSvg(m, byId)}
        <ol class="mseats">${Array.from({ length: m.plazas }, (_, i) => {
          const gg = byId[m.invitados[i]], al = gg ? alergiaDe(gg) : '';
          return `<li class="${gg ? 'ocupada' : ''}" data-i="${i}"><span class="seat-print">${i + 1}. ${esc(gg ? fullName(gg) : '—')}${al ? ` ⚠ ${esc(al)}` : ''}</span><span class="sn">${i + 1}</span>
            <button class="seatbtn" data-act="m-seat" data-i="${i}" title="${gg ? 'Cambiar' : 'Elegir invitado'}">${gg ? `<strong>${esc(fullName(gg) || '(sin nombre)')}</strong>${gg.grupo ? `<em>${esc(gg.grupo)}${gg.subgrupo ? ' · ' + esc(gg.subgrupo) : ''}</em>` : ''}` : '<span class="libre">＋ Elegir invitado…</span>'}</button>
            ${al ? `<small class="alerg" title="Alergia o intolerancia">⚠ ${esc(al)}</small>` : ''}${gg ? `<button class="x2" data-act="m-unseat" data-i="${i}" aria-label="Quitar de la silla" title="Quitar de la silla">×</button>` : ''}</li>`;
        }).join('')}</ol></article>`;
    };
    $('#tab-mesas').innerHTML = `
      <div class="stats"><div class="stat"><strong>${mesas.length}</strong><span>mesas</span></div><div class="stat"><strong>${plazas}</strong><span>plazas</span></div><div class="stat"><strong>${seated.size}</strong><span>sentados</span></div><div class="stat"><strong>${sin.length}</strong><span title="No cuentan los que no vienen">sin mesa</span></div><div class="stat"><strong>${conAlergia}</strong><span>sentados con alergia</span></div></div>
      <div class="toolbar">${Object.entries(TIPOS_MESA).map(([t, [l]]) => `<button class="primary" data-act="m-add" data-t="${t}">＋ ${l}</button>`).join('')}<span class="grow"></span><button class="secondary" data-act="alergias">Descargar alergias</button><button class="secondary" data-act="m-print">Imprimir</button></div>
      ${sin.length ? `<details class="assoc"><summary>Invitados sin mesa (${sin.length})</summary><p class="muted">${sin.map(g => esc(fullName(g) || '(sin nombre)')).join(' · ')}</p></details>` : ''}
      <div class="cards">${mesas.length ? [...mesas].sort((a, b) => a.numero - b.numero).map(card).join('') : '<p class="empty">Añade tu primera mesa con los botones de arriba. Los invitados salen de la pestaña Invitados.</p>'}</div>`;
  }

  /* ---- selector de invitado con buscador, dividido por grupo y subgrupo (sillas y asociación con el cuestionario) ---- */
  const seatDlg = $('#dlg-seat');
  let pickCtx = null;
  function renderPicker() {
    const inv = SEC.invitados.data, q = norm($('#seat-q').value), all = $('#seat-seated').checked;
    const cand = inv.invitados.filter(g => pickCtx.candidate(g, all) && (!q || norm(`${fullName(g)} ${g.grupo} ${g.subgrupo}`).includes(q)));
    const groups = [...new Set([...inv.grupos, ...cand.map(g => g.grupo)])].filter(gr => cand.some(g => g.grupo === gr));
    const html = groups.map(gr => {
      const ofG = cand.filter(g => g.grupo === gr), subs = [...new Set(ofG.map(g => g.subgrupo))].sort((x, y) => (x === '') - (y === '') || x.localeCompare(y, 'es'));
      return `<section class="sgroup"><h4 style="background:${gr ? PALETTE[Math.max(0, inv.grupos.indexOf(gr)) % PALETTE.length] : '#efe6d2'}">${esc(gr || 'Sin grupo')} <span>${ofG.length}</span></h4>${subs.map(sg => `${sg ? `<h5>${esc(sg)}</h5>` : ''}<div class="sguests">${ofG.filter(g => g.subgrupo === sg).sort((x, y) => fullName(x).localeCompare(fullName(y), 'es')).map(g => { const bd = pickCtx.badge(g), al = alergiaDe(g); return `<button data-pick="${g.id}">${esc(fullName(g) || '(sin nombre)')}${g.viene === 'Pendiente' ? '<i>pendiente</i>' : ''}${bd ? `<i class="in">${esc(bd)}</i>` : ''}${al ? '<i class="al">⚠</i>' : ''}</button>`; }).join('')}</div>`).join('')}</section>`;
    }).join('');
    $('#seat-list').innerHTML = html || '<p class="muted center">Nadie coincide. Prueba a cambiar la búsqueda o a mostrar también los ya colocados.</p>';
    $('#seat-count').textContent = `${cand.length} invitados`;
  }
  function openPicker(ctx) {
    pickCtx = ctx; $('#seat-title').textContent = ctx.title; $('#seat-all-label').textContent = ctx.includeLabel;
    $('#seat-q').value = ctx.q || ''; $('#seat-seated').checked = false; renderPicker(); seatDlg.showModal(); $('#seat-q').focus(); $('#seat-q').select();
  }
  function openSeat(mesaId, i) {
    const m = SEC.mesas.data.mesas.find(x => x.id === mesaId), mm = mesaMap();
    openPicker({
      title: `${mesaLabel(m)} · silla ${i + 1}`, includeLabel: 'Mostrar también los que ya tienen mesa',
      candidate: (g, all) => g.viene !== 'No' && (all || !mm.has(g.id) || mm.get(g.id).id === mesaId),
      badge: g => (mm.has(g.id) ? mesaLabel(mm.get(g.id)) : ''),
      onPick: gid => {
        SEC.mesas.data.mesas.forEach(x => { x.invitados = x.invitados.map(id => (id === gid ? '' : id)); });
        while (m.invitados.length <= i) m.invitados.push('');
        m.invitados[i] = gid; markDirty('mesas'); renderMesas();
      }
    });
  }
  if (seatDlg) {
    let pickTimer;
    $('#seat-q').addEventListener('input', () => { clearTimeout(pickTimer); pickTimer = setTimeout(renderPicker, 80); });
    $('#seat-seated').addEventListener('change', renderPicker);
    const choose = gid => { const ctx = pickCtx; seatDlg.close(); ctx.onPick(gid); };
    $('#seat-q').addEventListener('keydown', e => { if (e.key === 'Enter') { const first = $('#seat-list [data-pick]'); if (first) choose(first.dataset.pick); } });
    $('#seat-list').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) choose(b.dataset.pick); });
    $('#seat-close').onclick = () => seatDlg.close();
  }
  function mesasEvent(act, el, ev) {
    const data = SEC.mesas.data, art = el.closest('[data-id]'), m = art && data.mesas.find(m => m.id === art.dataset.id);
    if (act === 'm-add') { const t = el.dataset.t; let n = 1; const used = new Set(data.mesas.map(m => m.numero)); while (used.has(n)) n++; data.mesas.push({ id: uid(), numero: n, nombre: '', tipo: t, plazas: TIPOS_MESA[t][1], invitados: [] }); markDirty('mesas'); renderMesas(); }
    else if (act === 'alergias') descargarAlergias().catch(e => alert(e.message));
    else if (act === 'm-print') window.print();
    else if (act === 'm-seat') openSeat(m.id, Number(el.dataset.i));
    else if (act === 'm-unseat') { m.invitados[Number(el.dataset.i)] = ''; markDirty('mesas'); renderMesas(); }
    else if (act === 'm-type') { m.tipo = el.dataset.t; if (m.tipo !== 'rectangular') m.cabecera = false; markDirty('mesas'); renderMesas(); }
    else if (act === 'm-plazas') { m.plazas = Math.max(1, Math.min(40, m.plazas + Number(el.dataset.d))); m.invitados = m.invitados.slice(0, m.plazas); markDirty('mesas'); renderMesas(); }
    else if (act === 'm-pres') { const v = !m.presidencial; data.mesas.forEach(x => { x.presidencial = false; }); m.presidencial = v; markDirty('mesas'); renderMesas(); }
    else if (act === 'm-cab') { m.cabecera = !m.cabecera; markDirty('mesas'); renderMesas(); }
    else if (act === 'm-del') ask(`Se eliminará la mesa ${m.numero}${m.nombre ? ' · ' + m.nombre : ''}. Los invitados quedan sin mesa.`).then(ok => { if (ok) { data.mesas = data.mesas.filter(x => x.id !== m.id); markDirty('mesas'); renderMesas(); } });
    else if (el.dataset.seat !== undefined && ev === 'change') {
      const i = Number(el.dataset.seat); data.mesas.forEach(x => x.invitados = x.invitados.map(id => id === el.value ? '' : id));
      while (m.invitados.length <= i) m.invitados.push(''); m.invitados[i] = el.value;
      markDirty('mesas'); renderMesas();
    } else if (el.dataset.mf && m) {
      const f = el.dataset.mf;
      if (f === 'numero') { const n = Math.floor(Number(el.value)); if (!(n > 0) || data.mesas.some(x => x.id !== m.id && x.numero === n)) { if (ev === 'change') { alert('Ese número de mesa no es válido o ya está en uso.'); renderMesas(); } return; } m.numero = n; }
      else if (f === 'plazas') { const n = Math.max(1, Math.min(40, Math.floor(Number(el.value)) || 1)); m.plazas = n; m.invitados = m.invitados.slice(0, n); if (ev !== 'change') { markDirty('mesas'); return; } }
      else if (f === 'presidencial') { data.mesas.forEach(x => x.presidencial = false); m.presidencial = el.checked; }
      else if (f === 'cabecera') m.cabecera = el.checked;
      else m[f] = el.value;
      markDirty('mesas'); if (ev === 'change') renderMesas();
    }
  }

  /* ================= PRESUPUESTO ================= */
  const estimadoDe = p => (p.tipo === 'menu' ? (Number(p.precioUnidad) || 0) * (Number(p.cantidad) || 0) : Number(p.estimado) || 0);
  const catsOf = list => [...new Set(list.map(p => p.categoria))];
  function renderPresupuesto() {
    const { partidas } = SEC.presupuesto.data, guests = SEC.invitados.data.invitados;
    const adultos = guests.filter(g => g.tipo === 'Adulto' && g.viene !== 'No').length, ninos = guests.filter(g => g.tipo === 'Niño' && g.viene !== 'No').length;
    const faltan = Object.keys(D.CATEGORIAS_ESTANDAR).filter(c => !catsOf(partidas).includes(c));
    $('#tab-presupuesto').innerHTML = `<div class="stats" id="p-totals"></div>
      <div class="toolbar"><select id="p-addcat">${opts(faltan, '', '＋ Añadir categoría…')}<option value="__new">Categoría propia…</option></select><span class="grow"></span><button class="secondary" data-act="p-reset">Restaurar partidas estándar</button></div>
      ${catsOf(partidas).map(cat => `<section class="cat" data-cat="${esc(cat)}"><div class="cat-head"><h3>${esc(cat)}</h3><span class="muted" data-sub></span><span class="grow"></span><button class="link" data-act="p-ren">Renombrar</button><button class="link" data-act="p-up">▲</button><button class="link" data-act="p-down">▼</button><button class="delete" data-act="p-delcat" aria-label="Eliminar categoría">${TRASH}</button></div>
        <div class="table-wrap"><table class="edit"><thead><tr><th>Concepto</th><th>Proveedor</th><th>Estimado</th><th>Pagado</th><th class="th-pago">📅 Fecha de pago</th><th></th></tr></thead><tbody>${partidas.filter(p => p.categoria === cat).map(p => `<tr data-id="${p.id}" class="${rowPago(p)}"><td><input data-pf="concepto" value="${esc(p.concepto)}" /></td><td><input data-pf="proveedor" value="${esc(p.proveedor)}" /></td>
          <td>${p.tipo === 'menu' ? `<span class="menu"><input data-pf="precioUnidad" data-num type="number" min="0" step="any" value="${p.precioUnidad || ''}" placeholder="€/pers." class="w80" /> × <input data-pf="cantidad" data-num type="number" min="0" value="${p.cantidad || ''}" placeholder="nº" class="w60" /><button class="link" data-act="p-fill" title="Usar los invitados que vienen">${p.concepto === 'Menú niños' ? ninos : adultos} pers.</button> = <b data-est>${eur(estimadoDe(p))}</b></span>` : `<input data-pf="estimado" data-num type="number" min="0" step="any" value="${p.estimado || ''}" class="w100" />`}</td>
          <td><input data-pf="pagado" data-num type="number" min="0" step="any" value="${p.pagado || ''}" class="w100" /></td><td class="pago"><input data-pf="fechaPago" type="date" value="${esc(p.fechaPago || '')}" /></td><td class="actions-cell"><button class="delete" data-act="p-del" aria-label="Eliminar">${TRASH}</button></td></tr>`).join('')}</tbody></table></div>
        <button class="link" data-act="p-add">＋ Añadir partida</button></section>`).join('')}`;
    updateTotals();
  }
  function updateTotals() {
    const { partidas } = SEC.presupuesto.data, t = partidas.reduce((a, p) => ({ e: a.e + estimadoDe(p), p: a.p + (Number(p.pagado) || 0) }), { e: 0, p: 0 });
    $('#p-totals').innerHTML = [[eur(t.e), 'presupuesto estimado'], [eur(t.p), 'pagado'], [eur(t.e - t.p), 'pendiente de pagar']].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
    document.querySelectorAll('#tab-presupuesto .cat').forEach(sec => { const ps = partidas.filter(p => p.categoria === sec.dataset.cat); sec.querySelector('[data-sub]').textContent = `${eur(ps.reduce((s, p) => s + estimadoDe(p), 0))} estimado · ${eur(ps.reduce((s, p) => s + (Number(p.pagado) || 0), 0))} pagado`; });
  }
  async function presupuestoEvent(act, el, ev) {
    const data = SEC.presupuesto.data, cat = el.closest('[data-cat]')?.dataset.cat, row = el.closest('tr[data-id]'), p = row && data.partidas.find(p => p.id === row.dataset.id);
    const guests = SEC.invitados.data.invitados;
    if (el.id === 'p-addcat' && ev === 'change') { let name = el.value; if (name === '__new') name = (prompt('Nombre de la categoría:') || '').trim(); if (!name || catsOf(data.partidas).includes(name)) return renderPresupuesto(); data.partidas.push(...(D.CATEGORIAS_ESTANDAR[name] || ['']).map(c => newPartida(name, c))); markDirty('presupuesto'); return renderPresupuesto(); }
    if (act === 'p-reset') { if (await ask('Se volverá a la lista estándar de partidas y se perderán los importes.', 'Restaurar')) { data.partidas = initialPartidas(); markDirty('presupuesto'); renderPresupuesto(); } }
    else if (act === 'p-add') { const last = data.partidas.map(x => x.categoria).lastIndexOf(cat); data.partidas.splice(last + 1, 0, newPartida(cat, '')); markDirty('presupuesto'); renderPresupuesto(); }
    else if (act === 'p-del') { data.partidas = data.partidas.filter(x => x.id !== p.id); markDirty('presupuesto'); renderPresupuesto(); }
    else if (act === 'p-delcat') { if (await ask(`Se eliminará la categoría «${cat}» con todas sus partidas.`)) { data.partidas = data.partidas.filter(x => x.categoria !== cat); markDirty('presupuesto'); renderPresupuesto(); } }
    else if (act === 'p-ren') { const n = (prompt('Nuevo nombre de la categoría:', cat) || '').trim(); if (n && n !== cat) { data.partidas.forEach(x => { if (x.categoria === cat) x.categoria = n; }); markDirty('presupuesto'); renderPresupuesto(); } }
    else if (act === 'p-up' || act === 'p-down') { const order = catsOf(data.partidas), i = order.indexOf(cat), j = i + (act === 'p-up' ? -1 : 1); if (j < 0 || j >= order.length) return; [order[i], order[j]] = [order[j], order[i]]; data.partidas = order.flatMap(c => data.partidas.filter(x => x.categoria === c)); markDirty('presupuesto'); renderPresupuesto(); }
    else if (act === 'p-fill') { p.cantidad = guests.filter(g => g.tipo === (p.concepto === 'Menú niños' ? 'Niño' : 'Adulto') && g.viene !== 'No').length; markDirty('presupuesto'); renderPresupuesto(); }
    else if (el.dataset.pf && p) { p[el.dataset.pf] = el.dataset.num !== undefined ? Number(el.value) || 0 : el.value; markDirty('presupuesto'); if (el.dataset.pf === 'fechaPago' && ev === 'change') return renderPresupuesto(); if (p.tipo === 'menu') row.querySelector('[data-est]').textContent = eur(estimadoDe(p)); updateTotals(); }
  }

  /* ================= TAREAS ================= */
  const tView = { vista: 'fase', resp: '', estado: '', abierta: null, open: {} };
  document.addEventListener('toggle', e => { const d = e.target; if (d.matches?.('details.group')) tView.open[d.dataset.group] = d.open; }, true);
  const ESTADOS = [['sin', 'Sin empezar'], ['proceso', 'En proceso'], ['hecho', 'Terminado']];
  function effectiveTareas() {
    const c = SEC.tareas.data.custom;
    const base = D.TAREAS.filter(t => !c.borradas.includes(t.id)).map(t => ({ ...t, ...c.ov[t.id] }));
    return [...base, ...c.nuevas.map(t => ({ ...t, custom: true }))].filter(t => !(c.catsBorradas || []).includes(t.categoria));
  }
  const respsAll = () => [...D.RESPONSABLES_BASE, ...(SEC.tareas.data.resp || [])];
  function renderTareas() {
    const data = SEC.tareas.data, all = effectiveTareas();
    const est = id => data.estados[id] || 'sin';
    const shown = all.filter(t => (!tView.resp || t.responsable === tView.resp) && (!tView.estado || est(t.id) === tView.estado));
    const done = all.filter(t => est(t.id) === 'hecho').length, pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const groups = tView.vista === 'fase' ? D.FASES : D.CATEGORIAS.filter(c => !(data.custom.catsBorradas || []).includes(c));
    const key = t => (tView.vista === 'fase' ? t.fase : t.categoria);
    $('#tab-tareas').innerHTML = `<div class="stats"><div class="stat"><strong>${pct}%</strong><span>completado</span></div><div class="stat"><strong>${done}</strong><span>terminadas</span></div><div class="stat"><strong>${all.filter(t => est(t.id) === 'proceso').length}</strong><span>en proceso</span></div><div class="stat"><strong>${all.length - done}</strong><span>pendientes</span></div></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <div class="toolbar"><select id="t-vista">${opts([['fase', 'Por fechas (fases)'], ['cat', 'Por categorías']], tView.vista)}</select><select id="t-resp">${opts(respsAll(), tView.resp, 'Todos los responsables')}</select><select id="t-estado">${opts(ESTADOS, tView.estado, 'Todos los estados')}</select><span class="grow"></span><button class="secondary" data-act="t-person">＋ Persona responsable</button></div>
      ${groups.map(gr => {
        const ts = shown.filter(t => key(t) === gr); const all2 = all.filter(t => key(t) === gr);
        if (!ts.length && (tView.resp || tView.estado)) return '';
        return `<details class="group" data-group="${esc(gr)}" ${(tView.open[gr] ?? (ts.length && ts.some(t => est(t.id) !== 'hecho'))) ? 'open' : ''}><summary>${esc(gr)} <span class="muted">${all2.filter(t => est(t.id) === 'hecho').length}/${all2.length}</span></summary>
          ${ts.map(t => taskRow(t, est(t.id))).join('')}<button class="link" data-act="t-add" data-gr="${esc(gr)}">＋ Añadir tarea</button></details>`;
      }).join('')}`;
  }
  function taskRow(t, estado) {
    const open = tView.abierta === t.id;
    return `<div class="task st-${estado}${open ? ' open' : ''}" data-id="${t.id}"><div class="task-head"><select data-tf="estado" class="est">${opts(ESTADOS, estado)}</select><button class="task-title" data-act="t-open">${esc(t.titulo)}</button><select data-tf="responsable" class="resp">${opts(respsAll(), t.responsable || '', 'Sin asignar')}</select></div>${t.nota && !open ? `<p class="muted task-note">${esc(t.nota)}</p>` : ''}${open ? taskDetail(t) : ''}</div>`;
  }
  function taskDetail(t) {
    const det = SEC.tareas.data.detalles[t.id] || {};
    let body = '';
    if (t.tipo === 'proveedor') {
      const ops = det.opciones || [];
      body = `${ops.map(o => `<div class="opcion${o.descartada ? ' descartada' : ''}${det.contratado === o.id ? ' contratada' : ''}" data-op="${o.id}"><div class="grid2"><label>Nombre<input data-of="nombre" value="${esc(o.nombre)}" /></label><label>Email<input data-of="email" type="email" value="${esc(o.email)}" /></label><label>Teléfono<input data-of="telefono" type="tel" value="${esc(o.telefono)}" /></label><label>Presupuesto (€)<input data-of="presupuesto" type="number" step="any" value="${esc(o.presupuesto)}" /></label></div><label>Notas<textarea data-of="notas" rows="2">${esc(o.notas)}</textarea></label><div class="toolbar"><button class="primary sm" data-act="o-hire">${det.contratado === o.id ? '✓ Contratado' : 'Contratar'}</button><button class="secondary sm" data-act="o-disc">${o.descartada ? 'Recuperar' : 'Descartar'}</button><button class="link" data-act="o-del">Eliminar</button></div></div>`).join('')}<button class="secondary sm" data-act="o-add">＋ Opción / presupuesto</button>`;
    } else {
      body = (D.FIELD_SETS[t.tipo] || D.FIELD_SETS.simple).map(f => {
        const v = det[f.key];
        if (f.tipo === 'textarea') return `<label>${esc(f.label)}<textarea data-df="${f.key}" rows="2">${esc(v)}</textarea></label>`;
        if (f.tipo === 'sino') return `<label>${esc(f.label)}<select data-df="${f.key}">${opts(['Sí', 'No'], v, '—')}</select></label>`;
        if (f.tipo === 'checklist') {
          const items = Array.isArray(v) ? v : (f.presets || []).map(label => ({ label, done: false }));
          return `<div class="check"><b>${esc(f.label)}</b>${items.map((it, i) => `<label class="chk"><input type="checkbox" data-ci="${i}" data-ck="${f.key}"${it.done ? ' checked' : ''} /> ${esc(it.label)}</label>`).join('')}<button class="link" data-act="c-add" data-ck="${f.key}">＋ Añadir elemento</button></div>`;
        }
        return `<label>${esc(f.label)}<input data-df="${f.key}" type="${{ eur: 'number', date: 'date', email: 'email', tel: 'tel' }[f.tipo] || 'text'}" value="${esc(v)}" /></label>`;
      }).join('');
    }
    return `<div class="detail"><div class="grid2">${body.startsWith('<div class="opcion') || t.tipo === 'proveedor' ? '' : ''}</div>${body}<div class="toolbar"><span class="muted">${esc(t.categoria)} · ${esc(t.fase)}</span><span class="grow"></span><button class="link" data-act="t-ren">Renombrar</button><button class="link danger-t" data-act="t-del">Quitar tarea</button></div></div>`;
  }
  function tareasEvent(act, el, ev) {
    const data = SEC.tareas.data, row = el.closest('.task'), id = row?.dataset.id, c = data.custom;
    const task = id && effectiveTareas().find(t => t.id === id);
    const det = () => (data.detalles[id] = data.detalles[id] || {});
    const save = (re = true) => { markDirty('tareas'); if (re) renderTareas(); };
    if (el.id === 't-vista') { tView.vista = el.value; return renderTareas(); }
    if (el.id === 't-resp') { tView.resp = el.value; return renderTareas(); }
    if (el.id === 't-estado') { tView.estado = el.value; return renderTareas(); }
    if (act === 't-person') { const n = (prompt('Nombre de la persona responsable:') || '').trim(); if (n && !respsAll().includes(n)) { (data.resp = data.resp || []).push(n); save(); } }
    else if (act === 't-open') { tView.abierta = tView.abierta === id ? null : id; renderTareas(); }
    else if (act === 't-add') {
      const titulo = (prompt('Título de la tarea:') || '').trim(); if (!titulo) return;
      const tipo = confirm('¿Es una tarea de proveedor (varias opciones y contratar)?\n\nAceptar = proveedor · Cancelar = solo notas') ? 'proveedor' : 'simple';
      const gr = el.dataset.gr, porFase = tView.vista === 'fase';
      c.nuevas.push({ id: 'custom-' + uid(), titulo, categoria: porFase ? 'Otros' : gr, fase: porFase ? gr : 'Sin fecha asignada', tipo }); save();
    }
    else if (act === 't-ren') { const n = (prompt('Nuevo título:', task.titulo) || '').trim(); if (!n) return; if (task.custom) c.nuevas.find(t => t.id === id).titulo = n; else c.ov[id] = { ...c.ov[id], titulo: n }; save(); }
    else if (act === 't-del') ask(`Se quitará la tarea «${task.titulo}».`, 'Quitar').then(ok => { if (!ok) return; if (task.custom) c.nuevas = c.nuevas.filter(t => t.id !== id); else c.borradas.push(id); tView.abierta = null; save(); });
    else if (act === 'o-add') { (det().opciones = det().opciones || []).push({ id: uid(), nombre: '', email: '', telefono: '', presupuesto: '', notas: '' }); save(); }
    else if (act === 'o-hire' || act === 'o-disc' || act === 'o-del') {
      const oid = el.closest('[data-op]').dataset.op, d = det(), o = d.opciones.find(o => o.id === oid);
      if (act === 'o-hire') { d.contratado = d.contratado === oid ? '' : oid; if (d.contratado) data.estados[id] = 'hecho'; }
      else if (act === 'o-disc') o.descartada = !o.descartada;
      else { d.opciones = d.opciones.filter(x => x.id !== oid); if (d.contratado === oid) d.contratado = ''; }
      save();
    }
    else if (act === 'c-add') { const label = (prompt('Nuevo elemento:') || '').trim(); if (!label) return; const f = (D.FIELD_SETS[task.tipo] || []).find(f => f.key === el.dataset.ck), d = det(); d[el.dataset.ck] = Array.isArray(d[el.dataset.ck]) ? d[el.dataset.ck] : (f?.presets || []).map(l => ({ label: l, done: false })); d[el.dataset.ck].push({ label, done: false }); save(); }
    else if (el.dataset.ci !== undefined && ev === 'change') { const f = (D.FIELD_SETS[task.tipo] || []).find(f => f.key === el.dataset.ck), d = det(); d[el.dataset.ck] = Array.isArray(d[el.dataset.ck]) ? d[el.dataset.ck] : (f?.presets || []).map(l => ({ label: l, done: false })); d[el.dataset.ck][el.dataset.ci].done = el.checked; save(false); }
    else if (el.dataset.tf === 'estado' && ev === 'change') { data.estados[id] = el.value; save(); }
    else if (el.dataset.tf === 'responsable' && ev === 'change') { if (task.custom) c.nuevas.find(t => t.id === id).responsable = el.value; else c.ov[id] = { ...c.ov[id], responsable: el.value }; save(false); }
    else if (el.dataset.df) { det()[el.dataset.df] = el.value; save(false); }
    else if (el.dataset.of) { const oid = el.closest('[data-op]').dataset.op; det().opciones.find(o => o.id === oid)[el.dataset.of] = el.value; save(false); }
  }

  /* ================= PROVEEDORES ================= */
  const ESTADOS_PROV = ['Contratado', 'Presupuesto pedido', 'En contacto', 'Descartado'];
  function autoProveedores() {
    const data = SEC.tareas.data;
    return effectiveTareas().filter(t => t.tipo === 'proveedor').flatMap(t => {
      const d = data.detalles[t.id], o = d?.opciones?.find(o => o.id === d.contratado); if (!o) return [];
      return [{ id: 'tarea-' + t.id, nombre: o.nombre || t.titulo, categoria: t.categoria, email: o.email, telefono: o.telefono, estado: 'Contratado', importe: Number(o.presupuesto) || 0, incluye: o.notas, desde: t.titulo }];
    });
  }
  const ISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fechaCorta = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  // Partidas del presupuesto con fecha de pago este mes (o ya pasada) y algo pendiente de pagar.
  const pendienteDe = p => Math.max(0, estimadoDe(p) - (Number(p.pagado) || 0));
  function pagosPendientes() {
    if (!SEC.presupuesto) return [];
    const hoy = ISO(new Date()), mes = hoy.slice(0, 7);
    return SEC.presupuesto.data.partidas.filter(p => p.fechaPago && pendienteDe(p) > 0 && p.fechaPago.slice(0, 7) <= mes)
      .map(p => ({ nombre: p.concepto || p.categoria || '(sin nombre)', proveedor: p.proveedor, fecha: p.fechaPago, importe: pendienteDe(p), vencido: p.fechaPago < hoy }))
      .sort((x, y) => x.fecha.localeCompare(y.fecha));
  }
  const rowPago = p => { if (!p.fechaPago || pendienteDe(p) <= 0) return ''; const hoy = ISO(new Date()); return p.fechaPago < hoy ? 'vence-ya' : p.fechaPago.slice(0, 7) === hoy.slice(0, 7) ? 'vence-mes' : ''; };
  function renderAlerts() {
    const box = $('#alerts'); if (!box) return;
    const list = pagosPendientes();
    box.innerHTML = list.length ? `<div class="alert ${list.some(p => p.vencido) ? 'bad' : 'warn'}" role="alert"><div><strong>⚠ ${list.some(p => p.vencido) ? 'Hay pagos vencidos o de este mes' : 'Este mes toca pagar'}</strong>
      <ul>${list.map(p => `<li class="${p.vencido ? 'venc' : ''}"><b>${esc(p.nombre)}</b>${p.proveedor ? ` (${esc(p.proveedor)})` : ''} · ${fechaCorta(p.fecha)} · ${eur(p.importe)} pendiente${p.vencido ? ' · <em>vencido</em>' : ''}</li>`).join('')}</ul></div>
      ${current === 'presupuesto' ? '' : '<button class="mini solid" data-go="presupuesto">Ver presupuesto</button>'}</div>` : '';
  }
  function renderProveedores() {
    const manuales = SEC.proveedores.data.manuales, auto = autoProveedores(), all = [...auto, ...manuales];
    const contr = all.filter(p => p.estado === 'Contratado');
    $('#tab-proveedores').innerHTML = `<div class="stats"><div class="stat"><strong>${all.length}</strong><span>proveedores</span></div><div class="stat"><strong>${contr.length}</strong><span>contratados</span></div><div class="stat"><strong>${eur(contr.reduce((s, p) => s + (Number(p.importe) || 0), 0))}</strong><span>importe contratado</span></div></div>
      <div class="toolbar"><button class="primary" data-act="v-add">＋ Proveedor</button><span class="grow"></span><span class="muted">Los «Contratado» en Tareas aparecen aquí solos. Las fechas de pago se ponen en Presupuesto.</span></div>
      <div class="table-wrap"><table class="edit"><thead><tr><th>Nombre</th><th>Estado</th><th>Importe</th><th>Categoría</th><th>Email</th><th>Teléfono</th><th>Qué incluye / notas</th><th></th></tr></thead><tbody>
      ${auto.map(p => `<tr class="auto"><td>${esc(p.nombre)}</td><td><span class="pill ok">Contratado</span></td><td>${eur(p.importe)}</td><td>${esc(p.categoria)}</td><td>${esc(p.email)}</td><td>${esc(p.telefono)}</td><td>${esc(p.incluye)} <span class="muted">(desde la tarea «${esc(p.desde)}»)</span></td><td></td></tr>`).join('')}
      ${manuales.map(p => `<tr data-id="${p.id}"><td><input data-vf="nombre" value="${esc(p.nombre)}" /></td><td><select data-vf="estado">${opts(ESTADOS_PROV, p.estado)}</select></td><td><input data-vf="importe" data-num type="number" step="any" value="${p.importe || ''}" class="w100" /></td><td><input data-vf="categoria" value="${esc(p.categoria)}" /></td><td><input data-vf="email" type="email" value="${esc(p.email)}" /></td><td><input data-vf="telefono" type="tel" value="${esc(p.telefono)}" /></td><td><input data-vf="incluye" value="${esc(p.incluye)}" /></td><td class="actions-cell"><button class="delete" data-act="v-del" aria-label="Eliminar">${TRASH}</button></td></tr>`).join('')}
      ${all.length ? '' : '<tr><td class="empty" colspan="8">Aún no hay proveedores.</td></tr>'}</tbody></table></div>`;
  }
  async function proveedoresEvent(act, el, ev) {
    const data = SEC.proveedores.data, row = el.closest('tr[data-id]'), p = row && data.manuales.find(p => p.id === row.dataset.id), autoRow = el.closest('tr[data-auto]');
    if (act === 'v-add') { data.manuales.push({ id: uid(), nombre: '', categoria: '', email: '', telefono: '', estado: 'En contacto', importe: 0, incluye: '', fechaPago: '', pagado: false }); markDirty('proveedores'); renderProveedores(); }
    else if (act === 'v-del') { if (await ask(`Se eliminará a ${p.nombre || 'este proveedor'}.`)) { data.manuales = data.manuales.filter(x => x.id !== p.id); markDirty('proveedores'); renderProveedores(); } }
    else if (el.dataset.av && autoRow) {
      const pg = (data.autoPagos = data.autoPagos || {}), id = autoRow.dataset.auto; pg[id] = pg[id] || {};
      pg[id][el.dataset.av] = el.type === 'checkbox' ? el.checked : el.value; markDirty('proveedores');
      if (ev === 'change') renderProveedores();
    }
    else if (el.dataset.vf && p) {
      p[el.dataset.vf] = el.type === 'checkbox' ? el.checked : el.dataset.num !== undefined ? Number(el.value) || 0 : el.value; markDirty('proveedores');
      if (ev === 'change' && (el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'date')) renderProveedores();
    }
  }

  // Vista móvil/tablet: cada fila de las tablas pasa a ser una tarjeta; aquí se etiquetan las celdas y se marcan las secundarias.
  const PRIMARY = { 'tab-invitados': [0, 1, 2, 3, 4, 5], 'tab-proveedores': [0, 1, 2] };
  function labelTables() {
    document.querySelectorAll('.tab:not([hidden]) table.edit').forEach(t => {
      const tabId = t.closest('.tab').id, prim = PRIMARY[tabId], heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.replace('×', '').trim());
      t.querySelectorAll('tbody tr').forEach(tr => {
        [...tr.children].forEach((td, i) => {
          if (td.classList.contains('empty') || td.classList.contains('more-td')) return;
          td.dataset.label = heads[i] || '';
          td.classList.toggle('sec', !!prim && !prim.includes(i) && !td.classList.contains('actions-cell'));
          td.classList.toggle('wide', i === 0 && tabId !== 'tab-invitados');
        });
        const eid = tr.dataset.id || tr.dataset.auto;
        if (eid && !tr.querySelector('.edit-btn')) {
          const host = tr.querySelector('td.actions-cell') || tr.lastElementChild;
          if (host) host.insertAdjacentHTML('afterbegin', '<button type="button" class="edit-btn" data-edit aria-label="Editar">✎ Editar</button>');
        }
        if (eid) { const on = UI_EDIT.has(eid); tr.classList.toggle('editing', on); const eb = tr.querySelector('.edit-btn'); if (eb) eb.textContent = on ? '✓ Listo' : '✎ Editar'; if (on && prim) tr.classList.add('open'); }
        if (prim && !tr.querySelector('.more-td') && !tr.querySelector('.empty')) tr.insertAdjacentHTML('beforeend', '<td class="more-td"><button type="button" class="more-btn" data-more>Más datos ▾</button></td>');
      });
    });
  }
  // Al volver a dibujar una pestaña se conserva la posición de la página y de las tablas.
  function keepScroll(fn) {
    return (...args) => {
      const y = window.scrollY, wraps = [...document.querySelectorAll('.tab:not([hidden]) .table-wrap, .tab:not([hidden]) .assoc-list')].map(w => [w.scrollTop, w.scrollLeft]);
      const out = fn(...args);
      document.querySelectorAll('.tab:not([hidden]) .table-wrap, .tab:not([hidden]) .assoc-list').forEach((w, i) => { if (wraps[i]) { w.scrollTop = wraps[i][0]; w.scrollLeft = wraps[i][1]; } });
      window.scrollTo(0, y);
      labelTables();
      return out;
    };
  }
  renderInvitados = keepScroll(renderInvitados); renderAssoc = keepScroll(renderAssoc); renderMesas = keepScroll(renderMesas); renderPresupuesto = keepScroll(renderPresupuesto); renderTareas = keepScroll(renderTareas); renderProveedores = keepScroll(renderProveedores);

  /* ---------- pestañas ---------- */
  const TABS = {
    respuestas: { need: [], render: renderRespuestas },
    invitados: { need: ['invitados', 'mesas'], render: renderInvitados, resp: true },
    mesas: { need: ['invitados', 'mesas'], render: renderMesas },
    presupuesto: { need: ['invitados', 'presupuesto'], render: renderPresupuesto },
    proveedores: { need: ['tareas', 'proveedores'], render: renderProveedores },
    tareas: { need: ['tareas'], render: renderTareas }
  };
  let current = 'respuestas';
  let firstRender = true;
  async function render() {
    const tab = TABS[current], mine = current, tabEl = $('#tab-' + current);
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === current));
    document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== (current === 'respuestas' ? 'tab-respuestas' : 'tab-' + current));
    $('#actions-resp').hidden = current !== 'respuestas';
    updateUndoButtons();
    loginView.hidden = true; panelView.hidden = false;
    renderAlerts();
    try {
      const faltan = tab.need.filter(n => !SEC[n]);
      if (faltan.length || (current === 'respuestas' && !respData)) {
        if (mine !== 'respuestas' && !tabEl.querySelector('.stats, table')) tabEl.innerHTML = '<p class="muted loading">Cargando…</p>';
        setSave('Cargando…');
      }
      await Promise.all(tab.need.map(n => loadSec(n)));
      if (current === 'respuestas' && !respData) await loadRespuestas();
      if (current !== mine) return;                       // se cambió de pestaña mientras cargaba
      tab.render();
      if (saveState.textContent === 'Cargando…') setSave('');
      if (tab.resp && respData && syncNamesOnce()) { markDirty('invitados'); tab.render(); }
      if (tab.resp && !respData) loadRespuestas().then(() => { if (syncNamesOnce()) markDirty('invitados'); if (current === mine) tab.render(); }).catch(() => {});   // las respuestas llegan después, sin bloquear
      if (firstRender) { firstRender = false; const y = Number(ssGet('scroll-' + current)); if (y) window.scrollTo(0, y); }
    } catch (e) {
      if (e.message === '401') return;
      setSave('');
      if (current === mine) tabEl.innerHTML = `<p class="error">${esc(e.message || 'Error')}</p><p class="center"><button class="secondary" id="retry-load" type="button" style="width:auto">Reintentar</button></p>`;
    }
  }
  document.addEventListener('click', e => { if (e.target.id === 'retry-load') render(); const go = e.target.closest('[data-go]'); if (go) { current = go.dataset.go; history.replaceState(null, '', '#' + current); render(); } });
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; current = b.dataset.tab; history.replaceState(null, '', '#' + current); render(); });

  let scrollTimer; window.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => ssSet('scroll-' + current, window.scrollY), 200); }, { passive: true });

  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'checkbox') return;   // dentro de una celda se usa el deshacer normal
    e.preventDefault(); e.shiftKey ? redo() : undo();
  });
  if ($('#undo')) $('#undo').onclick = undo;
  if ($('#redo')) $('#redo').onclick = redo;

  /* ---------- eventos delegados ---------- */
  const handlers = { invitados: invitadosClick, mesas: mesasEvent, presupuesto: presupuestoEvent, proveedores: proveedoresEvent, tareas: tareasEvent };
  document.addEventListener('click', e => {
    const eb = e.target.closest('[data-edit]');
    if (eb) {
      const row = eb.closest('tr, .mcard'), id = row && (row.dataset.id || row.dataset.auto);
      if (id) { const on = !UI_EDIT.has(id); on ? UI_EDIT.add(id) : UI_EDIT.delete(id); row.classList.toggle('editing', on); eb.textContent = on ? '✓ Listo' : '✎ Editar'; if (on && row.tagName === 'TR' && row.querySelector('.more-td')) { row.classList.add('open'); const mb2 = row.querySelector('.more-btn'); if (mb2) mb2.textContent = 'Menos datos ▴'; } }
      return;
    }
    const mb = e.target.closest('[data-more]');
    if (mb) { const tr = mb.closest('tr'); tr.classList.toggle('open'); mb.textContent = tr.classList.contains('open') ? 'Menos datos ▴' : 'Más datos ▾'; return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const tab = el.closest('.tab'); const name = tab?.id.replace('tab-', ''); if (!handlers[name]) return;
    if (name === 'invitados') invitadosClick(el.dataset.act, el); else handlers[name](el.dataset.act, el, 'click');
  });
  const onField = (e, ev) => {
    const el = e.target, tab = el.closest('.tab'); const name = tab?.id.replace('tab-', ''); if (!handlers[name]) return;
    if (name === 'invitados') return invitadosInput(el, ev === 'change');
    if (name === 'tareas' && ev === 'input' && el.tagName === 'SELECT') return;
    if (['mesas', 'presupuesto', 'proveedores', 'tareas'].includes(name)) {
      if (ev === 'input' && (el.tagName === 'SELECT' || el.type === 'checkbox')) return;
      handlers[name]('', el, ev);
    }
  };
  document.addEventListener('input', e => onField(e, 'input'));
  document.addEventListener('change', e => onField(e, 'change'));

  /* ---------- modo tablet / modo ordenador (en pantallas táctiles) ---------- */
  (() => {
    const btn = $('#modo'); if (!btn) return;
    const touch = window.matchMedia('(pointer: coarse)').matches;   // solo pantallas táctiles (no ordenadores con ratón)
    if (!touch) return;
    let modo = 'tablet'; try { modo = localStorage.getItem('boda-modo') === 'ordenador' ? 'ordenador' : 'tablet'; } catch { /* sin almacenamiento */ }
    btn.hidden = false;
    btn.textContent = modo === 'ordenador' ? '📱 Modo tablet' : '🖥 Modo ordenador';
    btn.title = modo === 'ordenador' ? 'Volver a la vista adaptada a la pantalla' : 'Ver la página completa, como en un ordenador';
    btn.onclick = () => { try { localStorage.setItem('boda-modo', modo === 'ordenador' ? 'tablet' : 'ordenador'); } catch { /* sin almacenamiento */ } location.reload(); };
  })();

  /* ---------- sesión ---------- */
  async function start() {
    // Se comprueba el acceso con la sección de invitados (que hace falta de todos modos); las respuestas se cargan después.
    try { await loadSec('invitados'); } catch (e) { return e.message === '401' ? undefined : showLogin(e.message || 'No se han podido cargar los datos. Inténtalo más tarde.'); }
    const h = location.hash.slice(1); if (TABS[h]) current = h;
    await render();
    if (!respData) loadRespuestas().then(() => { if (syncNamesOnce()) markDirty('invitados'); if (TABS[current].resp || current === 'respuestas') TABS[current].render(); }).catch(() => {});
    // El resto de secciones se descargan ya, en segundo plano, para que al cambiar de pestaña salgan al instante.
    ['mesas', 'tareas', 'presupuesto', 'proveedores'].forEach(n => loadSec(n).catch(() => {}));
  }
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, b = form.querySelector('button');
    credentials = btoa(unescape(encodeURIComponent(`${form.user.value.trim()}:${form.password.value}`)));
    sessionStorage.setItem('boda-admin', credentials); b.disabled = true; loginError.textContent = '';
    await start(); b.disabled = false; form.password.value = '';
  });
  $('#refresh').onclick = async () => { await loadRespuestas(); render(); };
  $('#logout').onclick = () => { sessionStorage.removeItem('boda-admin'); credentials = ''; location.hash = ''; location.reload(); };
  if (credentials) start();
})();
