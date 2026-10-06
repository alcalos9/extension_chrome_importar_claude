// Ejecutar: node tests/core.test.js
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const Core = require('../core.js');

(async () => {
  // ZIP con la misma estructura que generan las dos extensiones exportadoras
  const zip = new JSZip();
  const raiz = zip.folder('analisis_de_compra_de_auto');
  raiz.file('conversacion.json', JSON.stringify({ titulo: 'Análisis de compra de auto', creada: '2025-10-03T12:00:00Z', mensajes: [{ rol: 'Usuario' }, { rol: 'Claude' }] }));
  raiz.file('conversacion.md', '# Análisis\n');
  raiz.file('informe.txt', 'ok');
  raiz.file('debug/api_raw.json', '{}');
  raiz.file('archivos/msg001_usuario_pdf_1.pdf', 'PDF');
  raiz.file('archivos/msg001_usuario_pdf_1.pdf.extraido.txt', 'texto');            // redundante
  raiz.file('archivos/msg001_usuario_solo_texto.txt.extraido.txt', 'texto pegado'); // sin original → se conserva
  raiz.file('imagenes/msg002_claude_foto.png', 'PNG');
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const cargado = await JSZip.loadAsync(bytes);
  const rutas = Object.keys(cargado.files).filter((r) => !cargado.files[r].dir);

  const bases = Core.localizarConversaciones(rutas);
  assert.deepStrictEqual(bases, ['analisis_de_compra_de_auto/']);

  const archivos = rutas.map((ruta) => ({ ruta }));
  const plan = Core.planificarAdjuntos(bases[0], archivos);
  const nombres = plan.adjuntos.map((a) => a.nombre);
  assert.deepStrictEqual(nombres, ['conversacion.md', 'msg001_usuario_pdf_1.pdf', 'msg001_usuario_solo_texto.txt.extraido.txt', 'msg002_claude_foto.png'],
    'orden: transcripción, documentos, imágenes; sin json/informe/debug ni texto redundante');
  assert.strictEqual(plan.omitidos.length, 1);
  assert.ok(/redundante/.test(plan.omitidos[0].motivo));

  // Límites: 20 archivos por mensaje y 30 MB por archivo; la transcripción siempre entra primero
  const muchos = [{ ruta: 'b/conversacion.md' }];
  for (let i = 0; i < 30; i++) muchos.push({ ruta: `b/imagenes/img${i}.png` });
  muchos.push({ ruta: 'b/archivos/enorme.pdf', tamano: 40 * 1024 * 1024 });
  const p2 = Core.planificarAdjuntos('b/', muchos);
  assert.strictEqual(p2.adjuntos.length, 20);
  assert.strictEqual(p2.adjuntos[0].nombre, 'conversacion.md');
  assert.ok(p2.omitidos.some((o) => /enorme/.test(o.ruta) && /MB/.test(o.motivo)));
  assert.strictEqual(p2.omitidos.filter((o) => /límite/.test(o.motivo)).length, 11);

  // Sin transcripción: se avisa
  const p3 = Core.planificarAdjuntos('c/', [{ ruta: 'c/conversacion.json' }]);
  assert.ok(p3.omitidos.some((o) => /no existe conversacion\.md/.test(o.motivo)));

  // Prompt
  const conv = JSON.parse(await cargado.file(bases[0] + 'conversacion.json').async('string'));
  const prompt = Core.construirPrompt(null, conv);
  assert.ok(prompt.includes('«Análisis de compra de auto»') && prompt.includes('con Claude') && prompt.includes('2 mensajes, creada el 2025-10-03'));
  assert.ok(!/\{[a-z]+\}/.test(prompt), 'sin variables sin sustituir');
  assert.strictEqual(Core.origenDe({ mensajes: [{ rol: 'ChatGPT' }] }), 'ChatGPT');
  assert.ok(Core.construirPrompt('Hola {titulo}', { titulo: 'X', mensajes: [] }) === 'Hola X');

  assert.strictEqual(Core.mimeDe('a.PDF'), 'application/pdf');
  assert.strictEqual(Core.mimeDe('sin_ext'), 'application/octet-stream');

  // Proyectos y skills exportados
  const rp = [
    'proyectos_claude_2026/Mi proyecto/proyecto.json', 'proyectos_claude_2026/Mi proyecto/instrucciones.md',
    'proyectos_claude_2026/Mi proyecto/conocimiento/notas.md', 'proyectos_claude_2026/Mi proyecto/conocimiento/archivos/manual.pdf',
    'proyectos_claude_2026/Mi proyecto/debug/crudo.json',
    'proyectos_claude_2026/Mi proyecto/conversaciones/01_chat/conversacion.json', 'proyectos_claude_2026/Mi proyecto/conversaciones/01_chat/conversacion.md',
  ];
  const cl = Core.clasificarZip(rp);
  assert.deepStrictEqual(cl.proyBases, ['proyectos_claude_2026/Mi proyecto/']);
  assert.strictEqual(cl.convBases.length, 1);
  assert.strictEqual(Core.proyectoDe(cl.convBases[0], cl.proyBases), 'proyectos_claude_2026/Mi proyecto/');
  assert.strictEqual(Core.proyectoDe('otra/', cl.proyBases), null);
  const pp = Core.planificarProyecto(cl.proyBases[0], rp);
  assert.deepStrictEqual(pp.docs.map((d) => d.nombre), ['notas.md']);
  assert.deepStrictEqual(pp.archivos.map((d) => d.nombre), ['manual.pdf']);
  assert.ok(Core.esTextoPlano('a.md') && Core.esTextoPlano('x.CSV') && !Core.esTextoPlano('a.pdf') && !Core.esTextoPlano('a.png'));

  const rs = ['skills_claude_2026/Redactor/skill.json', 'skills_claude_2026/Redactor/Redactor.zip', 'skills_claude_2026/Redactor/SKILL.md', 'skills_claude_2026/Redactor/debug/crudo.json', 'skills_claude_2026/INDICE.md'];
  const cs = Core.clasificarZip(rs);
  assert.deepStrictEqual(cs.skillBases, ['skills_claude_2026/Redactor/']);
  const ps = Core.planificarSkill(cs.skillBases[0], rs);
  assert.strictEqual(ps.zipRuta, 'skills_claude_2026/Redactor/Redactor.zip');
  assert.deepStrictEqual(ps.archivos.map((a) => a.relativa), ['SKILL.md']);
  assert.strictEqual(Core.planificarSkill('s/', ['s/skill.json', 's/SKILL.md']).zipRuta, null);
  assert.strictEqual(Core.clasificarZip(['mi-skill/SKILL.md', 'mi-skill/ref.txt']).skillSuelto, 'mi-skill/');
  assert.strictEqual(Core.clasificarZip(['SKILL.md']).skillSuelto, '');
  assert.strictEqual(Core.clasificarZip(['a.txt']).skillSuelto, null);

  console.log('core.test.js: OK');
})().catch((e) => { console.error(e); process.exit(1); });
