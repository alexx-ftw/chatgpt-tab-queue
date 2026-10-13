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
