# Importar Chats a Claude

Extensión de Chrome (Manifest V3, Chrome ≥ 116) que carga en tu cuenta de Claude las conversaciones exportadas con
**Exportar Chats Claude** o **Exportar Chats ChatGPT** (proyectos hermanos de esta carpeta).

Claude no tiene una función oficial de importación, así que cada conversación se carga como **un chat nuevo con la
transcripción adjunta**: es lo mismo que hacer a mano «adjuntar conversacion.md y pedirle que la lea».

## Uso
1. `chrome://extensions` → Modo desarrollador → *Cargar descomprimida* → esta carpeta. Abre sesión en claude.ai.
2. Pulsa el icono (panel lateral) → **Elegir ZIP exportados…** (acepta varios; cada ZIP puede traer una conversación).
3. En la conversación que quieras, pulsa **Preparar en Claude**. La extensión:
   - abre `claude.ai/new` en una pestaña nueva;
   - adjunta `conversacion.md`, los documentos y las imágenes;
   - escribe el mensaje inicial (editable en el panel).
4. Revisa la pestaña de Claude y **pulsa Enviar tú**. La extensión nunca envía nada por su cuenta.

No cambies de pestaña mientras se prepara: el cuadro de mensaje necesita estar en primer plano.

## Qué se adjunta
Por prioridad: `conversacion.md` → documentos (`archivos/`) → imágenes (`imagenes/`). No se adjuntan
`conversacion.json`, `informe.txt` ni `debug/`. Si existe el original de un documento, se omite su
`.extraido.txt`. Límites (ajustables en `core.js`): 20 archivos por mensaje y 30 MB por archivo; lo que no
cabe se lista en el panel con su motivo.

Los nombres de los adjuntos llevan el prefijo `msgNNN_autor_…`, por lo que coinciden con las rutas que cita la
transcripción.

## Estructura
| Archivo | Rol |
|---|---|
| `manifest.json`, `background.js` | MV3; el icono abre el panel lateral |
| `sidepanel.*` | Lee los ZIP, muestra las conversaciones y orquesta cada importación |
| `page-lib.js` | Se inyecta en claude.ai: recibe archivos por trozos, los adjunta y escribe el mensaje. **Selectores en `CFG`** |
| `core.js` | Lógica pura: plan de adjuntos, límites, mensaje inicial |
| `tests/core.test.js` | `node tests/core.test.js` |

## Limitaciones
- Depende de la interfaz de claude.ai (campo de archivos y editor de mensajes). Si cambia, ajusta `CFG` en
  `page-lib.js`. El panel avisa si no pudo confirmar los adjuntos; en ese caso arrástralos tú desde el ZIP.
- Claude *lee* la conversación; no queda como historial nativo con los mensajes originales por separado.
- Transcripciones muy largas pueden acercarse al límite de contexto del chat.
- Úsala solo con tus propias conversaciones y respetando los términos de servicio de Anthropic.
