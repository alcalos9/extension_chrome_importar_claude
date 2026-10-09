'use strict';

const $ = (id) => document.getElementById(id);
const TROZO_BYTES = 2250000; // múltiplo de 3: cada trozo se codifica en base64 sin relleno
const CLAVE_PLANTILLA = 'plantilla_inicial_v2';

const convs = []; // filas del panel: { tipo, zip, base, plan, estado, lugar, notas + elementos de la fila }

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
  document.querySelectorAll('.picker').forEach((i) => { i.disabled = si; });
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

// Cada elemento de `convs` es una fila del panel. tipo: 'conv' (conversación), 'proyecto' o 'skill'.
const dirDe = (base) => Core.basename(base.replace(/\/$/, '')) || 'sin nombre';

async function leerJson(zip, ruta, avisoNombre) {
  try {
    return JSON.parse(await zip.file(ruta).async('string'));
  } catch (e) {
    log(`«${avisoNombre}»: ${Core.basename(ruta)} ilegible (${e.message}).`);
    return null;
  }
}

async function leerZip(file, salida) {
  const zip = await JSZip.loadAsync(file);
  const rutas = Object.keys(zip.files).filter((r) => !zip.files[r].dir);
  const cl = Core.clasificarZip(rutas);
  const archivos = rutas.map((ruta) => ({ ruta, tamano: zip.files[ruta]._data && zip.files[ruta]._data.uncompressedSize }));
  const resumen = { conversaciones: 0, proyectos: 0, skills: 0 };

  const leerConv = async (base, padre) => {
    const conv = await leerJson(zip, base + 'conversacion.json', file.name);
    if (!conv) return;
    salida.push({ tipo: 'conv', zip, base, conv, plan: Core.planificarAdjuntos(base, archivos), padre, zipNombre: file.name });
    resumen.conversaciones++;
  };

  // Proyectos, cada uno seguido de sus conversaciones.
  const propios = new Set();
  for (const base of cl.proyBases) {
    const info = (await leerJson(zip, base + 'proyecto.json', file.name)) || {};
    const p = { tipo: 'proyecto', zip, base, info, nombre: info.nombre || dirDe(base), plan: Core.planificarProyecto(base, rutas), uuid: null, zipNombre: file.name };
    salida.push(p);
    resumen.proyectos++;
    for (const b of cl.convBases.filter((x) => Core.proyectoDe(x, cl.proyBases) === base)) { propios.add(b); await leerConv(b, p); }
  }
  for (const b of cl.convBases.filter((x) => !propios.has(x))) await leerConv(b, null);

  // Skills exportados (con skill.json) o un skill suelto (carpeta con SKILL.md).
  for (const base of cl.skillBases) {
    const info = (await leerJson(zip, base + 'skill.json', file.name)) || {};
    salida.push({ tipo: 'skill', zip, base, info, nombre: info.nombre || dirDe(base), plan: Core.planificarSkill(base, rutas), zipNombre: file.name });
    resumen.skills++;
  }
  if (cl.skillSuelto !== null) {
    salida.push({ tipo: 'skill', zip, base: cl.skillSuelto, info: {}, nombre: cl.skillSuelto ? dirDe(cl.skillSuelto) : file.name.replace(/\.zip$/i, ''), suelto: file, plan: { zipRuta: null, archivos: [] }, zipNombre: file.name });
    resumen.skills++;
  }
  return resumen;
}

const ESTADOS = {
  pendiente: 'Pendiente',
  trabajando: 'Importando…',
  listo: '✓ Importado',
  error: '✗ Con error',
};

const BOTON = {
  conv: ['Importar conversación', 'Importar de nuevo'],
  proyecto: ['Importar proyecto', 'Importar de nuevo'],
  skill: ['Importar skill', 'Importar de nuevo'],
};

// Pestaña a la que pertenece cada elemento (las conversaciones de un proyecto viajan con él).
const vistaDe = (c) => (c.tipo === 'skill' ? 'skill' : c.tipo === 'proyecto' || c.padre ? 'proy' : 'conv');

// Cada elemento es una fila: título, estado, lugar donde quedó y, solo si hace falta, avisos.
function pintarFila(c) {
  c.badge.textContent = c.tipo === 'conv' && c.estado === 'listo' ? '✓ Listo para enviar' : ESTADOS[c.estado];
  c.badge.className = `badge ${c.estado}`;
  c.lugarEl.textContent = c.lugar ? `Lugar: ${c.lugar}` : '';
  c.lugarEl.hidden = !c.lugar;
  c.avisos.textContent = c.notas.join('\n');
  c.avisos.hidden = !c.notas.length;
  c.fila.dataset.estado = c.estado;
  c.boton.textContent = BOTON[c.tipo][c.estado === 'pendiente' ? 0 : 1];
}

