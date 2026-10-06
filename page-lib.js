// Se inyecta en una pestaña de claude.ai (mundo aislado). Expone globalThis.__IMPORTAR_CLAUDE__.
// Prepara el compositor: adjunta archivos y escribe el mensaje. NUNCA pulsa «Enviar».
// Todo selector que dependa de la UI de Claude vive en CFG.
(() => {
  'use strict';

  const CFG = {
    sel: {
      editor: 'div.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"], fieldset [contenteditable="true"]',
      inputArchivo: 'input[type="file"]',
      miniaturas: '[data-testid="file-thumbnail"], [data-testid*="attachment"], [data-testid*="file-preview"]',
    },
    esperaEditorMs: 20000,
    esperaMiniaturasMs: 30000,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout, paso = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(paso);
    }
    return null;
  }

  const editor = () => document.querySelector(CFG.sel.editor);

  async function esperarEditor() {
    const ed = await waitFor(editor, CFG.esperaEditorMs);
    if (!ed) throw new Error('No apareció el cuadro de mensaje de Claude (¿sesión cerrada o cambió la interfaz?).');
    return { url: location.href };
  }

  // ---------- recepción de archivos por trozos (evita argumentos gigantes) ----------

  const buffer = { archivos: new Map() };

  function b64ABytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function guardarTrozo(nombre, tipo, indice, total, b64) {
    let e = buffer.archivos.get(nombre);
    if (!e) { e = { tipo, trozos: new Array(total), recibidos: 0 }; buffer.archivos.set(nombre, e); }
    if (!e.trozos[indice]) { e.trozos[indice] = b64ABytes(b64); e.recibidos++; }
    return { nombre, recibidos: e.recibidos, total };
  }

  function archivosGuardados() {
    const files = [];
    for (const [nombre, e] of buffer.archivos) {
      if (e.recibidos !== e.trozos.length) throw new Error(`Archivo incompleto: ${nombre}`);
      files.push(new File(e.trozos, nombre, { type: e.tipo || 'application/octet-stream' }));
    }
    return files;
  }

  // ---------- adjuntar ----------

  function contarMiniaturas() {
    return document.querySelectorAll(CFG.sel.miniaturas).length;
  }

  // El input de archivos DEBE ser el del cuadro de mensaje. En la página de un proyecto existe otro input
  // (los archivos del proyecto) y usarlo subiría los adjuntos al conocimiento del proyecto.
  function inputDelComposer() {
    const ed = editor();
    const caja = ed && (ed.closest('fieldset') || ed.closest('form'));
    const dentro = caja && caja.querySelector(CFG.sel.inputArchivo);
    if (dentro) return dentro;
    return /^\/project\//.test(location.pathname) ? null : document.querySelector(CFG.sel.inputArchivo);
  }

  async function adjuntarGuardados() {
    const files = archivosGuardados();
    if (!files.length) return { metodo: 'ninguno', cantidad: 0, verificado: true };
    const antes = contarMiniaturas();
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));

    const metodos = [
      ['input', () => {
        const input = inputDelComposer();
        if (!input) return false;
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }],
      ['pegado', () => {
        const ed = editor();
        if (!ed) return false;
        ed.focus();
        ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        return true;
      }],
      ['arrastre', () => {
        const ed = editor();
        if (!ed) return false;
        ed.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        return true;
      }],
    ];

    for (const [nombre, intentar] of metodos) {
      let ok = false;
      try { ok = intentar(); } catch (e) { ok = false; }
      if (!ok) continue;
      // Verificación suave: si el selector de miniaturas no coincide, se informa «sin verificar».
      const aparecio = await waitFor(() => contarMiniaturas() >= antes + files.length, CFG.esperaMiniaturasMs);
      if (aparecio) return { metodo: nombre, cantidad: files.length, verificado: true };
      if (contarMiniaturas() > antes) return { metodo: nombre, cantidad: files.length, verificado: false, parcial: contarMiniaturas() - antes };
    }
    return { metodo: 'ninguno', cantidad: files.length, verificado: false };
  }

  // ---------- escribir el mensaje (sin enviarlo) ----------

  function textoDelEditor(ed) {
    return (ed.innerText || ed.textContent || '').replace(/\s+/g, ' ').trim();
  }

  async function escribirPrompt(texto) {
    const ed = await waitFor(editor, CFG.esperaEditorMs);
    if (!ed) throw new Error('No se encontró el cuadro de mensaje.');
    const esperado = texto.replace(/\s+/g, ' ').trim().slice(0, 40);
    ed.focus();

    // 1) execCommand: ProseMirror lo trata como escritura real.
    let ok = false;
    try { ok = document.execCommand && document.execCommand('insertText', false, texto); } catch (e) { ok = false; }
    if (ok && textoDelEditor(ed).includes(esperado)) return { metodo: 'insertText' };

    // 2) pegado de texto plano
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', texto);
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) { /* se prueba el siguiente */ }
    await sleep(200);
    if (textoDelEditor(ed).includes(esperado)) return { metodo: 'pegado' };

    // 3) último recurso: escribir el DOM directamente
    ed.textContent = '';
    texto.split('\n').forEach((linea) => {
      const p = document.createElement('p');
      p.textContent = linea;
      ed.appendChild(p);
    });
    ed.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: texto }));
    return { metodo: 'dom' };
  }

  // ---------- proyectos (API interna de claude.ai, sin documentar: puede cambiar) ----------

  async function api(ruta, opciones) {
    const r = await fetch(ruta, { credentials: 'include', headers: { 'content-type': 'application/json' }, ...opciones });
    if (!r.ok) throw new Error(`claude.ai respondió ${r.status} en ${ruta.split('?')[0].replace(/[0-9a-f-]{36}/g, '…')}`);
    return r.json();
  }

  async function organizacion() {
    const orgs = await api('/api/organizations');
    const lista = Array.isArray(orgs) ? orgs : [];
    // Se prefiere la organización con capacidad de chat; si no, la primera.
    const o = lista.find((x) => (x.capabilities || []).includes('chat')) || lista[0];
    if (!o || !o.uuid) throw new Error('No se pudo identificar tu cuenta de Claude (¿sesión cerrada?).');
    return o.uuid;
  }

  async function listarProyectos() {
    const org = await organizacion();
    const datos = await api(`/api/organizations/${org}/projects?limit=200`);
    const lista = Array.isArray(datos) ? datos : (datos.projects || datos.data || []);
    return lista
      .filter((p) => p && p.uuid && !p.archived_at)
      .map((p) => ({ uuid: p.uuid, nombre: p.name || 'Sin nombre' }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  async function crearProyecto(nombre, descripcion = '') {
    const org = await organizacion();
    const p = await api(`/api/organizations/${org}/projects`, {
      method: 'POST',
      body: JSON.stringify({ name: nombre, description: descripcion, is_private: true }),
    });
    if (!p || !p.uuid) throw new Error('claude.ai no devolvió el proyecto creado.');
    return { uuid: p.uuid, nombre: p.name || nombre };
  }

  // ---------- importar proyectos y skills (API interna, sin documentar: se prueban varias rutas) ----------

  // Como api(), pero devuelve el estado en vez de lanzar, para poder probar la siguiente ruta.
  async function llamar(metodo, ruta, cuerpo) {
    try {
      const r = await fetch(ruta, {
        method: metodo, credentials: 'include',
        ...(cuerpo instanceof FormData ? { body: cuerpo } : cuerpo !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) } : {}),
      });
      const texto = await r.text();
      let data = null;
      try { data = JSON.parse(texto); } catch (e) { data = null; }
      return { ok: r.ok, status: r.status, data, detalle: r.ok ? '' : texto.slice(0, 160) };
    } catch (e) {
      return { ok: false, status: 0, data: null, detalle: String((e && e.message) || e) };
    }
  }

  const conOrg = (ruta, org) => ruta.replace('{org}', org);

  // Instrucciones (y descripción) del proyecto: se prueba PUT y luego PATCH.
  async function configurarProyecto(uuid, nombre, descripcion, instrucciones) {
    const org = await organizacion();
    const ruta = `/api/organizations/${org}/projects/${uuid}`;
    const cuerpo = { name: nombre, description: descripcion || '', prompt_template: instrucciones || '' };
    const errores = [];
    for (const metodo of ['PUT', 'PATCH']) {
      const r = await llamar(metodo, ruta, cuerpo);
      if (r.ok) return { ok: true, metodo };
      errores.push(`${metodo} ${r.status}`);
    }
    return { ok: false, errores };
  }

  // Documento de texto en el conocimiento del proyecto.
  async function subirDocumento(uuid, nombre, contenido) {
    const org = await organizacion();
    const r = await llamar('POST', `/api/organizations/${org}/projects/${uuid}/docs`, { file_name: nombre, content: contenido });
    return { ok: r.ok, status: r.status, detalle: r.detalle };
  }

  // Sube por multipart un archivo ya recibido por trozos (clave) probando varias rutas; {org} se sustituye aquí.
  async function subirMultipart(clave, nombreArchivo, rutas, campo = 'file') {
    const e = buffer.archivos.get(clave);
    if (!e || e.recibidos !== e.trozos.length) throw new Error(`Archivo incompleto: ${nombreArchivo}`);
    const org = await organizacion();
    const intentos = [];
    for (const ruta of rutas) {
      const fd = new FormData();
      fd.append(campo, new File(e.trozos, nombreArchivo, { type: e.tipo || 'application/octet-stream' }), nombreArchivo);
      const r = await llamar('POST', conOrg(ruta, org), fd);
      if (r.ok) { buffer.archivos.delete(clave); return { ok: true, ruta: conOrg(ruta, org).replace(/[0-9a-f-]{36}/g, '…'), data: r.data }; }
      intentos.push(`${conOrg(ruta, org).replace(/[0-9a-f-]{36}/g, '…').replace(org, '…')} → ${r.status}${r.detalle ? ' ' + r.detalle.slice(0, 80) : ''}`);
      if (r.status === 401 || r.status === 403) break;
    }
    buffer.archivos.delete(clave);
    return { ok: false, intentos };
  }

  // El chat no existe hasta que el usuario pulsa Enviar. Esta vigilancia (vive mientras la pestaña no se
  // recargue) detecta el chat nuevo en la URL y le pone el título original; Claude genera uno automático
  // tras la primera respuesta, así que se reaplica durante un rato.
  function vigilarRenombre(titulo) {
    const nombre = String(titulo || '').slice(0, 200);
    if (!nombre) return false;
    if (globalThis.__IMPORTAR_VIGILANDO__) clearInterval(globalThis.__IMPORTAR_VIGILANDO__);
    const t0 = Date.now();
    let inicio = null;
    let ocupado = false;
    const id = setInterval(async () => {
      if (ocupado) return;
      const ahora = Date.now();
      if (ahora - t0 > 30 * 60 * 1000) { clearInterval(id); return; }
      const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/);
      if (!m) return;
      if (inicio === null) inicio = ahora;
      if (ahora - inicio > 90 * 1000) { clearInterval(id); return; }
      ocupado = true;
      try {
        const org = await organizacion();
        const ruta = `/api/organizations/${org}/chat_conversations/${m[1]}`;
        const actual = await api(ruta);
        if (actual && actual.name !== nombre) {
          await api(ruta, { method: 'PUT', body: JSON.stringify({ name: nombre }) });
        }
      } catch (e) { /* se reintenta en el siguiente ciclo */ }
      ocupado = false;
    }, 3000);
    globalThis.__IMPORTAR_VIGILANDO__ = id;
    return true;
  }

  function limpiar() {
    buffer.archivos.clear();
    return true;
  }

  globalThis.__IMPORTAR_CLAUDE__ = { configurarProyecto, subirDocumento, subirMultipart, vigilarRenombre, listarProyectos, crearProyecto, esperarEditor, guardarTrozo, adjuntarGuardados, escribirPrompt, limpiar };
})();
