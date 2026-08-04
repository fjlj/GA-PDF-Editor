# Offline setup (slim package)

GA PDF Editor can ship **without** large vendor libraries and web fonts.
Recipients run setup once (network required), then the app works offline — including `file://`.

## Quick start

**Easiest:** double-click **`Setup.bat`** at the package root (next to the EXE).

```powershell
# Same thing from PowerShell (package root):
powershell -ExecutionPolicy Bypass -File .\tools\setup.ps1
```

Setup starts `GA-PDF-Editor-SVC.exe` when present so **`Open GA PDF Editor.url`** is
written next to the EXE. Open that shortcut (or `app\index.html`).

## What setup downloads

| Target | Source |
|--------|--------|
| `lib/pdfjs/` | npm `pdfjs-dist@3.11.174` (renamed to `pdf.local.js` / `pdf.worker.local.js` + cmaps + standard_fonts) |
| `lib/pdf-lib/` | jsDelivr `pdf-lib@1.17.1` |
| `lib/html2canvas/` | jsDelivr `html2canvas@1.4.1` |
| `lib/tesseract/` | jsDelivr tesseract.js 5.x + eng.traineddata + **file:// embeds** |
| `assets/fonts/` + `assets/css/fonts.css` | Google Fonts CSS API (woff2) |
| `lib/qpdf/` | npm `@neslinesli93/qpdf-wasm@0.3.0` + 4-line `window.QpdfModule` patch |

Pinned URLs live in `vendors.manifest.json`. Each asset lists **multiple mirrors**
(unpkg / npm / cdnjs first; jsDelivr last) so a single blocked CDN does not kill setup.

## Password protect (qpdf)

This is **not** something we invent. It is the public package
[`@neslinesli93/qpdf-wasm`](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm)
(qpdf CLI compiled with Emscripten). The app already used that build; the only
local tweak is exposing `window.QpdfModule` for classic `<script>` tags
(comment in-tree still said “CCS PDF Editor”).

`setup.ps1` downloads it automatically and regenerates `qpdf.wasm.embed.js`
for `file://` offline use. Optional override:

```powershell
.\tools\setup.ps1 -QpdfSource C:\path\to\folder\with\qpdf.js+qpdf.wasm
```

## Local server shell (`GA-PDF-Editor-SVC.exe`)

The slim/full zip includes **`GA-PDF-Editor-SVC.exe` next to `app\`**. It is a tiny
localhost HTTP server (default `http://127.0.0.1:17880`) that serves `./app`.

**No administrator rights** are required: it binds a high port on `127.0.0.1` only.
User Startup folder / `HKCU\...\Run` are also non-elevated — do **not** force setup to run as admin.

**`setup.ps1` starts the SVC** at the end (if the EXE is present) so the `.url`
shortcut exists when setup finishes. First-run setup only **assumes** the default
port is free; the authoritative URL is always whatever the SVC wrote into the `.url`.

Port override (manual / advanced):

```text
GA-PDF-Editor-SVC.exe --port 27991
set GAPDF_SVC_PORT=27991
```

The service **does not open a browser** (so logon startup stays quiet). On bind it
writes **`Open GA PDF Editor.url`** next to the EXE with the live port — open that
once, then use the browser’s **Install app** / PWA install.

**Sticky port / PWA:** the next start reuses the port from that `.url` file (unless
you pass `--port` / `GAPDF_SVC_PORT`). It will **not** silently pick another port
(that would break an installed PWA origin). If the preferred port is busy, you get
a **MessageBox** explaining the conflict and how to free the port or intentionally
move (and re-install the PWA).

Second launch uses a **mutex** (single instance) and exits quietly.

Setup can also register it to start at **user logon** (no admin):

- Default: shortcut in the user’s **Startup** folder (WorkingDirectory = package root)
- Or: `HKCU\...\Run` via `-StartupMethod Registry`

```powershell
.\tools\setup.ps1                          # prompts: start on boot? [y/N]
.\tools\setup.ps1 -EnableStartup           # no prompt, enable
.\tools\setup.ps1 -DisableStartup -SkipLibs -SkipFonts   # remove registration
```

## Flags

```powershell
.\tools\setup.ps1 -AppRoot D:\ship\app
.\tools\setup.ps1 -SkipFonts
.\tools\setup.ps1 -SkipLibs
.\tools\setup.ps1 -QpdfSource ...\lib\qpdf
.\tools\setup.ps1 -EnableStartup
.\tools\setup.ps1 -DisableStartup -SkipLibs -SkipFonts
.\tools\setup.ps1 -EnableStartup -StartupMethod Registry
```

## Packaging (maintainers)

From a **full** developer tree (scripts live under `tools\package\` in the repo):

```powershell
cd tools\package
.\package.ps1                  # slim zip (ships tools\setup.ps1 etc. at zip root)
.\package.ps1 -IncludeFullLibs # full offline zip with libs already filled
```

`-IncludeQpdf` is optional legacy; setup fetches qpdf from npm by default.

**Shipped zip layout** (user-facing):

```text
GA-PDF-Editor-SVC.exe
Setup.bat            double-click me (slim package)
app\
tools\
  setup.ps1
  SETUP.md
  vendors.manifest.json
dev\                 design notes / changelogs
README.md
VERSION
SETUP-FIRST.txt
```

## Regenerating embeds only

If you already have binary vendors and only need file:// base64 wrappers, re-run setup
(it regenerates `*.embed.js` from the downloaded binaries every time).

## Requirements

- Windows PowerShell 5.1+ (or PowerShell 7)
- Network access once
- `tar` (built into modern Windows) for extracting npm tarballs