function tituloYMeta(c) {
  if (c.tipo === 'proyecto') {
    const n = convs.filter((x) => x.padre === c).length;
    return { icono: '📁', titulo: c.nombre, meta: `Proyecto · ${c.plan.docs.length + c.plan.archivos.length} archivos de conocimiento · ${n} conversaciones` };
  }
  if (c.tipo === 'skill') return { icono: '🧩', titulo: c.nombre, meta: 'Skill' };
  const r = Core.resumenConversacion(c.conv);
  return { icono: '💬', titulo: r.titulo, meta: `${r.origen} · ${r.mensajes} mensajes · ${c.plan.adjuntos.length} archivos${c.padre ? ` · dentro del proyecto «${c.padre.nombre}»` : ''}` };
}

function renderLista() {
  ['conv', 'proy', 'skill'].forEach((v) => { $(`lista-${v}`).textContent = ''; });
  convs.forEach((c, i) => {
    const cont = $(`lista-${vistaDe(c)}`);
    const t = tituloYMeta(c);
    const fila = document.createElement('div');
    fila.className = c.padre ? 'conv hija' : 'conv';

    const cab = document.createElement('div');
    cab.className = 'cab';
    const h = document.createElement('h2');
    h.textContent = `${t.icono} ${t.titulo}`;
    const badge = document.createElement('span');
    cab.append(h, badge);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = t.meta;
    const lugarEl = document.createElement('div');
    lugarEl.className = 'lugar';
    const avisos = document.createElement('div');
    avisos.className = 'avisos';

    const btn = document.createElement('button');
    btn.className = 'btn primario peq';
    btn.addEventListener('click', () => accionFila(i));
    const pie = document.createElement('div');
    pie.className = 'pie';
    pie.append(btn);

    fila.append(cab, meta, lugarEl, avisos, pie);
    const primera = c.estado === undefined;
    Object.assign(c, { fila, badge, lugarEl, avisos, boton: btn, estado: c.estado || 'pendiente', lugar: c.lugar || '', notas: c.notas || [] });
    if (primera && c.tipo === 'conv' && c.plan.omitidos.length) c.notas.push(`${c.plan.omitidos.length} archivo(s) no se adjuntarán: ${c.plan.omitidos.map((o) => o.motivo).filter((m, k, arr) => arr.indexOf(m) === k).join('; ')}.`);
    pintarFila(c);
    cont.append(fila);
  });
}

const NOMBRE_VISTA = { conv: 'conversaciones', proy: 'proyectos', skill: 'skills' };

function mostrarVista(v) {
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.vista === v)));
  document.querySelectorAll('.vista').forEach((el) => { el.hidden = el.id !== `vista-${v}`; });
}

