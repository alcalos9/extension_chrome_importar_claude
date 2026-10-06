'use strict';

const $ = (id) => document.getElementById(id);
const TROZO_BYTES = 2250000; // múltiplo de 3: cada trozo se codifica en base64 sin relleno
const CLAVE_PLANTILLA = 'plantilla_inicial_v2';

const convs = []; // { zip, base, conv, plan, estado, lugar, notas + elementos de la fila }

// ---------- UI ----------

function log(msg) {
  $('log').textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`;
}

function setEstado(msg, esError = false) {
  $('estado').textContent = msg;
  $('estado').classList.toggle('error', esError);
}

function setProgreso(hecho, total) {
  const p = $('progreso');
  if (total == null) { p.hidden = true; return; }
  p.hidden = false;
  if (!total) { p.removeAttribute('value'); return; }
  p.max = total;
  p.value = hecho;
}

function ocupado(si) {
  document.querySelectorAll('.conv button').forEach((b) => { b.disabled = si; });
  $('zips').disabled = si;
}

function cargarPlantilla() {
  let t = null;
  try { t = localStorage.getItem(CLAVE_PLANTILLA); } catch (e) { /* sin almacenamiento */ }
  $('plantilla').value = t || Core.PLANTILLA_POR_DEFECTO;
}

function guardarPlantilla() {
  try { localStorage.setItem(CLAVE_PLANTILLA, $('plantilla').value); } catch (e) { /* opcional */ }
}

// ---------- lectura de los ZIP ----------

async function leerZip(file) {
  const zip = await JSZip.loadAsync(file);
  const rutas = Object.keys(zip.files).filter((r) => !zip.files[r].dir);
  const bases = Core.localizarConversaciones(rutas);
  if (!bases.length) {
    log(`«${file.name}» no contiene conversacion.json: no parece una exportación de estas extensiones.`);
    return 0;
  }
  for (const base of bases) {
    let conv;
    try {
      conv = JSON.parse(await zip.file(base + 'conversacion.json').async('string'));
    } catch (e) {
      log(`«${file.name}»: conversacion.json ilegible (${e.message}).`);
      continue;
    }
    const archivos = rutas.map((ruta) => ({ ruta, tamano: zip.files[ruta]._data && zip.files[ruta]._data.uncompressedSize }));
    const plan = Core.planificarAdjuntos(base, archivos);
    convs.push({ zip, base, conv, plan, zipNombre: file.name });
  }
  return bases.length;
}

const ESTADOS = {
  pendiente: 'Sin preparar',
  trabajando: 'Preparando…',
  listo: '✓ Preparada',
  error: '✗ Con error',
};

// Cada conversación es una fila: título, estado, lugar donde quedó y, solo si hace falta, avisos.
function pintarFila(c) {
  c.badge.textContent = ESTADOS[c.estado];
  c.badge.className = `badge ${c.estado}`;
  c.lugarEl.textContent = c.lugar ? `Lugar: ${c.lugar}` : '';
  c.lugarEl.hidden = !c.lugar;
  c.avisos.textContent = c.notas.join('\n');
  c.avisos.hidden = !c.notas.length;
  c.fila.dataset.estado = c.estado;
  c.boton.textContent = c.estado === 'pendiente' ? 'Preparar' : 'Preparar de nuevo';
}

function renderLista() {
  const cont = $('lista');
  cont.textContent = '';
  convs.forEach((c, i) => {
    const r = Core.resumenConversacion(c.conv);
    const fila = document.createElement('div');
    fila.className = 'conv';

    const cab = document.createElement('div');
    cab.className = 'cab';
    const h = document.createElement('h2');
    h.textContent = r.titulo;
    const badge = document.createElement('span');
    cab.append(h, badge);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${r.origen} · ${r.mensajes} mensajes · ${c.plan.adjuntos.length} archivos`;
    const lugarEl = document.createElement('div');
    lugarEl.className = 'lugar';
    const avisos = document.createElement('div');
    avisos.className = 'avisos';

    const btn = document.createElement('button');
    btn.className = 'btn secundario peq';
    btn.addEventListener('click', () => preparar(i));
    const pie = document.createElement('div');
    pie.className = 'pie';
    pie.append(btn);

    fila.append(cab, meta, lugarEl, avisos, pie);
    Object.assign(c, { fila, badge, lugarEl, avisos, boton: btn, estado: 'pendiente', lugar: '', notas: [] });
    if (c.plan.omitidos.length) c.notas.push(`${c.plan.omitidos.length} archivo(s) no se adjuntarán: ${c.plan.omitidos.map((o) => o.motivo).filter((m, k, arr) => arr.indexOf(m) === k).join('; ')}.`);
    pintarFila(c);
    cont.append(fila);
  });
}

