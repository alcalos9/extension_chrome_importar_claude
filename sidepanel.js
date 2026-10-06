'use strict';

const $ = (id) => document.getElementById(id);
const TROZO_BYTES = 2250000; // múltiplo de 3: cada trozo se codifica en base64 sin relleno
const CLAVE_PLANTILLA = 'plantilla_inicial';

const convs = []; // { zip, base, conv, plan, tarjeta, boton, resultado }

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

function renderLista() {
  const cont = $('lista');
  cont.textContent = '';
  convs.forEach((c, i) => {
    const r = Core.resumenConversacion(c.conv);
    const div = document.createElement('div');
    div.className = 'conv';

    const h = document.createElement('h2');
    h.textContent = r.titulo;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${r.origen} · ${r.mensajes} mensajes · ${c.plan.adjuntos.length} archivos a adjuntar · ${c.zipNombre}`;
    div.append(h, meta);

    if (c.plan.omitidos.length) {
      const om = document.createElement('div');
      om.className = 'omitidos';
      om.textContent = `No se adjuntarán (${c.plan.omitidos.length}):\n` + c.plan.omitidos.map((o) => `• ${o.ruta} — ${o.motivo}`).join('\n');
      div.append(om);
    }

    const btn = document.createElement('button');
    btn.className = 'btn primario';
    btn.textContent = 'Preparar en Claude';
    btn.addEventListener('click', () => preparar(i));
    const res = document.createElement('div');
    res.className = 'resultado';
    div.append(btn, res);

    c.tarjeta = div;
    c.boton = btn;
    c.resultado = res;
    cont.append(div);
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

// ---------- preparar un chat ----------

async function preparar(indice) {
  const c = convs[indice];
  ocupado(true);
  c.resultado.textContent = '';
  const lineas = [];
  try {
    setEstado(`Abriendo un chat nuevo para «${c.conv.titulo}»…`);
    setProgreso(0, 0);
    const tab = await chrome.tabs.create({ url: 'https://claude.ai/new', active: true });
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
        lineas.push(`• ${a.nombre}: supera el límite de tamaño, no se adjuntó.`);
        continue;
      }
      await enviarArchivo(tab.id, a.nombre, blob);
    }

    setEstado('Adjuntando archivos en Claude… (no cambies de pestaña)');
    setProgreso(0, 0);
    await chrome.tabs.update(tab.id, { active: true });
    const adj = await enPagina(tab.id, 'adjuntarGuardados');
    log(`Adjuntos: método ${adj.metodo}, ${adj.cantidad} archivos, verificado=${adj.verificado}.`);
    if (adj.metodo === 'ninguno') lineas.push('⚠️ No se pudieron adjuntar los archivos automáticamente: arrástralos tú desde el ZIP.');
    else if (!adj.verificado) lineas.push('⚠️ No pude confirmar que todos los archivos se adjuntaron: revisa la pestaña de Claude.');

    setEstado('Escribiendo el mensaje inicial…');
    const prompt = Core.construirPrompt($('plantilla').value, c.conv);
    const w = await enPagina(tab.id, 'escribirPrompt', prompt);
    log(`Mensaje: método ${w.metodo}.`);
    await enPagina(tab.id, 'limpiar');

    if (c.plan.omitidos.length) lineas.push(`${c.plan.omitidos.length} archivo(s) quedaron fuera (ver arriba).`);
    lineas.unshift(`✓ Preparado (${adj.cantidad} adjuntos). Revisa la pestaña de Claude y pulsa Enviar.`);
    c.tarjeta.classList.add('lista');
    c.boton.textContent = 'Preparar de nuevo';
    setEstado(`«${c.conv.titulo}» preparada en Claude. No se ha enviado nada.`);
  } catch (e) {
    log(`ERROR preparando «${c.conv.titulo}»: ${e.message}`);
    lineas.unshift(`✗ ${e.message}`);
    setEstado(e.message, true);
  } finally {
    c.resultado.textContent = lineas.join('\n');
    setProgreso(0, null);
    ocupado(false);
  }
}

$('zips').addEventListener('change', alElegirZips);
$('plantilla').addEventListener('input', guardarPlantilla);
$('btn-restaurar').addEventListener('click', () => {
  $('plantilla').value = Core.PLANTILLA_POR_DEFECTO;
  guardarPlantilla();
});
cargarPlantilla();
