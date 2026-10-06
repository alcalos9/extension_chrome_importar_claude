# Importar Chats a Claude

Extensión de Chrome que **sube a tu cuenta de Claude** lo que exportaste con las otras dos extensiones:
**conversaciones**, **proyectos** y **skills**.

## Las tres extensiones

| Extensión | Para qué sirve |
|---|---|
| [Exportar Chats ChatGPT](https://github.com/alcalos9/extension_chrome_chatgpt) | Guarda tus chats, proyectos y skills de ChatGPT en un ZIP |
| [Exportar Chats Claude](https://github.com/alcalos9/extension_chrome_claude) | Guarda tus chats, proyectos y skills de Claude en un ZIP |
| **Importar Chats a Claude** (esta) | Sube esos ZIP a tu cuenta de Claude |

Orden típico: **exportas** con una de las dos primeras → obtienes un ZIP → lo **importas** a Claude con la tercera.

## Cómo instalarla (1 minuto, gratis)
1. En esta página de GitHub pulsa el botón verde **Code → Download ZIP** y descomprime el archivo.
   Guarda la carpeta en un lugar fijo (si la borras o la mueves, la extensión deja de funcionar).
2. En Chrome escribe `chrome://extensions` en la barra de direcciones.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta descomprimida.
5. Abre claude.ai e inicia sesión. Para usar la extensión, pulsa su icono 🧩: se abre un panel a la derecha.

Para actualizarla, descarga de nuevo el ZIP, reemplaza la carpeta y pulsa ⟳ en `chrome://extensions`.

## Cómo usarla
1. Pulsa el icono de la extensión y luego **Elegir ZIP exportados…** (puedes elegir varios a la vez).
   Elige el archivo **.zip** tal como lo descargaste, sin descomprimir.
2. Aparece una lista con lo que contiene cada ZIP. Pulsa el botón de cada elemento:

| Elemento | Botón | Qué hace |
|---|---|---|
| 💬 Conversación | **Preparar** | Abre un chat nuevo en Claude con la conversación adjunta y el mensaje escrito. **Tú pulsas Enviar.** |
| 📁 Proyecto | **Importar proyecto** | Crea el proyecto en Claude con sus instrucciones y sus archivos de conocimiento. |
| 🧩 Skill | **Subir skill** | Sube el skill a tu cuenta (también acepta un skill suelto en .zip). |

3. Junto a cada elemento verás su estado (*Sin importar*, *Procesando…*, *✓ Listo* o *✗ Con error*), dónde quedó y los avisos.

### Dónde quedan las conversaciones
Antes de preparar una conversación elige: **Chat suelto**, **En un proyecto existente** (eliges de tu lista) o
**En un proyecto nuevo** (escribes el nombre y pulsas *Crear proyecto*).
Las conversaciones que vienen dentro de un proyecto exportado se agregan automáticamente a ese proyecto.

### Tips
- **Mientras se prepara una conversación no cambies de pestaña.**
- La extensión **nunca envía nada sola**: revisa y pulsa Enviar tú. Al enviar, el chat toma el título original.
- Claude lee la conversación como contexto, pero no puede recrear los mensajes uno por uno como en el original.
- Límites de Claude: hasta 20 archivos y 30 MB por archivo en cada chat. Lo que no cabe se avisa en la lista.

## Tu privacidad
Todo ocurre en tu computador. La extensión no envía tus datos a nadie ni tiene servidor propio: solo usa tu sesión
abierta en claude.ai. No pide ni guarda contraseñas.

## Si algo falla
- **Archivos sin adjuntar:** arrástralos tú desde el ZIP; el mensaje ya está escrito.
- **El skill no se subió:** la extensión descarga su ZIP. Súbelo en Claude → Configuración → Capacidades → Skills.
- **Archivos de proyecto sin subir:** agrégalos a mano desde la carpeta `conocimiento` del ZIP.
- **No aparecen mis proyectos:** pulsa *Actualizar lista*. Si sigue igual, usa «Chat suelto».
- **Dejó de funcionar de un día para otro:** probablemente Claude cambió. Abre un *issue* en este repositorio.
- Abre **Registro** al final del panel: ahí queda el detalle para quien te ayude.

## Importante
Es un proyecto independiente, sin relación con Anthropic ni OpenAI. Funciona con partes internas de claude.ai que pueden
cambiar sin aviso; si algún día deja de funcionar, puede que haya que actualizarla. Úsala solo con tus propias
conversaciones y respetando los términos del servicio.
