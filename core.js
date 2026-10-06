// Lógica pura (sin chrome.* ni DOM) para importar conversaciones exportadas: lee el contenido de un ZIP,
// decide qué se adjunta y construye el mensaje inicial. Pruebas: `node tests/core.test.js`.
(function (root) {
  'use strict';

  // Límites de claude.ai por mensaje (pueden cambiar; se ajustan aquí).
  const LIMITES = { maxArchivos: 20, maxBytes: 30 * 1024 * 1024 };

  const PLANTILLA_POR_DEFECTO = [
    'Te adjunto una conversación anterior que mantuve con {origen}, titulada «{titulo}» ({mensajes} mensajes{fecha}).',
    '',
    '- conversacion.md es la transcripción completa e indica quién escribe cada mensaje.',
    '- Los demás adjuntos son los archivos e imágenes que aparecen en ella; sus nombres coinciden con las rutas citadas en la transcripción.',
    '',
    'Léela completa y respóndeme solo con un resumen breve de qué trata y en qué punto quedó. Después continuaremos desde ahí.',
  ].join('\n');

  function basename(ruta) {
    return String(ruta).split('/').pop();
  }

  // Un ZIP exportado tiene <carpeta>/conversacion.json; se tolera cualquier profundidad.
  function localizarConversaciones(rutas) {
    const bases = [];
    for (const r of rutas) {
      if (/(^|\/)conversacion\.json$/.test(r)) bases.push(r.slice(0, r.length - 'conversacion.json'.length));
    }
    return bases;
  }

  function origenDe(conv) {
    const roles = (conv.mensajes || []).map((m) => m.rol);
    return roles.includes('ChatGPT') ? 'ChatGPT' : 'Claude';
  }

  // Decide qué archivos de la carpeta exportada se adjuntan, por prioridad:
  // 1) la transcripción, 2) documentos, 3) imágenes. Respeta los límites del chat.
  function planificarAdjuntos(base, archivos, limites = LIMITES) {
    // archivos: [{ ruta, tamano? }] con rutas completas del ZIP
    const rel = archivos
      .filter((a) => a.ruta.startsWith(base) && !a.ruta.endsWith('/'))
      .map((a) => ({ ...a, relativa: a.ruta.slice(base.length), nombre: basename(a.ruta) }));

    const md = rel.find((a) => a.relativa === 'conversacion.md');
    const docs = rel.filter((a) => a.relativa.startsWith('archivos/'));
    const imgs = rel.filter((a) => a.relativa.startsWith('imagenes/'));

    const nombresDocs = new Set(docs.map((d) => d.nombre));
    const omitidos = [];
    const candidatos = [];
    if (md) candidatos.push({ ...md, tipo: 'transcripcion' });
    else omitidos.push({ ruta: base + 'conversacion.md', motivo: 'no existe conversacion.md en el ZIP' });

    for (const d of docs) {
      // El texto extraído sobra si también está el archivo original.
      if (/\.extraido\.txt$/i.test(d.nombre) && nombresDocs.has(d.nombre.replace(/\.extraido\.txt$/i, ''))) {
        omitidos.push({ ruta: d.relativa, motivo: 'texto extraído redundante (se adjunta el original)' });
      } else candidatos.push({ ...d, tipo: 'documento' });
    }
    for (const i of imgs) candidatos.push({ ...i, tipo: 'imagen' });

    const adjuntos = [];
    const usados = new Set();
    for (const c of candidatos) {
      if (c.tamano != null && c.tamano > limites.maxBytes) {
        omitidos.push({ ruta: c.relativa, motivo: `supera ${Math.round(limites.maxBytes / 1024 / 1024)} MB` });
      } else if (adjuntos.length >= limites.maxArchivos) {
        omitidos.push({ ruta: c.relativa, motivo: `límite de ${limites.maxArchivos} archivos por mensaje` });
      } else if (usados.has(c.nombre)) {
        omitidos.push({ ruta: c.relativa, motivo: 'nombre repetido' });
      } else {
        usados.add(c.nombre);
        adjuntos.push(c);
      }
    }
    return { adjuntos, omitidos };
  }

  const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', json: 'application/json',
    html: 'text/html', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };

  function mimeDe(nombre) {
    const m = String(nombre).toLowerCase().match(/\.([a-z0-9]+)$/);
    return (m && MIME[m[1]]) || 'application/octet-stream';
  }

  function construirPrompt(plantilla, conv) {
    const f = conv.creada ? `, creada el ${String(conv.creada).slice(0, 10)}` : '';
    const valores = {
      origen: origenDe(conv),
      titulo: conv.titulo || 'Sin título',
      mensajes: String((conv.mensajes || []).length),
      fecha: f,
    };
    return String(plantilla || PLANTILLA_POR_DEFECTO).replace(/\{(origen|titulo|mensajes|fecha)\}/g, (_, k) => valores[k]);
  }

  function resumenConversacion(conv) {
    const msgs = conv.mensajes || [];
    const nAdj = msgs.reduce((n, m) => n + (m.adjuntos || []).length, 0);
    return { titulo: conv.titulo || 'Sin título', origen: origenDe(conv), mensajes: msgs.length, adjuntosCitados: nAdj };
  }

  const api = { LIMITES, PLANTILLA_POR_DEFECTO, localizarConversaciones, planificarAdjuntos, construirPrompt, resumenConversacion, origenDe, basename, mimeDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