async function alElegirZips(ev) {
  const files = [...ev.target.files];
  ev.target.value = '';
  if (!files.length) return;
  ocupado(true);
  setProgreso(0, 0);
  setEstado('Leyendo ZIP…');
  convs.length = 0;
  try {
    for (const f of files) {
      const n = await leerZip(f);
      log(`«${f.name}»: ${n} conversación(es).`);
    }
    renderLista();
    setEstado(convs.length ? `${convs.length} conversación(es) lista(s) para importar.` : 'No se encontró ninguna conversación válida.', !convs.length);
  } catch (e) {
    log(`ERROR leyendo ZIP: ${e.message}`);
    setEstado(`No se pudo leer el ZIP: ${e.message}`, true);
  } finally {
    setProgreso(0, null);
    ocupado(false);
  }
}

// ---------- puente con la página ----------

async function enPagina(tabId, nombre, ...args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (fn, a) => {
      try {
        return { ok: true, valor: await globalThis.__IMPORTAR_CLAUDE__[fn](...a) };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    args: [nombre, args],
  });
  if (!res || !res.result) throw new Error('La pestaña de Claude no respondió (¿se cerró o cambió de página?).');
  if (!res.result.ok) throw new Error(res.result.error);
  return res.result.valor;
}

async function esperarPestana(tabId, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') return t;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('La pestaña de Claude tardó demasiado en cargar.');
}

function aBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function enviarArchivo(tabId, nombre, blob) {
  const total = Math.max(1, Math.ceil(blob.size / TROZO_BYTES));
  const tipo = Core.mimeDe(nombre);
  for (let i = 0; i < total; i++) {
    const b64 = await aBase64(blob.slice(i * TROZO_BYTES, (i + 1) * TROZO_BYTES));
    await enPagina(tabId, 'guardarTrozo', nombre, tipo, i, total, b64);
  }
}

// ---------- proyectos ----------

// Las consultas de proyectos van por una pestaña de claude.ai (necesitan su sesión).
async function pestanaClaude() {
  const inyectar = (id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ['page-lib.js'] });
  // Se prueban las pestañas de claude.ai ya abiertas (sin esperar a que terminen de cargar: pueden quedar
  // en «cargando» por conexiones permanentes); las descartadas o no accesibles se saltan.
  const abiertas = (await chrome.tabs.query({ url: 'https://claude.ai/*' })).filter((t) => !t.discarded);
  abiertas.sort((a, b) => Number(b.active) - Number(a.active));
  for (const t of abiertas) {
    try {
      await inyectar(t.id);
      return { id: t.id, creada: false };
    } catch (e) {
      log(`Pestaña de claude.ai no utilizable (${e.message}).`);
    }
  }
  const tab = await chrome.tabs.create({ url: 'https://claude.ai/new', active: false });
  await esperarPestana(tab.id);
  try {
    await inyectar(tab.id);
  } catch (e) {
    chrome.tabs.remove(tab.id).catch(() => {});
    throw e;
  }
  return { id: tab.id, creada: true };
}

async function conClaude(fn, ...args) {
  const t = await pestanaClaude();
  try {
    return await enPagina(t.id, fn, ...args);
  } finally {
    if (t.creada) chrome.tabs.remove(t.id).catch(() => {});
  }
}

let proyectosCargados = false;