async function alElegirZips(ev, vista) {
  const files = [...ev.target.files];
  ev.target.value = '';
  if (!files.length) return;
  ocupado(true);
  setProgreso(0, 0);
  setEstado('Leyendo ZIP…');
  try {
    const nuevos = [];
    for (const f of files) {
      const r = await leerZip(f, nuevos);
      const partes = [];
      if (r.proyectos) partes.push(`${r.proyectos} proyecto(s)`);
      if (r.skills) partes.push(`${r.skills} skill(s)`);
      if (r.conversaciones) partes.push(`${r.conversaciones} conversación(es)`);
      log(partes.length ? `«${f.name}»: ${partes.join(', ')}.` : `«${f.name}» no contiene conversaciones, proyectos ni skills de estas extensiones.`);
    }
    // Lo nuevo reemplaza lo anterior de la misma pestaña; las demás pestañas no se tocan.
    const vistas = new Set(nuevos.map(vistaDe));
    for (let i = convs.length - 1; i >= 0; i--) if (vistas.has(vistaDe(convs[i]))) convs.splice(i, 1);
    convs.push(...nuevos);
    renderLista();
    if (!nuevos.length) {
      setEstado('No encontré nada que importar en ese ZIP. ¿Es uno exportado con las extensiones «Exportar Chats»?', true);
    } else if (vistas.has(vista)) {
      setEstado(`Listo: pulsa el botón azul de cada elemento para importarlo.`);
    } else {
      const v = [...vistas][0];
      mostrarVista(v);
      setEstado(`Ese ZIP trae ${NOMBRE_VISTA[v]}: te llevé a la pestaña correspondiente.`);
    }
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

// ---------- importar proyectos y skills ----------

// Ejecuta `fn(tabId)` con una pestaña de claude.ai; si hubo que abrirla, la cierra al terminar.
async function conPestanaClaude(fn) {
  const t = await pestanaClaude();
  try {
    return await fn(t.id);
  } finally {
    if (t.creada) chrome.tabs.remove(t.id).catch(() => {});
  }
}

let claveSeq = 0;

// Envía un archivo del ZIP a la pestaña y lo sube por multipart; devuelve {ok, intentos?}.
async function subirArchivoMultipart(tabId, blob, nombre, rutas) {
  const clave = `subida${++claveSeq}/${nombre}`;
  await enviarArchivo(tabId, clave, blob);
  return enPagina(tabId, 'subirMultipart', clave, nombre, rutas, 'file');
}

// Crea el proyecto en Claude con sus instrucciones y su conocimiento. Es idempotente: se hace una sola vez por proyecto.
async function importarProyecto(p) {
  if (p.uuid) return p;
  const notas = [];
  p.estado = 'trabajando';
  p.lugar = '';
  p.notas = [];
  pintarFila(p);
  try {
    await conPestanaClaude(async (tabId) => {
      const paso = (m) => setEstado(`Proyecto «${p.nombre}»: ${m}`);
      paso('creándolo…');
      const nuevo = await enPagina(tabId, 'crearProyecto', p.nombre, p.info.descripcion || '');
      p.uuid = nuevo.uuid;
      log(`Proyecto creado: ${nuevo.nombre} (${nuevo.uuid}).`);
      p.lugar = `proyecto nuevo «${nuevo.nombre}»`;
      pintarFila(p);

      const insFile = p.zip.file(p.base + 'instrucciones.md');
      const instrucciones = insFile ? await insFile.async('string') : (p.info.instrucciones || '');
      if (instrucciones.trim()) {
        paso('escribiendo las instrucciones…');
        const r = await enPagina(tabId, 'configurarProyecto', p.uuid, p.nombre, p.info.descripcion || '', instrucciones);
        if (!r.ok) notas.push(`No se pudieron fijar las instrucciones automáticamente (${r.errores.join(', ')}): pégalas desde instrucciones.md.`);
      }

      const todos = [...p.plan.docs.map((d) => ({ ...d, via: 'doc' })), ...p.plan.archivos.map((a) => ({ ...a, via: 'archivo' }))];
      let multipartFalla = false;
      const sinSubir = [];
      for (let i = 0; i < todos.length; i++) {
        const a = todos[i];
        paso(`subiendo conocimiento ${i + 1}/${todos.length}…`);
        setProgreso(i, todos.length);
        let ok = false;
        if (Core.esTextoPlano(a.nombre)) {
          const r = await enPagina(tabId, 'subirDocumento', p.uuid, a.nombre, await p.zip.file(a.ruta).async('string'));
          ok = r.ok;
          if (!ok) log(`Documento «${a.nombre}»: respuesta ${r.status} ${r.detalle || ''}`);
        } else if (!multipartFalla) {
          const blob = await p.zip.file(a.ruta).async('blob');
          if (blob.size <= Core.LIMITES.maxBytes) {
            const rutas = [`/api/organizations/{org}/projects/${p.uuid}/upload`, `/api/organizations/{org}/projects/${p.uuid}/files`];
            const r = await subirArchivoMultipart(tabId, blob, a.nombre, rutas);
            ok = r.ok;
            if (!ok) { multipartFalla = true; log(`Archivo «${a.nombre}»: ${(r.intentos || []).join(' | ')}`); }
          }
        }
        if (!ok) sinSubir.push(a.nombre);
      }
      setProgreso(0, 0);
      if (sinSubir.length) notas.push(`No se pudieron subir ${sinSubir.length} archivo(s) de conocimiento: ${sinSubir.slice(0, 4).join(', ')}${sinSubir.length > 4 ? '…' : ''}. Agrégalos a mano desde la carpeta «conocimiento» del ZIP.`);
    });
    p.estado = 'listo';
  } catch (e) {
    log(`ERROR importando el proyecto «${p.nombre}»: ${e.message}`);
    p.estado = p.uuid ? 'listo' : 'error';
    notas.unshift(p.uuid ? `Proyecto creado, pero falló un paso: ${e.message}` : e.message);
  } finally {
    p.notas = notas;
    pintarFila(p);
  }
  return p;
}

async function accionImportarProyecto(c) {
  if (c.estado === 'listo' && !confirm(`El proyecto «${c.nombre}» ya se importó.\n\nSi continúas se creará OTRO proyecto con el mismo nombre. ¿Crear otro?`)) return;
  c.uuid = null;
  ocupado(true);
  try {
    await importarProyecto(c);
    if (c.estado === 'listo') setEstado(`Proyecto «${c.nombre}» importado. Ahora puedes preparar sus conversaciones.`);
  } finally {
    setProgreso(0, null);
    ocupado(false);
  }
}

const RUTAS_SKILL = [
  '/api/organizations/{org}/skills/upload-skill',
  '/api/organizations/{org}/skills/create-skill',
  '/api/organizations/{org}/skills/upload',
  '/api/organizations/{org}/skills',
];

// El ZIP del skill: el original exportado, el archivo suelto elegido o, si no hay otro, uno reconstruido.
async function zipDelSkill(c) {
  if (c.suelto) return c.suelto;
  if (c.plan.zipRuta) return c.zip.file(c.plan.zipRuta).async('blob');
  const nuevo = new JSZip();
  const raiz = nuevo.folder(c.nombre.replace(/[\\/:*?"<>|]+/g, '_'));
  for (const a of c.plan.archivos) raiz.file(a.relativa, await c.zip.file(a.ruta).async('blob'));
  return nuevo.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

function descargarBlob(blob, nombre) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function accionSubirSkill(c) {
  if (c.estado === 'listo' && !confirm(`El skill «${c.nombre}» ya se subió.\n\n¿Subirlo otra vez?`)) return;
  ocupado(true);
  c.estado = 'trabajando';
  c.lugar = '';
  c.notas = [];
  pintarFila(c);
  setProgreso(0, 0);
  try {
    setEstado(`Subiendo el skill «${c.nombre}»…`);
    const blob = await zipDelSkill(c);
    const nombreZip = `${c.nombre.replace(/[\\/:*?"<>|]+/g, '_')}.zip`;
    const r = await conPestanaClaude((tabId) => subirArchivoMultipart(tabId, blob, nombreZip, RUTAS_SKILL));
    if (r.ok) {
      c.estado = 'listo';
      c.lugar = 'Configuración → Capacidades → Skills';
      c.notas = ['Revisa que aparezca en esa lista y que esté activado.'];
    } else {
      log(`Skill «${c.nombre}»: ${(r.intentos || []).join(' | ')}`);
      descargarBlob(blob, nombreZip);
      c.estado = 'error';
      c.notas = [`Claude no aceptó la subida automática. Te descargué «${nombreZip}»: súbelo tú en Configuración → Capacidades → Skills → Subir skill.`];
    }
  } catch (e) {
    log(`ERROR subiendo el skill «${c.nombre}»: ${e.message}`);
    c.estado = 'error';
    c.notas = [e.message];
  } finally {
    setEstado('');
    setProgreso(0, null);
    pintarFila(c);
    ocupado(false);
  }
}

function accionFila(i) {
  const c = convs[i];
  if (c.tipo === 'proyecto') return accionImportarProyecto(c);
  if (c.tipo === 'skill') return accionSubirSkill(c);
  return preparar(i);
}

// ---------- preparar un chat ----------

async function preparar(indice) {
  const c = convs[indice];
  if (c.estado === 'listo' &&
      !confirm(`«${c.conv.titulo}» ya se importó a Claude.\n\nSi ya enviaste el mensaje, se creará un chat duplicado. ¿Importarla otra vez?`)) return;
  ocupado(true);
  const avisosOmitidos = c.notas.filter((n) => /no se adjuntarán/.test(n));
  const lineas = [];
  c.estado = 'trabajando';
  c.lugar = '';
  c.notas = [...avisosOmitidos];
  pintarFila(c);
  try {
    setProgreso(0, 0);
    let destino;
    if (c.padre) {
      // Conversación de un proyecto exportado: va dentro de ese proyecto (se crea antes si hace falta).
      await importarProyecto(c.padre);
      if (!c.padre.uuid) throw new Error(`No se pudo crear el proyecto «${c.padre.nombre}»: ${c.padre.notas[0] || 'revisa el Registro'}`);
      destino = { url: `https://claude.ai/project/${c.padre.uuid}`, lugar: `proyecto «${c.padre.nombre}»` };
    } else {
      destino = await resolverDestino();
    }
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
    c.notas = ['Falta un paso: ve a la pestaña de Claude, revisa y pulsa Enviar.', ...avisosOmitidos, ...lineas];
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

document.querySelectorAll('.picker').forEach((i) => i.addEventListener('change', (ev) => alElegirZips(ev, i.dataset.vista)));
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => mostrarVista(t.dataset.vista)));
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
setEstado('');
