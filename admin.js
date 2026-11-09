/* Zona privada: respuestas del cuestionario + gestión de la boda
   (invitados, mesas, presupuesto, proveedores y tareas). */
(() => {
  'use strict';
  const D = window.GESTION_DATA;
  const $ = (s, r = document) => r.querySelector(s);
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
    proveedores: () => ({ manuales: [] }),
    tareas: () => ({ estados: {}, detalles: {}, custom: { ov: {}, borradas: [], nuevas: [], catsBorradas: [] }, resp: [] })
  };
  const CATS_INICIALES = ['Iglesia', 'Banquete', 'Música', 'Decoración y flores', 'Fotografía y vídeo', 'La novia', 'El novio', 'Papelería', 'Transporte', 'Detalles y regalos', 'Viaje de novios', 'Otros'];
  const newPartida = (categoria, concepto) => ({ id: uid(), categoria, concepto, proveedor: '', estimado: 0, pagado: 0, ...(D.MENU_CONCEPTOS.includes(concepto) ? { tipo: 'menu', precioUnidad: 0, cantidad: 0 } : {}) });
  const initialPartidas = () => CATS_INICIALES.flatMap(c => (D.CATEGORIAS_ESTANDAR[c] || []).map(x => newPartida(c, x)));

  async function loadSec(name, force) {
    if (SEC[name] && !force) return SEC[name].data;
    const res = await fetch(`/api/gestion/${name}`, { headers: headers() });
    if (res.status === 401) { unauthorized(); throw new Error('401'); }
    if (!res.ok) throw new Error('No se ha podido cargar.');
    const { rev, data } = await res.json();
    const base = defaults[name]();
    SEC[name] = { rev, data: data ? { ...base, ...data } : base, timer: null, saving: false, again: false, fresh: !data };
    if (!data) markDirty(name);   // primera vez: guarda los valores de partida
    return SEC[name].data;
  }
  function markDirty(name) {
    const s = SEC[name]; if (!s) return;
    setSave('Guardando…'); clearTimeout(s.timer); s.timer = setTimeout(() => flush(name), 700);
  }
  async function flush(name) {
    const s = SEC[name];
    if (s.saving) { s.again = true; return; }
    s.saving = true;
    try {
      const res = await fetch(`/api/gestion/${name}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ data: s.data, rev: s.rev }) });
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
    const res = await fetch('/api/respuestas', { headers: headers() });
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
  const guestFilter = { q: '', grupo: '', subgrupo: '', viene: '', tipo: '' };
  const fullName = g => `${g?.nombre || ''} ${g?.apellido || ''}`.trim();

  function ensureCol(inv, nombre, tipo = 'texto') {
    let c = inv.columnas.find(c => norm(c.nombre) === norm(nombre));
    if (!c) { c = { id: uid(), nombre, tipo }; inv.columnas.push(c); }
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
    const q = norm(guestFilter.q);
    const shown = list.filter(g => (!q || norm(`${fullName(g)} ${g.grupo} ${g.subgrupo}`).includes(q)) && (!guestFilter.grupo || g.grupo === guestFilter.grupo) && (!guestFilter.subgrupo || g.subgrupo === guestFilter.subgrupo) && (!guestFilter.viene || g.viene === guestFilter.viene) && (!guestFilter.tipo || g.tipo === guestFilter.tipo));
    const filtering = shown.length !== list.length || q || guestFilter.grupo || guestFilter.subgrupo || guestFilter.viene || guestFilter.tipo;
    const n = f => shown.filter(f).length;
    const stats = [[shown.length, filtering ? `de ${list.length} · coinciden con el filtro` : 'personas'], [n(g => g.viene === 'Sí'), 'confirmadas'], [n(g => g.viene === 'Pendiente'), 'pendientes'], [n(g => g.viene === 'No'), 'no vienen'], [n(g => g.tipo === 'Adulto' && g.viene !== 'No'), 'adultos'], [n(g => g.tipo === 'Niño' && g.viene !== 'No'), 'niños']];
    const subgrupos = [...new Set(list.map(g => g.subgrupo).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'es'));
    const cell = (g, c) => {
      const v = g.extra[c.id] ?? '';
      if (c.tipo === 'sino') return `<select data-gx="${c.id}"${tint(v)}>${opts(['Sí', 'No'], v, '—')}</select>`;
      if (c.tipo === 'lista') return `<select data-gx="${c.id}"${tint(v)}>${opts((c.opciones || '').split(',').map(s => s.trim()).filter(Boolean), v, '—')}</select>`;
      return `<input data-gx="${c.id}" type="${c.tipo === 'numero' ? 'number' : 'text'}" value="${esc(v)}" />`;
    };
    const pend = respData ? respData.rows.filter(r => !inv.vinculos[respKey(r)]).length : 0;
    $('#tab-invitados').innerHTML = `
      <div class="stats">${stats.map(([x, l]) => `<div class="stat"><strong>${x}</strong><span>${l}</span></div>`).join('')}</div>
      <div class="toolbar">
        <input type="search" id="g-q" placeholder="Buscar…" value="${esc(guestFilter.q)}" />
        <select id="g-grupo">${opts(inv.grupos, guestFilter.grupo, 'Todos los grupos')}</select>
        <select id="g-subgrupo">${opts(subgrupos, guestFilter.subgrupo, 'Todos los subgrupos')}</select>
        <select id="g-viene">${opts(VIENE, guestFilter.viene, '¿Viene? (todos)')}</select>
        <select id="g-tipo">${opts(['Adulto', 'Niño'], guestFilter.tipo, 'Adulto / Niño')}</select>
        ${filtering ? '<button class="link" data-act="g-clear">Quitar filtros</button>' : ''}
        <b class="count">${shown.length} de ${list.length}</b>
        <span class="grow"></span>
        <button class="primary" data-act="g-add">＋ Invitado</button>
        <button class="secondary" data-act="g-col">＋ Columna</button>
        <button class="secondary" data-act="g-grupos">Grupos</button>
        <label class="secondary filebtn">Importar Excel<input type="file" id="g-import" accept=".xlsx,.xls,.csv" hidden /></label>
        <button class="secondary" data-act="g-export">Exportar Excel</button>
      </div>
      <details class="assoc" ${pend ? 'open' : ''}><summary>Respuestas del cuestionario ${respData ? `· ${pend} sin asociar de ${respData.rows.length}` : ''}</summary><div id="assoc"></div></details>
      <datalist id="dl-sub">${[...new Set(list.map(g => g.subgrupo).filter(Boolean))].sort().map(x => `<option value="${esc(x)}">`).join('')}</datalist><div class="table-wrap tall"><table class="edit"><thead><tr><th>Nombre</th><th>Apellido</th><th>¿Viene?</th><th>Grupo</th><th>Subgrupo</th><th>Tipo</th>${inv.columnas.map(c => `<th>${esc(c.nombre)} <button class="x" data-act="g-delcol" data-id="${c.id}" title="Quitar columna">×</button></th>`).join('')}<th>Cuestionario</th><th></th></tr></thead>
      <tbody>${shown.length ? shown.map(g => `<tr data-id="${g.id}">
        <td><input data-gf="nombre" class="c-nombre" value="${esc(g.nombre)}" /></td><td><input data-gf="apellido" class="c-apellido" value="${esc(g.apellido)}" /></td>
        <td><select data-gf="viene"${tint(g.viene)}>${opts(VIENE, g.viene)}</select></td>
        <td><select data-gf="grupo"${tint(g.grupo, inv.grupos.indexOf(g.grupo))}>${opts(inv.grupos, g.grupo, '—')}</select></td><td><input data-gf="subgrupo" list="dl-sub" value="${esc(g.subgrupo)}"${tint(g.subgrupo)} /></td>
        <td><select data-gf="tipo"${tint(g.tipo)}>${opts(['Adulto', 'Niño'], g.tipo)}</select></td>
        ${inv.columnas.map(c => `<td>${cell(g, c)}</td>`).join('')}
        <td class="center">${vinculado.has(g.id) ? '<span class="pill ok">✓ asociado</span>' : '<span class="pill">—</span>'}</td>
        <td class="actions-cell"><button class="delete" data-act="g-del" data-id="${g.id}" aria-label="Eliminar">${TRASH}</button></td></tr>`).join('') : `<tr><td class="empty" colspan="${8 + inv.columnas.length}">${list.length ? 'Ningún invitado coincide con el filtro.' : 'Aún no hay invitados. Añádelos, impórtalos desde Excel o asócialos desde el cuestionario.'}</td></tr>`}</tbody></table></div>`;
    renderAssoc();
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
    const guestOpts = `<option value="">Elegir invitado…</option>` + [...inv.invitados].sort((x, y) => fullName(x).localeCompare(fullName(y), 'es')).map(g => `<option value="${g.id}">${esc(fullName(g) || '(sin nombre)')}</option>`).join('');
    const row = ({ r, k, linked, sug }) => {
      const name = `${r.nombre} ${r.apellidos}`.trim() || '(sin nombre)';
      const ini = ((r.nombre || '?')[0] + (r.apellidos || '')[0]).toUpperCase().replace(/UNDEFINED/g, '');
      let st;
      if (linked) st = `<span class="pill ok">✓ ${esc(fullName(linked))}</span><button class="mini ghost" data-act="a-unlink" data-k="${esc(k)}">Desasociar</button>`;
      else if (sug) st = `<span class="sug">¿Es <b>${esc(fullName(sug))}</b>?</span><button class="mini solid" data-act="a-accept" data-k="${esc(k)}" data-g="${sug.id}">Sí, asociar</button><select class="mini" data-assoc="${esc(k)}" aria-label="Elegir otro invitado">${guestOpts.replace('Elegir invitado…', 'Es otra persona…')}</select>`;
      else st = `<span class="sug none">Sin coincidencia</span><select class="mini" data-assoc="${esc(k)}">${guestOpts}</select><button class="mini" data-act="a-create" data-k="${esc(k)}">＋ Crear invitado</button>`;
      return `<div class="assoc-row${linked ? ' is-linked' : ''}"><span class="avatar" style="background:${PALETTE[hashIdx(name)]}">${esc(ini)}</span><div class="who"><strong>${esc(name)}</strong><small>${esc(r.tipo)}${r.asistencia ? ` · <span class="pill ${r.asistencia === 'Sí' ? 'ok' : 'no'}">${r.asistencia === 'Sí' ? 'Asiste' : 'No asiste'}</span>` : ''}</small></div><div class="st">${st}</div></div>`;
    };
    const chip = (v, label, n) => `<button class="chip${assocFilter === v ? ' on' : ''}" data-act="a-filter" data-v="${v}">${label} <b>${n}</b></button>`;
    box.innerHTML = `<div class="assoc-bar"><div class="chips">${chip('review', 'Por revisar', nReview)}${chip('linked', 'Asociadas', nLinked)}${chip('all', 'Todas', info.length)}</div><span class="grow"></span>
      <button class="mini solid" data-act="a-auto"${nSug ? '' : ' disabled'}>Aceptar sugerencias (${nSug})</button><button class="mini" data-act="a-sync" title="Vuelve a copiar dirección, alergias y bus desde el cuestionario">Actualizar fichas</button><button class="mini ghost" data-act="a-reload">↻ Recargar</button></div>
      <div class="assoc-list">${list.length ? list.map(row).join('') : `<p class="muted center">${assocFilter === 'review' ? '¡Todo asociado! 🎉' : 'Nada que mostrar.'}</p>`}</div>`;
  }
  function link(k, gid) {
    const inv = SEC.invitados.data, r = respData.rows.find(r => respKey(r) === k), g = inv.invitados.find(g => g.id === gid);
    if (!r || !g) return;
    for (const key of Object.keys(inv.vinculos)) if (inv.vinculos[key] === gid) delete inv.vinculos[key];
    inv.vinculos[k] = gid; applyResponse(inv, g, r);
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
  const IMPORT_COLS = { 'direccion': ['Dirección', 'texto'], 'alergias': ['Alergias', 'texto'], 'invitacion': ['Invitación entregada', 'sino'], 'regalo': ['Regalo', 'sino'], 'cantidad (regalo)': ['Cantidad (regalo)', 'numero'], 'agradecimientos': ['Agradecimiento enviado', 'sino'], 'agradecimiento': ['Agradecimiento enviado', 'sino'], 'bus ida': ['Bus ida', 'texto'], 'bus vuelta': ['Bus vuelta', 'texto'], 'hora vuelta': ['Hora bus vuelta', 'texto'], 'hora ida': ['Hora bus ida', 'texto'], 'alojamiento': ['Alojamiento', 'texto'], 'menu': ['Menú', 'texto'], 'notas': ['Notas', 'texto'] };
  const IGNORE_COLS = new Set(['mesas', 'mesa', '']);
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
    const K = g => `${norm(g.nombre)}|${norm(g.apellido)}|${norm(g.grupo)}|${norm(g.subgrupo)}`;
    const seen = new Set(inv.invitados.map(K));
    const extras = head.map((h, i) => (i === nameCol || i === iN || i === iA || i === iViene || i === iGrupo || i === iSub || i === iTipo || IGNORE_COLS.has(h) ? null : (IMPORT_COLS[h] || [String(all[hi][i]).trim(), 'texto'])));
    let added = 0, skipped = 0;
    for (const r of rows.slice(0)) {
      let nombre, apellido;
      if (iFull >= 0 || iA < 0) [nombre, apellido] = splitName(r[nameCol]); else { nombre = String(r[iN] ?? '').trim(); apellido = String(r[iA] ?? '').trim(); }
      if (!nombre && !apellido) continue;
      const grupo = iGrupo >= 0 ? String(r[iGrupo]).trim() : '';
      if (/^novi[oa]s?$/.test(norm(grupo))) { skipped++; continue; }   // la fila de los novios
      const g = newGuest(nombre, apellido);
      g.grupo = grupo; g.subgrupo = iSub >= 0 ? String(r[iSub]).trim() : '';
      if (iTipo >= 0 && /^ni/.test(norm(r[iTipo]))) g.tipo = 'Niño';
      if (iViene >= 0) { const v = norm(r[iViene]); g.viene = v === 'si' ? 'Sí' : v === 'no' ? 'No' : 'Pendiente'; if (v && !['si', 'no'].includes(v)) g.extra[ensureCol(inv, 'Notas', 'texto')] = String(r[iViene]).trim(); }
      extras.forEach((c, i) => { const val = String(r[i] ?? '').trim(); if (!c || !val || norm(val) === 'no viene' && c[0] !== 'Dirección' && c[0] !== 'Notas') return; if (norm(val) === 'no viene') return; g.extra[ensureCol(inv, c[0], c[1])] = c[1] === 'sino' ? yesNo(val) : c[1] === 'numero' ? (Number(val) ? String(Number(val)) : '') : val; });
      if (seen.has(K(g))) { skipped++; continue; }   // ya estaba antes de importar (así se puede repetir la importación sin duplicar)
      inv.invitados.push(g); added++;
      if (g.grupo && !inv.grupos.includes(g.grupo)) inv.grupos.push(g.grupo);
    }
    markDirty('invitados'); renderInvitados(); alert(`Se han añadido ${added} invitados.${skipped ? ` Se han omitido ${skipped} (ya estaban o es la fila de los novios).` : ''}`);
  }
  async function exportGuests() {
    const X = await getXLSX(), inv = SEC.invitados.data;
    const mesas = SEC.mesas?.data.mesas || [];
    const data = inv.invitados.map(g => {
      const m = mesas.find(m => m.invitados.includes(g.id));
      return { Nombre: g.nombre, Apellido: g.apellido, '¿Viene?': g.viene, Grupo: g.grupo, Subgrupo: g.subgrupo, Tipo: g.tipo, ...(m ? { Mesa: m.numero } : {}), ...Object.fromEntries(inv.columnas.map(c => [c.nombre, g.extra[c.id] ?? ''])) };
    });
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(data), 'Invitados');
    X.writeFile(wb, `invitados-boda-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const colDialog = $('#dlg-col');
  $('#dlg-col-name').innerHTML = SUGERIDAS.map(([n]) => `<option value="${esc(n)}">`).join('');
  $('#dlg-col-form').onsubmit = e => {
    e.preventDefault(); const f = e.target, nombre = f.nombre.value.trim(); if (!nombre) return;
    const inv = SEC.invitados.data;
    inv.columnas.push({ id: uid(), nombre, tipo: f.tipo.value, ...(f.tipo.value === 'lista' ? { opciones: f.opciones.value } : {}) });
    markDirty('invitados'); colDialog.close(); f.reset(); renderInvitados();
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
    if (act === 'g-add') { inv.invitados.push(newGuest()); markDirty('invitados'); renderInvitados(); const rows = document.querySelectorAll('#tab-invitados tbody tr'); rows[rows.length - 1]?.querySelector('input')?.focus(); }
    else if (act === 'g-del') { const g = inv.invitados.find(g => g.id === el.dataset.id); if (await ask(`Se eliminará a ${fullName(g) || 'este invitado'}.`)) { inv.invitados = inv.invitados.filter(x => x.id !== g.id); for (const k of Object.keys(inv.vinculos)) if (inv.vinculos[k] === g.id) delete inv.vinculos[k]; markDirty('invitados'); renderInvitados(); } }
    else if (act === 'g-clear') { Object.assign(guestFilter, { q: '', grupo: '', subgrupo: '', viene: '', tipo: '' }); renderInvitados(); }
    else if (act === 'g-col') colDialog.showModal();
    else if (act === 'g-delcol') { const c = inv.columnas.find(c => c.id === el.dataset.id); if (await ask(`Se quitará la columna «${c.nombre}» con todos sus datos.`, 'Quitar')) { inv.columnas = inv.columnas.filter(x => x.id !== c.id); inv.invitados.forEach(g => delete g.extra[c.id]); markDirty('invitados'); renderInvitados(); } }
    else if (act === 'g-grupos') { $('#dlg-grupos-form').grupos.value = inv.grupos.join('\n'); gruposDialog.showModal(); }
    else if (act === 'g-export') exportGuests().catch(e => alert(e.message));
    else if (act === 'a-filter') { assocFilter = el.dataset.v; renderAssoc(); }
    else if (act === 'a-accept') { link(el.dataset.k, el.dataset.g); markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-unlink') { delete inv.vinculos[el.dataset.k]; markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-create') { const r = respData.rows.find(r => respKey(r) === el.dataset.k), g = newGuest(r.nombre, r.apellidos); inv.invitados.push(g); link(el.dataset.k, g.id); markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-auto') { for (const r of respData.rows) { if (inv.vinculos[respKey(r)]) continue; const g = suggestGuest(inv, r); if (g) link(respKey(r), g.id); } markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-sync') { for (const [k, gid] of Object.entries(inv.vinculos)) { const r = respData.rows.find(r => respKey(r) === k), g = inv.invitados.find(g => g.id === gid); if (r && g) applyResponse(inv, g, r); } markDirty('invitados'); renderInvitados(); }
    else if (act === 'a-reload') { await loadRespuestas(); renderInvitados(); }
  }
  function invitadosInput(el, isChange) {
    const inv = SEC.invitados.data;
    if (el.id === 'g-q') { guestFilter.q = el.value; if (isChange) return; const pos = el.selectionStart; renderInvitados(); const n = $('#g-q'); n.focus(); n.setSelectionRange(pos, pos); return; }
    if (el.id === 'g-grupo') { guestFilter.grupo = el.value; return renderInvitados(); }
    if (el.id === 'g-viene') { guestFilter.viene = el.value; return renderInvitados(); }
    if (el.id === 'g-subgrupo') { guestFilter.subgrupo = el.value; return renderInvitados(); }
    if (el.id === 'g-tipo') { guestFilter.tipo = el.value; return renderInvitados(); }
    if (el.id === 'g-import') { if (el.files[0]) importExcel(el.files[0]).catch(e => alert(e.message)); el.value = ''; return; }
    if (el.dataset.assoc !== undefined) { if (el.value) { link(el.dataset.assoc, el.value); markDirty('invitados'); renderInvitados(); } return; }
    const tr = el.closest('tr[data-id]'); if (!tr) return;
    const g = inv.invitados.find(g => g.id === tr.dataset.id); if (!g) return;
    if (el.dataset.gf) g[el.dataset.gf] = el.value; else if (el.dataset.gx) g.extra[el.dataset.gx] = el.value; else return;
    markDirty('invitados');
    if (el.dataset.gf === 'subgrupo') el.style.background = el.value ? PALETTE[hashIdx(el.value)] : '';
    if (isChange && el.tagName === 'SELECT') renderInvitados();
  }

  /* ================= MESAS ================= */
  const TIPOS_MESA = { redonda: ['Redonda', 10], cuadrada: ['Cuadrada', 8], rectangular: ['Rectangular', 14] };
  const initials = g => ((g?.nombre || '?')[0] + (g?.apellido || '')[0]).toUpperCase().replace('UNDEFINED', '');
  function seatPositions(m) {
    const n = m.plazas, pts = [];
    if (m.tipo === 'redonda') { for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI - Math.PI / 2; pts.push([110 + 62 * Math.cos(a), 75 + 62 * Math.sin(a)]); } return pts; }
    const W = m.tipo === 'rectangular' ? 150 : 90, H = m.tipo === 'rectangular' ? 46 : 90, x0 = 110 - W / 2, y0 = 75 - H / 2;
    let rest = n; if (m.tipo === 'rectangular' && m.cabecera && n >= 2) { pts.push([x0 - 18, 75], [x0 + W + 18, 75]); rest -= 2; }
    const top = Math.ceil(rest / 2), bot = rest - top;
    for (let i = 0; i < top; i++) pts.push([x0 + (W * (i + 1)) / (top + 1), y0 - 16]);
    for (let i = 0; i < bot; i++) pts.push([x0 + (W * (i + 1)) / (bot + 1), y0 + H + 16]);
    return pts;
  }
  function mesaSvg(m, byId) {
    const pts = seatPositions(m), W = m.tipo === 'rectangular' ? 150 : 90, H = m.tipo === 'rectangular' ? 46 : 90;
    const shape = m.tipo === 'redonda' ? '<circle cx="110" cy="75" r="40" class="mesa-shape" />' : `<rect x="${110 - W / 2}" y="${75 - H / 2}" width="${W}" height="${H}" rx="4" class="mesa-shape" />`;
    return `<svg viewBox="0 0 220 150" class="mesa-svg" aria-hidden="true">${shape}<text x="110" y="80" text-anchor="middle" class="mesa-num">${m.presidencial ? '★' : m.numero}</text>${pts.map(([x, y], i) => { const g = byId[m.invitados[i]]; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" class="silla${g ? ' ocupada' : ''}" /><text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle" class="silla-t">${g ? esc(initials(g)) : i + 1}</text>`; }).join('')}</svg>`;
  }
  function renderMesas() {
    const guests = SEC.invitados.data.invitados, byId = Object.fromEntries(guests.map(g => [g.id, g])), mesas = SEC.mesas.data.mesas;
    const seated = new Set(mesas.flatMap(m => m.invitados.filter(Boolean)));
    const sin = guests.filter(g => g.viene !== 'No' && !seated.has(g.id));
    const plazas = mesas.reduce((s, m) => s + m.plazas, 0);
    $('#tab-mesas').innerHTML = `
      <div class="stats"><div class="stat"><strong>${mesas.length}</strong><span>mesas</span></div><div class="stat"><strong>${plazas}</strong><span>plazas</span></div><div class="stat"><strong>${seated.size}</strong><span>sentados</span></div><div class="stat"><strong>${sin.length}</strong><span>sin mesa (no cuentan los que no vienen)</span></div></div>
      <div class="toolbar">${Object.entries(TIPOS_MESA).map(([t, [l]]) => `<button class="primary" data-act="m-add" data-t="${t}">＋ Mesa ${l.toLowerCase()}</button>`).join('')}<span class="grow"></span><button class="secondary" data-act="m-print">Imprimir</button></div>
      ${sin.length ? `<details class="assoc"><summary>Invitados sin mesa (${sin.length})</summary><p class="muted">${sin.map(g => esc(fullName(g) || '(sin nombre)')).join(' · ')}</p></details>` : ''}
      <div class="cards">${mesas.length ? [...mesas].sort((a, b) => a.numero - b.numero).map(m => {
        const free = guests.filter(g => g.viene !== 'No' && (!seated.has(g.id) || m.invitados.includes(g.id)));
        return `<article class="card" data-id="${m.id}"><div class="card-head"><label>Nº<input data-mf="numero" type="number" min="1" value="${m.numero}" class="w60" /></label><input data-mf="nombre" placeholder="Nombre de la mesa" value="${esc(m.nombre)}" /><button class="delete" data-act="m-del" aria-label="Eliminar mesa">${TRASH}</button></div>
        <div class="card-row"><select data-mf="tipo">${opts(Object.entries(TIPOS_MESA).map(([t, [l]]) => [t, l]), m.tipo)}</select><label>Plazas<input data-mf="plazas" type="number" min="1" max="40" value="${m.plazas}" class="w60" /></label><label class="chk"><input type="checkbox" data-mf="presidencial"${m.presidencial ? ' checked' : ''} /> Presidencial</label>${m.tipo === 'rectangular' ? `<label class="chk"><input type="checkbox" data-mf="cabecera"${m.cabecera ? ' checked' : ''} /> Cabecera</label>` : ''}</div>
        ${mesaSvg(m, byId)}
        <ol class="seats">${Array.from({ length: m.plazas }, (_, i) => { const cur = m.invitados[i] || ''; return `<li><select data-seat="${i}"><option value="">Silla ${i + 1} · libre</option>${free.filter(g => !m.invitados.includes(g.id) || g.id === cur).map(g => `<option value="${g.id}"${g.id === cur ? ' selected' : ''}>${esc(fullName(g) || '(sin nombre)')}${g.viene === 'Pendiente' ? ' (pendiente)' : ''}</option>`).join('')}</select></li>`; }).join('')}</ol></article>`;
      }).join('') : '<p class="empty">Añade tu primera mesa con los botones de arriba. Los invitados salen de la pestaña Invitados.</p>'}</div>`;
  }
  function mesasEvent(act, el, ev) {
    const data = SEC.mesas.data, art = el.closest('[data-id]'), m = art && data.mesas.find(m => m.id === art.dataset.id);
    if (act === 'm-add') { const t = el.dataset.t; let n = 1; const used = new Set(data.mesas.map(m => m.numero)); while (used.has(n)) n++; data.mesas.push({ id: uid(), numero: n, nombre: '', tipo: t, plazas: TIPOS_MESA[t][1], invitados: [] }); markDirty('mesas'); renderMesas(); }
    else if (act === 'm-print') window.print();
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
        <div class="table-wrap"><table class="edit"><thead><tr><th>Concepto</th><th>Proveedor</th><th>Estimado</th><th>Pagado</th><th></th></tr></thead><tbody>${partidas.filter(p => p.categoria === cat).map(p => `<tr data-id="${p.id}"><td><input data-pf="concepto" value="${esc(p.concepto)}" /></td><td><input data-pf="proveedor" value="${esc(p.proveedor)}" /></td>
          <td>${p.tipo === 'menu' ? `<span class="menu"><input data-pf="precioUnidad" data-num type="number" min="0" step="any" value="${p.precioUnidad || ''}" placeholder="€/pers." class="w80" /> × <input data-pf="cantidad" data-num type="number" min="0" value="${p.cantidad || ''}" placeholder="nº" class="w60" /><button class="link" data-act="p-fill" title="Usar los invitados que vienen">${p.concepto === 'Menú niños' ? ninos : adultos} pers.</button> = <b data-est>${eur(estimadoDe(p))}</b></span>` : `<input data-pf="estimado" data-num type="number" min="0" step="any" value="${p.estimado || ''}" class="w100" />`}</td>
          <td><input data-pf="pagado" data-num type="number" min="0" step="any" value="${p.pagado || ''}" class="w100" /></td><td class="actions-cell"><button class="delete" data-act="p-del" aria-label="Eliminar">${TRASH}</button></td></tr>`).join('')}</tbody></table></div>
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
    else if (el.dataset.pf && p) { p[el.dataset.pf] = el.dataset.num !== undefined ? Number(el.value) || 0 : el.value; markDirty('presupuesto'); if (p.tipo === 'menu') row.querySelector('[data-est]').textContent = eur(estimadoDe(p)); updateTotals(); }
  }

  /* ================= TAREAS ================= */
  const tView = { vista: 'fase', resp: '', estado: '', abierta: null };
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
        return `<details class="group" data-group="${esc(gr)}" ${ts.length && ts.some(t => est(t.id) !== 'hecho') ? 'open' : ''}><summary>${esc(gr)} <span class="muted">${all2.filter(t => est(t.id) === 'hecho').length}/${all2.length}</span></summary>
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
  function renderProveedores() {
    const manuales = SEC.proveedores.data.manuales, auto = autoProveedores(), all = [...auto, ...manuales];
    const contr = all.filter(p => p.estado === 'Contratado');
    $('#tab-proveedores').innerHTML = `<div class="stats"><div class="stat"><strong>${all.length}</strong><span>proveedores</span></div><div class="stat"><strong>${contr.length}</strong><span>contratados</span></div><div class="stat"><strong id="pv-total">${eur(contr.reduce((s, p) => s + (Number(p.importe) || 0), 0))}</strong><span>importe contratado</span></div></div>
      <div class="toolbar"><button class="primary" data-act="v-add">＋ Proveedor</button><span class="grow"></span><span class="muted">Los marcados «Contratado» en Tareas aparecen aquí solos.</span></div>
      <div class="table-wrap"><table class="edit"><thead><tr><th>Nombre</th><th>Categoría</th><th>Email</th><th>Teléfono</th><th>Estado</th><th>Importe</th><th>Qué incluye / notas</th><th></th></tr></thead><tbody>
      ${auto.map(p => `<tr class="auto"><td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td><td>${esc(p.email)}</td><td>${esc(p.telefono)}</td><td><span class="pill ok">Contratado</span></td><td>${eur(p.importe)}</td><td>${esc(p.incluye)} <span class="muted">(desde la tarea «${esc(p.desde)}»)</span></td><td></td></tr>`).join('')}
      ${manuales.map(p => `<tr data-id="${p.id}"><td><input data-vf="nombre" value="${esc(p.nombre)}" /></td><td><input data-vf="categoria" value="${esc(p.categoria)}" /></td><td><input data-vf="email" type="email" value="${esc(p.email)}" /></td><td><input data-vf="telefono" type="tel" value="${esc(p.telefono)}" /></td><td><select data-vf="estado">${opts(ESTADOS_PROV, p.estado)}</select></td><td><input data-vf="importe" data-num type="number" step="any" value="${p.importe || ''}" class="w100" /></td><td><input data-vf="incluye" value="${esc(p.incluye)}" /></td><td class="actions-cell"><button class="delete" data-act="v-del" aria-label="Eliminar">${TRASH}</button></td></tr>`).join('')}
      ${all.length ? '' : '<tr><td class="empty" colspan="8">Aún no hay proveedores.</td></tr>'}</tbody></table></div>`;
  }
  async function proveedoresEvent(act, el, ev) {
    const data = SEC.proveedores.data, row = el.closest('tr[data-id]'), p = row && data.manuales.find(p => p.id === row.dataset.id);
    if (act === 'v-add') { data.manuales.push({ id: uid(), nombre: '', categoria: '', email: '', telefono: '', estado: 'En contacto', importe: 0, incluye: '' }); markDirty('proveedores'); renderProveedores(); }
    else if (act === 'v-del') { if (await ask(`Se eliminará a ${p.nombre || 'este proveedor'}.`)) { data.manuales = data.manuales.filter(x => x.id !== p.id); markDirty('proveedores'); renderProveedores(); } }
    else if (el.dataset.vf && p) { p[el.dataset.vf] = el.dataset.num !== undefined ? Number(el.value) || 0 : el.value; markDirty('proveedores'); if (ev === 'change' && el.tagName === 'SELECT') renderProveedores(); }
  }

  /* ---------- pestañas ---------- */
  const TABS = {
    respuestas: { need: [], render: renderRespuestas },
    invitados: { need: ['invitados'], render: renderInvitados, resp: true },
    mesas: { need: ['invitados', 'mesas'], render: renderMesas },
    presupuesto: { need: ['invitados', 'presupuesto'], render: renderPresupuesto },
    proveedores: { need: ['tareas', 'proveedores'], render: renderProveedores },
    tareas: { need: ['tareas'], render: renderTareas }
  };
  let current = 'respuestas';
  async function render() {
    const tab = TABS[current];
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === current));
    document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== (current === 'respuestas' ? 'tab-respuestas' : 'tab-' + current));
    $('#actions-resp').hidden = current !== 'respuestas';
    try {
      if (current !== 'respuestas') { const tabEl = $('#tab-' + current); if (!tabEl.innerHTML.trim()) tabEl.innerHTML = '<p class="muted">Cargando…</p>'; }
      await Promise.all(tab.need.map(n => loadSec(n)));
      if ((current === 'respuestas' || tab.resp) && !respData) await loadRespuestas().catch(() => { respData = null; });
      if (current === 'respuestas' && !respData) await loadRespuestas();
      tab.render();
    } catch (e) { if (e.message !== '401') { $('#tab-' + current).innerHTML = `<p class="error">${esc(e.message || 'Error')}</p>`; } }
    loginView.hidden = true; panelView.hidden = false;
  }
  document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (!b) return; current = b.dataset.tab; history.replaceState(null, '', '#' + current); render(); });

  /* ---------- eventos delegados ---------- */
  const handlers = { invitados: invitadosClick, mesas: mesasEvent, presupuesto: presupuestoEvent, proveedores: proveedoresEvent, tareas: tareasEvent };
  document.addEventListener('click', e => {
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

  /* ---------- sesión ---------- */
  async function start() {
    const res = await fetch('/api/respuestas', { headers: headers() });
    if (res.status === 401) return unauthorized();
    if (!res.ok) return showLogin('No se han podido cargar los datos. Inténtalo más tarde.');
    respData = await res.json();
    const h = location.hash.slice(1); if (TABS[h]) current = h;
    render();
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