const modo = () => document.querySelector('input[name="modo"]:checked').value;

function actualizarDestinoUI() {
  const m = modo();
  $('detalle-existente').hidden = m !== 'existente';
  $('detalle-nuevo').hidden = m !== 'nuevo';
  $('ayuda-nuevo').hidden = m !== 'nuevo';
  if (m === 'existente' && !proyectosCargados) cargarProyectos();
  if (m === 'nuevo') $('nombre-proyecto').focus();
}

function agregarOpcionProyecto(p) {
  const o = document.createElement('option');
  o.value = p.uuid;
  o.textContent = p.nombre;
  $('sel-proyecto').append(o);
  return o;
}

async function cargarProyectos(dentroDeImportacion = false) {
  if (!dentroDeImportacion) ocupado(true);
  $('btn-proyectos').disabled = true;
  setEstado('Consultando tus proyectos de Claude…');
  try {
    const lista = await conClaude('listarProyectos');
    const sel = $('sel-proyecto');
    const previo = sel.value;
    sel.textContent = '';
    const guia = document.createElement('option');
    guia.value = '';
    guia.textContent = lista.length ? 'Elige un proyecto…' : 'No tienes proyectos todavía';
    sel.append(guia);
    lista.forEach(agregarOpcionProyecto);
    if ([...sel.options].some((o) => o.value === previo)) sel.value = previo;
    proyectosCargados = true;
    log(`Proyectos: ${lista.length} (${lista.map((p) => p.nombre).join(', ') || 'ninguno'}).`);
    setEstado(lista.length ? `${lista.length} proyecto(s) disponible(s).` : 'No tienes proyectos: usa «proyecto nuevo» o «chat suelto».');
  } catch (e) {
    log(`ERROR cargando proyectos: ${e.message}`);
    setEstado(`No se pudieron cargar los proyectos: ${e.message}`, true);
  } finally {
    if (!dentroDeImportacion) ocupado(false);
    $('btn-proyectos').disabled = false;
  }
}

// Devuelve dónde abrir el chat: chat suelto, proyecto existente o proyecto recién creado.
async function resolverDestino() {
  const m = modo();
  if (m === 'suelto') return { url: 'https://claude.ai/new', lugar: 'chat suelto' };

  if (m === 'existente') {
    const sel = $('sel-proyecto');
    if (!sel.value) throw new Error('Elige un proyecto de la lista (o cambia la opción de destino).');
    return { url: `https://claude.ai/project/${sel.value}`, lugar: `proyecto «${sel.selectedOptions[0].textContent}»` };
  }

  const p = await crearProyectoNuevo();
  return { url: `https://claude.ai/project/${p.uuid}`, lugar: `proyecto nuevo «${p.nombre}»` };
}

// Crea el proyecto con el nombre escrito y deja ese proyecto seleccionado como destino.
async function crearProyectoNuevo() {
  const nombre = $('nombre-proyecto').value.trim();
  if (!nombre) throw new Error('Escribe el nombre del proyecto nuevo.');
  setEstado(`Creando el proyecto «${nombre}»…`);
  const p = await conClaude('crearProyecto', nombre);
  log(`Proyecto creado: ${p.nombre} (${p.uuid}).`);
  // Las demás conversaciones del lote se agregan a este mismo proyecto, sin crear otro.
  if (!proyectosCargados) await cargarProyectos(true);
  else if (![...$('sel-proyecto').options].some((o) => o.value === p.uuid)) agregarOpcionProyecto(p);
  $('sel-proyecto').value = p.uuid;
  $('nombre-proyecto').value = '';
  document.querySelector('input[name="modo"][value="existente"]').checked = true;
  actualizarDestinoUI();
  return p;
}

async function alPulsarCrear() {
  ocupado(true);
  $('btn-crear').disabled = true;
  try {
    const p = await crearProyectoNuevo();
    setEstado(`Proyecto «${p.nombre}» creado. Las conversaciones que prepares quedarán dentro.`);
  } catch (e) {
    log(`ERROR creando proyecto: ${e.message}`);
    setEstado(`No se pudo crear el proyecto: ${e.message}`, true);
  } finally {
    ocupado(false);
    $('btn-crear').disabled = false;
  }
}

