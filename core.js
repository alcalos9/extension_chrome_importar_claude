// Lógica pura (sin chrome.* ni DOM) para importar conversaciones exportadas: lee el contenido de un ZIP,
// decide qué se adjunta y construye el mensaje inicial. Pruebas: `node tests/core.test.js`.
(function (root) {
  'use strict';

  // Límites de claude.ai por mensaje (pueden cambiar; se ajustan aquí).
  const LIMITES = { maxArchivos: 20, maxBytes: 30 * 1024 * 1024 };

  const PLANTILLA_POR_DEFECTO = [
    'Esta es la conversación que tuve con {origen}, titulada «{titulo}» ({mensajes} mensajes{fecha}). Quiero retomarla aquí como si hubiera ocurrido en este chat.',
    '',
    '- conversacion.md es la transcripción completa e indica quién escribe cada mensaje.',
    '- Los demás adjuntos son los archivos e imágenes que aparecen en ella; sus nombres coinciden con las rutas citadas en la transcripción.',
    '',
    'Léela completa y tómala como el historial real de este chat: lo dicho, las decisiones y el código ya son contexto compartido. No la resumas ni la repitas; responde solo «Listo, retomamos desde ahí» y espera mi siguiente mensaje.',
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

  // ---------- proyectos y skills exportados ----------

  const EXT_TEXTO = /\.(md|markdown|txt|csv|tsv|json|jsonl|xml|html?|css|js|mjs|ts|tsx|jsx|py|java|kt|c|h|cpp|cs|go|rs|rb|php|sh|sql|ya?ml|toml|ini|log|rtf|tex)$/i;

  // Los documentos de texto se agregan al proyecto como texto; el resto (PDF, imágenes, Office…) como archivo.
  function esTextoPlano(nombre) {
    return EXT_TEXTO.test(String(nombre));
  }

  // Qué contiene un ZIP exportado: conversaciones, proyectos (proyecto.json), skills (skill.json) o un skill suelto (SKILL.md).
  function clasificarZip(rutas) {
    const bases = (nombre) => rutas.filter((r) => r === nombre || r.endsWith('/' + nombre)).map((r) => r.slice(0, r.length - nombre.length));
    const convBases = localizarConversaciones(rutas);
    const proyBases = bases('proyecto.json');
    const skillBases = bases('skill.json');
    let skillSuelto = null;
    if (!convBases.length && !proyBases.length && !skillBases.length) {
      const md = rutas.find((r) => /^([^/]+\/)?SKILL\.md$/i.test(r));
      if (md) skillSuelto = md.slice(0, md.length - 'SKILL.md'.length);
    }
    return { convBases, proyBases, skillBases, skillSuelto };
  }

  // A qué proyecto pertenece una conversación exportada dentro de un ZIP de proyectos (la base más larga que la contiene).
  function proyectoDe(baseConv, proyBases) {
    return proyBases.filter((p) => baseConv.startsWith(p)).sort((a, b) => b.length - a.length)[0] || null;
  }

  // Conocimiento de un proyecto exportado: textos en conocimiento/ y archivos en conocimiento/archivos/.
  function planificarProyecto(base, rutas) {
    const pref = base + 'conocimiento/';
    const rel = rutas.filter((r) => r.startsWith(pref)).map((r) => ({ ruta: r, relativa: r.slice(pref.length), nombre: basename(r) }));
    return {
      docs: rel.filter((a) => !a.relativa.includes('/')),
      archivos: rel.filter((a) => a.relativa.startsWith('archivos/')),
    };
  }

  // Skill exportado: el ZIP original (<carpeta>/<nombre>.zip) o, si no está, los archivos sueltos para reconstruirlo.
  function planificarSkill(base, rutas) {
    const dentro = rutas
      .filter((r) => r.startsWith(base))
      .map((r) => ({ ruta: r, relativa: r.slice(base.length) }))
      .filter((a) => a.relativa !== 'skill.json' && !a.relativa.startsWith('debug/'));
    const zip = dentro.find((a) => /^[^/]+\.zip$/i.test(a.relativa));
    return { zipRuta: zip ? zip.ruta : null, archivos: dentro.filter((a) => a !== zip) };
  }

  const api = { esTextoPlano, clasificarZip, proyectoDe, planificarProyecto, planificarSkill, LIMITES, PLANTILLA_POR_DEFECTO, localizarConversaciones, planificarAdjuntos, construirPrompt, resumenConversacion, origenDe, basename, mimeDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
