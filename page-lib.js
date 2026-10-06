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

  async function adjuntarGuardados() {
    const files = archivosGuardados();
    if (!files.length) return { metodo: 'ninguno', cantidad: 0, verificado: true };
    const antes = contarMiniaturas();
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));

    const metodos = [
      ['input', () => {
        const input = document.querySelector(CFG.sel.inputArchivo);
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

  function limpiar() {
    buffer.archivos.clear();
    return true;
  }

  globalThis.__IMPORTAR_CLAUDE__ = { esperarEditor, guardarTrozo, adjuntarGuardados, escribirPrompt, limpiar };
})();