// ---------- preparar un chat ----------

async function preparar(indice) {
  const c = convs[indice];
  if (c.estado === 'listo' &&
      !confirm(`«${c.conv.titulo}» ya se preparó en Claude.\n\nSi ya enviaste el mensaje, se creará un chat duplicado. ¿Preparar otro chat?`)) return;
  ocupado(true);
  const avisosOmitidos = c.notas.filter((n) => /no se adjuntarán/.test(n));
  const lineas = [];
  c.estado = 'trabajando';
  c.lugar = '';
  c.notas = [...avisosOmitidos];
  pintarFila(c);
  try {
    setProgreso(0, 0);
    const destino = await resolverDestino();
    c.lugar = destino.lugar;
    pintarFila(c);
    setEstado(`Abriendo un chat nuevo para «${c.conv.titulo}»…`);
    const tab = await chrome.tabs.create({ url: destino.url, active: true });
    await esperarPestana(tab.id);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-lib.js'] });
    await enPagina(tab.id, 'esperarEditor');

    const total = c.plan.adjuntos.length;
    for (let i = 0; i < total; i++) {
      const a = c.plan.adjuntos[i];
      setEstado(`Enviando ${a.nombre} a la pestaña (${i + 1}/${total})…`);
      setProgreso(i, total);
      const blob = await c.zip.file(a.ruta).async('blob');
      if (blob.size > Core.LIMITES.maxBytes) {
        lineas.push(`${a.nombre} supera el límite de tamaño y no se adjuntó.`);
        continue;
      }
      await enviarArchivo(tab.id, a.nombre, blob);
    }

    setEstado('Adjuntando archivos en Claude… (no cambies de pestaña)');
    setProgreso(0, 0);
    await chrome.tabs.update(tab.id, { active: true });
    const adj = await enPagina(tab.id, 'adjuntarGuardados');
    log(`Adjuntos: método ${adj.metodo}, ${adj.cantidad} archivos, verificado=${adj.verificado}.`);
    if (adj.metodo === 'ninguno') lineas.push('No se pudieron adjuntar los archivos: arrástralos tú desde el ZIP.');
    else if (!adj.verificado) lineas.push('No pude confirmar todos los adjuntos: revisa la pestaña de Claude.');

    setEstado('Escribiendo el mensaje inicial…');
    const prompt = Core.construirPrompt($('plantilla').value, c.conv);
    const w = await enPagina(tab.id, 'escribirPrompt', prompt);
    log(`Mensaje: método ${w.metodo}.`);
    await enPagina(tab.id, 'vigilarRenombre', c.conv.titulo);
    await enPagina(tab.id, 'limpiar');

    c.estado = 'listo';
    c.notas = [...avisosOmitidos, ...lineas];
    setEstado('');
  } catch (e) {
    log(`ERROR preparando «${c.conv.titulo}»: ${e.message}`);
    c.estado = 'error';
    c.notas = [e.message, ...lineas];
    setEstado('');
  } finally {
    pintarFila(c);
    setProgreso(0, null);
    ocupado(false);
  }
}

$('zips').addEventListener('change', alElegirZips);
$('btn-proyectos').addEventListener('click', () => cargarProyectos());
$('btn-crear').addEventListener('click', alPulsarCrear);
$('nombre-proyecto').addEventListener('keydown', (e) => { if (e.key === 'Enter') alPulsarCrear(); });
document.querySelectorAll('input[name="modo"]').forEach((r) => r.addEventListener('change', actualizarDestinoUI));
$('plantilla').addEventListener('input', guardarPlantilla);
$('btn-restaurar').addEventListener('click', () => {
  $('plantilla').value = Core.PLANTILLA_POR_DEFECTO;
  guardarPlantilla();
});
cargarPlantilla();
setEstado('Elige uno o más ZIP para empezar.');
