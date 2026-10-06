# Importar Chats a Claude

Extensión de Chrome (Manifest V3, Chrome ≥ 116) que **carga en tu cuenta de Claude las conversaciones que exportaste**
con *Exportar Chats Claude* o *Exportar Chats ChatGPT*, y las deja donde tú elijas: un chat suelto, un proyecto
existente o un proyecto nuevo.

Claude no tiene una función oficial de importación. Por eso cada conversación se carga como **un chat nuevo con la
transcripción adjunta**, y Claude la toma como el historial de ese chat: es lo mismo que adjuntar a mano
`conversacion.md` y pedirle que continúe desde ahí, pero automatizado, con los archivos e imágenes incluidos.

## La familia de extensiones
Tres extensiones independientes que se complementan para **mover tus conversaciones entre ChatGPT y Claude**:

| Extensión | Qué hace |
|---|---|
| [Exportar Chats ChatGPT](https://github.com/alcalos9/extension_chrome_chatgpt) | Descarga una conversación (o proyectos y skills) de chatgpt.com como ZIP |
| [Exportar Chats Claude](https://github.com/alcalos9/extension_chrome_claude) | Descarga una conversación (o proyectos y skills) de claude.ai como ZIP |
| [Importar Chats a Claude](https://github.com/alcalos9/extension_chrome_importar_claude) | Carga esos ZIP en tu cuenta de Claude: chat suelto, proyecto existente o proyecto nuevo |

Flujo típico: **exportas** con una de las dos primeras → obtienes un ZIP → lo **importas** a Claude con la tercera.

## Qué hace, paso a paso
1. Lees uno o varios ZIP generados por las extensiones exportadoras.
2. Eliges el **destino** de las conversaciones.
3. Pulsas **Preparar** en cada conversación. La extensión abre una pestaña de Claude, adjunta la transcripción,
   los documentos y las imágenes, y escribe el mensaje inicial.
4. Revisas la pestaña de Claude y **pulsas Enviar tú**. La extensión nunca envía nada por su cuenta.
5. Al enviar, el chat se renombra con el **título original** de la conversación (Claude pone uno automático y la
   extensión lo corrige).

## Instalación
La extensión no está en la Chrome Web Store: se instala a mano en modo desarrollador (1 minuto, gratis).

1. **Descarga el código.** En la página del repositorio pulsa **Code → Download ZIP** y descomprímelo
   (o usa `git clone https://github.com/alcalos9/extension_chrome_importar_claude.git`). Guarda la carpeta en un lugar estable: Chrome la lee desde ahí,
   así que si la borras o la mueves la extensión deja de funcionar.
2. Abre `chrome://extensions` en Chrome (o Edge/Brave u otro navegador basado en Chromium, versión ≥ 116).
3. Activa **Modo de desarrollador** (interruptor arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta del proyecto (la que contiene `manifest.json`).
5. Fija la extensión desde el icono de puzle de la barra para tenerla a mano.
6. Abre sesión en claude.ai en esa misma ventana de Chrome: la extensión usa tu sesión, no pide contraseñas.

**Actualizar:** descarga de nuevo el repositorio, reemplaza la carpeta y pulsa el botón ⟳ de la extensión en
`chrome://extensions`. **Desinstalar:** botón *Quitar* en la misma página.

> Chrome puede mostrar al abrir el navegador el aviso «Desactiva las extensiones en modo desarrollador».
> Es normal en extensiones instaladas así; puedes cerrarlo.

## Uso
1. Instala la extensión (ver **Instalación** arriba) y abre sesión en claude.ai.
2. Pulsa el icono de la extensión: se abre el panel lateral.
3. Pulsa **Elegir ZIP exportados…** (acepta varios a la vez; cada ZIP es una conversación exportada).
   Debe ser el **.zip** tal como lo descargaste, no la carpeta descomprimida.
4. Elige **¿Dónde quieres dejar la conversación?**
   - **Chat suelto:** un chat nuevo, fuera de cualquier proyecto.
   - **En un proyecto existente:** la lista de tus proyectos se carga sola; elige uno. El botón *Actualizar lista*
     vuelve a consultarla.
   - **En un proyecto nuevo:** escribe el nombre y pulsa **Crear proyecto**. Queda seleccionado como destino y
     todas las conversaciones que prepares después se agregan a él.
5. La lista muestra cada conversación con su estado (*Sin preparar*, *Preparando…*, *✓ Preparada*, *✗ Con error*),
   el lugar donde quedó y los avisos, si los hay. Pulsa **Preparar** en la que quieras.
6. Cuando el estado sea *✓ Preparada*, ve a la pestaña de Claude, revisa los adjuntos y el mensaje, y pulsa **Enviar**.

**No cambies de pestaña mientras se prepara:** el cuadro de mensaje de Claude necesita estar en primer plano para
adjuntar los archivos. Si vuelves a pulsar *Preparar de nuevo* en una conversación ya preparada, el panel te pide
confirmación, porque si ya la enviaste se crearía un chat duplicado.

### El mensaje inicial
Es editable en el panel («Mensaje inicial»). Pide a Claude que lea la transcripción, la trate como el historial real
del chat y responda solo «Listo, retomamos desde ahí». Variables disponibles: `{origen}` `{titulo}` `{mensajes}`
`{fecha}`. Tu versión se guarda en el navegador; *Restaurar mensaje por defecto* vuelve al texto original.

## Qué se adjunta
Por prioridad: `conversacion.md` → documentos (`archivos/`) → imágenes (`imagenes/`). No se adjuntan
`conversacion.json`, `informe.txt` ni `debug/`. Si existe el original de un documento, se omite su
`.extraido.txt`. Límites de Claude (ajustables en `core.js`): **20 archivos por mensaje y 30 MB por archivo**; lo que
no cabe se lista en el panel con su motivo. Los nombres llevan el prefijo `msgNNN_autor_…`, por lo que coinciden con
las rutas que cita la transcripción.

## Cómo funciona por dentro
- El panel lateral lee los ZIP con JSZip y decide qué adjuntar (`core.js`, lógica pura con pruebas).
- Para cada conversación abre `claude.ai/new` o `claude.ai/project/<id>` en una pestaña, le inyecta `page-lib.js` y le
  pasa los archivos por trozos (evita argumentos gigantes).
- `page-lib.js` adjunta los archivos al cuadro de mensaje (campo de archivos → pegado → arrastre, con verificación),
  escribe el mensaje **sin enviarlo** y deja una vigilancia que renombra el chat cuando se crea.
- Para listar y crear proyectos y renombrar chats usa la API interna de claude.ai con tu sesión.

## Estructura del código
| Archivo | Rol |
|---|---|
| `manifest.json`, `background.js` | MV3; el icono abre el panel lateral |
| `sidepanel.*` | Lee los ZIP, muestra destino y lista, y orquesta cada importación |
| `page-lib.js` | Se inyecta en claude.ai: recibe archivos, los adjunta, escribe el mensaje, proyectos y renombrado. **Selectores en `CFG`** |
| `core.js` | Lógica pura: plan de adjuntos, límites, mensaje inicial |
| `tests/core.test.js` | Pruebas: `node tests/core.test.js` |
| `vendor/jszip.min.js` | JSZip 3.10.1 |

## Privacidad y seguridad
- **Todo ocurre en tu navegador.** La extensión no tiene servidor propio, no envía tus conversaciones a ningún
  tercero y no incluye analítica ni telemetría.
- Usa **tu sesión ya abierta** en claude.ai; no pide ni guarda contraseñas ni tokens.
- Permisos que solicita (ver `manifest.json`): `scripting` y `sidePanel` (inyectar el código en la pestaña de Claude y mostrar el panel lateral) y acceso a `claude.ai`. No pide acceso a ningún otro sitio.
- Puedes revisar el código completo: son archivos JavaScript sin compilar ni ofuscar.

## Solución de problemas
- **El icono no abre nada / el panel no aparece:** recarga la extensión (⟳ en `chrome://extensions`) y la pestaña de claude.ai.
- **Dice que la sesión está cerrada o no encuentra datos:** abre claude.ai, inicia sesión y vuelve a intentarlo.
- **Algo dejó de funcionar de un día para otro:** claude.ai cambió su interfaz o su API interna. Revisa el *Registro* del panel y abre un *issue* en el repositorio con ese texto (sin datos personales).
- **Chrome pide un permiso extra:** es para descargar archivos adjuntos de otros dominios; se pide una sola vez.
- **Los adjuntos no se confirman:** arrástralos tú desde el ZIP descomprimido; el mensaje ya está escrito.
- **No aparecen mis proyectos:** pulsa *Actualizar lista*; si falla, el panel muestra el motivo y puedes usar «Chat suelto».
- **El título del chat no cambia:** la vigilancia vive mientras no recargues la pestaña de Claude antes de enviar.

## Limitaciones
- Claude *lee* la conversación; no queda como historial nativo con cada mensaje original por separado. Claude no
  permite crear mensajes antiguos del asistente.
- Depende de la interfaz y de la API interna de claude.ai (campo de archivos, editor, proyectos, renombrado). Si
  cambian, ajusta `CFG` en `page-lib.js`.
- Transcripciones muy largas pueden acercarse al límite de contexto del chat.
- Solo importa **a Claude**.

## Pruebas
```
node tests/core.test.js
```

## Aviso
Proyecto independiente, no afiliado ni respaldado por Anthropic ni por OpenAI. Claude y ChatGPT son marcas de sus
respectivos titulares. Depende de interfaces internas no documentadas que pueden cambiar sin aviso.
Úsalo solo con tus propias conversaciones y respetando los términos de servicio de cada plataforma.
