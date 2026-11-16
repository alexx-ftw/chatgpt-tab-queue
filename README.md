# ChatGPT Queue · Tab

Queue messages with **Tab**, using ChatGPT's own composer and attachment controls.
Independent queues, a minimal in-page list only when needed, draft protection and
signed **browser-native automatic updates**. No subscription, API key, telemetry,
local updater, native host, background operating-system service or remote code.

## Install the auto-updating release (Linux)

Download **chatgpt-queue.crx** from
[the latest release](https://github.com/alexx-ftw/chatgpt-tab-queue/releases/latest).
Open `brave://extensions` or `chrome://extensions`, enable developer mode, and drag
the **CRX file itself** onto that page. Accept the browser's installation prompt.
Do **not** unzip it or select Load unpacked: that developer installation does not
receive native package updates. A normal browser confirmation may be required.

The signed extension ID is `bkodbagbbldhccflpidamkccjgacbpid`.
Future versions are signed with the same key and delivered by the browser using
`updates.xml` from GitHub Releases. No scheduled local download or file-copy code
is installed. The browser chooses when to check; checks are not instantaneous.

This distribution path targets Chromium/Brave on Linux. Standard Chrome on
Windows/macOS restricts off-store installation; a Chrome Web Store release is the
normal cross-platform alternative. This project does not modify browser policies.

## Moving from an older unpacked copy (once)

The signed release has a different cryptographic extension ID from a path-derived
unpacked installation, so their browser storage is separate. Keep the old copy
until any pending data is transferred. `ui/transfer.html` can export/import queued
text, captured attachment bytes and draft backups to a local `.cqbackup` file.

In the old copy, export first. Disable it, install the signed release, and open
**All queues → Export/import queue** to import. Imports are paused for review and
never overwrite an existing queue. Reload ChatGPT once during this initial move
so the old extension's listeners are no longer running. Later signed-to-signed
updates reattach their own scripts without navigating the chat.

The browser-only transfer screen is compatible with v0.5.1. Its three files are
`ui/transfer.html`, `ui/transfer.js` and `core/backup.mjs`, alongside the existing
v0.5.1 database/client modules. It is a data-transfer tool, not an updater.
Transfer files contain private data: never upload them to this repository.
The transfer screen currently caps total attachment data at 256 MiB.

## v0.6.9: edición con pausa temporal

**Estado de distribución:** publicada como versión estable con paquete CRX firmado y auto-update nativo.
[Versión 0.6.9](https://github.com/alexx-ftw/chatgpt-tab-queue/releases/tag/v0.6.9).

Editar un pendiente ya no crea una pausa manual permanente. La conversación se
reserva mientras se edita; al guardar o cancelar, vuelve a su estado anterior.

- Una cola activa continúa automáticamente, sin pulsar Play. Si ChatGPT sigue
  respondiendo, espera normalmente antes del siguiente envío.
- Conserva las pausas manuales previas, globales y añadidas durante la edición.
  Guardar un error o un borrador retenido no lo reintenta.
- Varias ediciones abiertas mantienen ese chat detenido hasta cerrar la última.
  Las otras conversaciones pueden continuar independientemente.
- Guardado atómico y reservas por edición: los cambios simultáneos no se pisan.
  Si falla el guardado, conserva el texto editado y no libera la cola.
- Guardar sin cambiar el texto conserva el documento nativo. Se mantienen los
  adjuntos, el orden y los atajos Ctrl/Cmd+Enter y Escape.
- La interfaz muestra «Editando» y vuelve al estado normal al terminar. Cerrar
  normalmente la vista cancela sus reservas; un reinicio completo durante una
  edición interrumpida mantiene ese chat pausado para revisión.
- Una confirmación tardía no puede saltarse una edición abierta.
- Las vistas de extensión tienen propietarios por documento; si se cierran sin
  entregar el evento de salida, se liberan sus reservas sin borrar mensajes.
  La limpieza de navegación se serializa con el inicio de la edición.
- Una respuesta perdida después de guardar se recupera con el mismo token sin
  guardar dos veces; la confirmación se conserva hasta que la vista la reconoce.
- Durante la edición se puede elegir mantener la pausa o reanudar al terminar.
  El estado «Editando» también aparece al editar un pendiente retenido o con error.
- El auto-update espera a que terminen las reservas persistentes de edición.
  Una actualización forzada deja la edición interrumpida para revisión, sin
  conservar un bloqueo de editor inexistente.

**Pausas antiguas:** hasta 0.6.8, editar se registraba como «Pausa manual», sin
indicar su origen. No se borran esas pausas al actualizar: puede ser necesario
pulsar Play una vez para quitar la ya existente. Las nuevas ediciones recuperan
su estado automáticamente al guardar o cancelar.

Se conservan la identidad pública, los permisos, la base de datos y el canal nativo
de auto-update. El paquete firmado está publicado. No se abren
pestañas, no se cambia el chat visible ni se vacía o reenvía la cola al actualizar.

Verificación local: 328 pruebas Node y 136 comprobaciones de navegador (99 en
Chromium y 37 en Camoufox). Incluye 38 regresiones de edición y 29 casos de interfaz
repetidos en ambos motores, pausas manuales, concurrencia, fallos de guardado y
un envío único después de guardar. Perfiles aislados, solicitudes interceptadas,
almacenamiento en memoria y comunicación de extensión simulada; no es una
validación dentro de una cuenta real de ChatGPT ni del ciclo real de auto-update.

## v0.6.8: selecciones numeradas y respuestas en lista

Corrige el rechazo de tarjetas nativas con etiquetas «Selection 1», «Selection 2»
y sus equivalentes en español. El detector anterior solo aceptaba «Selection»
sin sufijo. Cada etiqueta numerada se comprueba contra el botón de retirada de
su propia tarjeta; no se confunden selecciones, archivos ni referencias opacas.

- Conserva las selecciones en orden, incluso si las etiquetas se renumeran o
  la última vuelve al formato antiguo durante la retirada nativa.
- Conserva los números y viñetas de la respuesta, incluidos inicio, valores
  individuales, orden inverso y listas anidadas. El documento nativo se conserva
  cuando está disponible; las selecciones siguen transportándose como citas.
- Verifica también las listas del mensaje enviado, sin confundir una numeración
  distinta ni dejar de confirmar por los estilos de texto del editor.
- Si cambia la numeración durante el guardado, el borrador modificado se conserva.
  Una lista vacía no se convierte en un mensaje compuesto solo por un marcador.

No cambian coordinador, base de datos, pausas, permisos, identidad firmada ni
canal de actualizaciones. No se abren pestañas ni se reenvían mensajes inciertos.
No se recrean los chips o anclajes internos de selección ni se habilita transporte
universal de referencias opacas.

Verificación local: 288 pruebas Node y 79 comprobaciones de navegador
(71 en Chromium y 8 en Camoufox). Incluye 24 regresiones unitarias nuevas,
7 nuevos casos de selección y una reproducción con el fragmento del compositor
aportado por el usuario, mantenido fuera del repositorio. Se comprobaron Tab,
retirada nativa, bytes de archivos, envío único, confirmación y borrador siguiente.
Son perfiles aislados con solicitudes interceptadas y mensajería simulada;
no es una prueba dentro de una cuenta real de ChatGPT.

## v0.6.7: confirmar los mensajes ya enviados sin repetirlos

Corrige fallos reproducidos en la lectura de la confirmación: solo se leía el
primer bloque de texto y solo se comparaba el último mensaje del chat. Una cita
formateada o un mensaje manual posterior podían dejar el envío como incierto.

- Lee la burbuja completa sin duplicar bloques anidados ni incluir controles.
- Admite texto íntegro y reconstrucción conservadora de Markdown; nunca confirma
  por una coincidencia parcial ni por el mero hecho de existir una respuesta.
- Comprueba el sucesor inmediato del mensaje anterior guardado al enviar, aunque
  después haya otros mensajes. Si ese anclaje conocido falta o es ambiguo, conserva
  el pendiente para revisión. Los chats nuevos no necesitan un anclaje anterior.
- Una confirmación válida retira el pendiente sin pulsar Enviar de nuevo y levanta
  solo su pausa automática por timeout, si no hay otros pendientes para revisión.
  Las pausas manuales, globales e importadas permanecen intactas.
- El diagnóstico indica coincidencias y presencia del anclaje sin revelar textos,
  nombres de archivos ni identificadores de los mensajes del historial.

No cambian identidad firmada, permisos, base de datos, auto-update, captura de
adjuntos o selecciones ni controles nativos. No abre ni navega pestañas para
confirmar. Los límites anteriores del envío en segundo plano no cambian.

Verificado con 264 pruebas Node y 8 pruebas en Camoufox, usando el adaptador DOM,
modelo y coordinador de producción. Perfil aislado, almacenamiento en memoria y
mensajería simulada; todas las solicitudes interceptadas. Se comprobó que el panel
desaparece al confirmar, el borrador se conserva y hay cero clics en Enviar, también
con mensajes posteriores y en vistas de 1080 y 390 px. No es validación dentro de
una cuenta real de ChatGPT ni del ciclo real de actualización del navegador.

## v0.6.6: selecciones de texto, no archivos inexistentes

Corrige la clasificación de la tarjeta nativa «Selection / Remove selected text»
como si fuera un archivo local. Tab conserva el texto que esa tarjeta expone en
el DOM como una cita identificada dentro del mensaje, seguida de la petición.
No inventa un File ni pide volver a adjuntar una selección.

- Varias selecciones conservan orden, espacios y saltos de línea; el recorte visual
  CSS no recorta el texto disponible en el DOM.
- Las selecciones pueden acompañar archivos locales; estos conservan sus bytes y
  siguen pasando por la comprobación de originales.
- La retirada usa los botones nativos, solo después de guardar el mensaje y
  comprobar que la selección, los archivos y el borrador no han cambiado.
- Si cambia el contenido durante el guardado, el pendiente queda para revisión;
  no se sobrescribe el nuevo borrador ni se libera un envío parcial.
- Corregida la lectura de párrafos vacíos en el editor alternativo: una cita
  multilínea no añade saltos de línea al verificarse.

**Alcance:** el transporte de selecciones es una cita de texto. No recrea el chip
nativo ni sus anclajes o metadatos internos. Solo utiliza texto expuesto por la
tarjeta, no contenido que la aplicación no proporcione. Referencias opacas,
selecciones ilegibles y contexto adicional desconocido siguen bloqueándose.
Enter conserva el envío nativo. No cambian permisos, identidad, almacenamiento,
canal de actualizaciones ni la corrección del arranque automático de 0.6.5.

Verificación: 238 pruebas Node y 63 comprobaciones de navegador, incluidas 26
regresiones unitarias nuevas y 13 pruebas de selección. El navegador usa DOM real
en un perfil de prueba, solicitudes interceptadas y comunicación de extensión
simulada. No se ha probado esta revisión en una cuenta real de ChatGPT.

## v0.6.5: inicio automático, sin pausa heredada al reiniciar

Corrige una pausa global que las versiones anteriores guardaban cada vez que
se reiniciaba el navegador con pendientes o con una respuesta todavía en curso.
Esa pausa podía quedarse activa incluso al crear una cola nueva.

- Los pendientes normales conservan su ejecución automática tras reiniciar.
- La actualización elimina la pausa automática heredada que se identifique
  exactamente como recuperación tras reinicio; no borra mensajes ni archivos.
- Las pausas manuales (incluida la de editar) y las importaciones siguen pausadas.
  Una pausa de origen desconocido no se elimina.
- Preparaciones interrumpidas, borradores sin confirmar y posibles envíos quedan
  para revisión solo en su conversación. No se reintentan ni bloquean otros chats.
- Se conservan las esperas de respuesta: nunca se envía sobre una generación activa.
- Sin pestañas nuevas, navegación automática, permisos nuevos ni cambios de identidad.

Verificado con 212 pruebas Node (25 regresiones nuevas), incluida la ejecución del
coordinador después del reinicio sin pulsar Play: espera al terminar la respuesta,
envía una sola vez y conserva el borrador. Pruebas de almacenamiento y navegador
simuladas; no se ha reproducido el ciclo completo en una sesión real de ChatGPT.
Los límites existentes del transporte en segundo plano no cambian.

## v0.6.4: decorated web links are not attachments

Fixes a false rejection of literal HTTP(S) links decorated with noneditable
favicons or rendered as inline URL nodes. Capturing and final Send verification
now distinguish a self-contained URL from opaque file/connector references.
The visible URL remains exact, including query parameters and fragments; the
native editor document is retained when available. Link node views are read
again after editor transactions, so atomic-link text cannot disappear during
verification. Mixed messages keep their original text, link order and files.

The guard still rejects unknown references, resource identifiers, conflicting
link labels/destinations, unrelated images and selected context above the editor.
Its warning no longer incorrectly refers to opening another browser tab.
No tabs, permissions, queue storage, signing identity or update channel changed.

Verification uses unit tests and an isolated Chromium fixture with mocked
extension messaging. The link tests exercise Tab, native Enter, one Send after
response completion, draft restoration and exact native PDF bytes. This is not
validation of the current live ChatGPT DOM; existing background-transport limits
remain. No personal profile or real chat was used for these tests.

## v0.6.3: UI más nativa y estable

- Panel compacto con estado claro y todos los mensajes desplegados.
- Acciones de copiar, editar y retirar al pasar el cursor o enfocar; visibles en pantallas táctiles/estrechas y en mensajes que requieren revisión.
- Edición con Ctrl+Enter / Cmd+Enter para guardar y Esc para cancelar. Editar pausa esa conversación; guardar no la reanuda automáticamente.
- Las filas no se reconstruyen en cada refresco: se conservan el foco, la selección y el texto en edición mientras se actualizan otras filas.
- Buscador por conversación, mensaje o archivo y filtros por botones: Todas / En pausa / Revisar. Los filtros no alteran la cola.
- Adjuntos en etiquetas con icono, nombre y tamaño. Sin adjuntador adicional.
- Ajustes, actualizaciones, diagnóstico e importación en una zona secundaria.
- Vaciado global con confirmación, sin detener respuestas ni borrar el historial.
- Una edición eliminada desde otra vista se conserva para copiarla; nunca se vuelve a encolar por sí sola.

Actualización de interfaz únicamente. Mismos permisos, firma, canal de actualización, motor de envío y almacenamiento. Se distribuye como actualización firmada normal: no hace falta reinstalar ni importar la cola.

**Validación:** 162 pruebas Node y 40 comprobaciones Chromium aisladas (23 UI/UX, 5 de seguridad de edición y controles accesibles, 12 regresiones del panel). Temas claro y oscuro, escritorio, anchuras de 390/320 px, entrada táctil y movimiento reducido. Las páginas de prueba usan RPC simulado, no una sesión real de ChatGPT. Las limitaciones existentes del envío en segundo plano permanecen.

Pruebas de interfaz (Playwright y Chromium ya instalados):

```sh
CQ_PLAYWRIGHT=/ruta/a/playwright/index.mjs node tests/ui-ux.browser.mjs
CQ_PLAYWRIGHT=/ruta/a/playwright/index.mjs node tests/view-safety.browser.mjs
CQ_PLAYWRIGHT=/ruta/a/playwright/index.mjs node tests/panel-lifecycle.browser.mjs
```

## v0.6.2: queue panel recovery

Fixes a reproducible mismatch where the sender recognized the active composer but the
panel rejected the page because another, hidden composer was present. The panel now
uses the same read-only composer selection as the sender. It remounts after page DOM
replacement, reconciles missed state notifications on visibility/navigation and the
existing heartbeat, and ignores late responses from a disposed script version.

Diagnostics now distinguish active/hidden composers and panel presence from sender
readiness. They do not include message text or attachments. No changes to queue
storage, the sending coordinator, signing identity or permissions.

Verified with 161 Node tests and 12 isolated Chromium UI regressions, including a
separate ISOLATED execution world, native draft preservation, and desktop/mobile
screenshots. Tests use an intercepted fixture and mocked extension RPC, not a live
ChatGPT account. Existing limitations of background transport still apply.

## v0.6.0

* Native signed-package update URL and reproducible CRX3 packaging.
* Apply downloaded updates at safe boundaries, not during an active send/capture.
* Reattach existing pages, clean up old listeners, preserve draft text and prevent
  duplicate Tab handlers after subsequent updates.
* Immediate page injection and expiring commands: a timed-out browser request
  must not send a message unexpectedly when it finally gets scheduled.
* Clear stale reconnection notices after recovery; compact status in the composer,
  stable queue scroll position and neutral styling in the global manager.
* Keep the original safety behavior for unconfirmed sends; never retry blindly.

## Remaining limits

The site DOM is not a public API. Background conversations still rely on an
internal same-origin iframe when they are not open elsewhere. ChatGPT or the
browser can refuse or suspend that frame. This release does **not** claim that
all background sending failures or every native ChatGPT mode are solved.
It never opens/navigates a browser tab as a fallback for automatic queue sending.
Frozen pages cannot execute while frozen; closed browsers cannot send.

Local files are captured from native selection, paste and drag-and-drop. Native
Library/connector references, selected text context and newly introduced modes
are not universally transportable. Unsupported context is not silently omitted.
The normal Enter path remains available; file submission may briefly reserve the
composer to avoid mixing queued files with a manually written message.

## Development / release

Node 22+, Python 3 and OpenSSL are used for tests and release packaging only.

```sh
npm install --ignore-scripts
npm test
npm run check
python3 scripts/package_release.py --source . --key /secure/path/release.pem --out dist
python3 scripts/package_release.py --verify dist/chatgpt-queue.crx
```

Publish a **draft** GitHub release matching `v<manifest.version>`, attach the CRX,
ZIP, `updates.xml`, `release.json` and `SHA256SUMS`, then publish it as latest only
after all assets are present. Never regenerate the signing key for a new version.
The private key stays outside the repository and release assets. A signing tool
is run by the maintainer at release time; it is not part of the installed extension.

Tests separate queue logic/API simulations, real Chromium DOM fixtures (mocked
location and RPC), CRX3 signature verification and live-site behavior. This build
has not been validated as a complete installed extension against a live ChatGPT
account. See `docs/VERIFICATION.md` for the evidence and restrictions.

[Chrome: self-hosted updates](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux)
· [Update lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/extensions-update-lifecycle)

Unofficial project, not affiliated with OpenAI. MIT license.
