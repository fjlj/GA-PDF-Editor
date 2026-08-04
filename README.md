# GA PDF Editor

| Field | Value |
|-------|--------|
| **Version** | **1.5.4** |
| **Owner** | Give Academy LLC / GA Information Technology |
| **Last updated** | 2026-08-03 |
| **Downloads / releases** | **[give.academy/GA-PDF-Editor](https://give.academy/GA-PDF-Editor/)** |

Internal **offline-first** PDF viewer and editor. Open PDFs or **`.gapdf`** projects, annotate, fill and design fillable AcroForm fields, run **local OCR**, and save either an editable project or a final PDF (annotations flattened; form fields remain fillable; optional password on export). Document bytes stay on the device — the app does **not** upload content to a server.

### Download releases (recommended)

**This repository is the source tree.** Packaged builds (slim/full zip, ready-to-run) are published on the product site — not as git tags or `dist/` artifacts in this repo:

**→ [https://give.academy/GA-PDF-Editor/](https://give.academy/GA-PDF-Editor/)**

This GitHub tree is **slim source only** (app JS/CSS/HTML, packager, docs, SVC C sources). It does **not** include vendored `app/lib/*`, web fonts, or prebuilt `GA-PDF-Editor-SVC.exe` — those come from the download site or a one-time setup (below).

**Stack:** Static HTML / CSS / vanilla JavaScript, PDF.js, pdf-lib, QPDF (WASM), html2canvas, Tesseract.js (fetched into `app/lib/` by setup). Optional localhost SVC shell for a clean origin (PWA-friendly).

See also: **[VERSION](VERSION)** for semver notes.

---

## Getting started (from this source repo)

End users who only want to run the app should use a **[site release](https://give.academy/GA-PDF-Editor/)**. The steps below are for people who cloned GitHub and need a working tree.

### Prerequisites

| Need | Why |
|------|-----|
| **Windows** + **PowerShell 5.1+** | `setup.ps1` / `package.ps1` / `render-docs.ps1` |
| **Network (once)** | Download PDF.js, pdf-lib, html2canvas, Tesseract, qpdf WASM, fonts |
| **C compiler (`gcc`)** | Build `GA-PDF-Editor-SVC.exe` from `tools/GA-PDF-Launcher/` (MinGW-w64 / TDM-GCC / MSYS2, or Embarcadero Dev-C++) |
| **Modern browser** | Chrome / Edge / Firefox |

No Node.js / npm required for day-to-day app work.

### 1. Clone

```powershell
git clone https://github.com/fjlj/GA-PDF-Editor.git
cd GA-PDF-Editor
```

### 2. Fetch vendor libraries and fonts

From the **repo root** (setup finds `app\` automatically):

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\package\setup.ps1
```

If the SVC is not built yet, setup still downloads libs/fonts; it will skip starting the server until the EXE exists.

That fills:

| Path | Contents |
|------|----------|
| `app/lib/pdfjs/` | PDF.js + cmaps + standard fonts |
| `app/lib/pdf-lib/` | pdf-lib |
| `app/lib/html2canvas/` | html2canvas |
| `app/lib/tesseract/` | Tesseract.js + English data + `file://` embeds |
| `app/lib/qpdf/` | qpdf WASM (password protect) |
| `app/assets/fonts/` + `app/assets/css/fonts.css` | Web fonts |

Pinned URLs / mirrors: `tools/package/vendors.manifest.json`. More flags: `tools/package/SETUP.md`.

Useful switches:

```powershell
.\tools\package\setup.ps1 -SkipFonts
.\tools\package\setup.ps1 -SkipLibs
.\tools\package\setup.ps1 -AppRoot .\app
.\tools\package\setup.ps1 -QpdfSource C:\path\to\folder\with\qpdf.js+qpdf.wasm
```

### 3. Build the local server (`GA-PDF-Editor-SVC.exe`)

The app is static files. The SVC is a small **127.0.0.1** HTTP server (default port **17880**) that serves `./app` so PWA / workers / WASM behave cleanly. **No admin** required. Sources: `tools/GA-PDF-Launcher/` (`main.c` + mongoose).

Put `gcc` on your `PATH` (MinGW-w64, TDM-GCC, or MSYS2 `mingw-w64-gcc`), then from the **repo root**:

```powershell
cd tools\GA-PDF-Launcher

gcc -c main.c -o main.o -Os -mwindows
gcc -c libs\mongoose.c -o libs\mongoose.o -Os -mwindows
gcc main.o libs\mongoose.o -o GA-PDF-Editor-SVC.exe -static-libgcc -mwindows -lws2_32 -s

# Install next to app\ (required layout)
copy /Y GA-PDF-Editor-SVC.exe ..\..\GA-PDF-Editor-SVC.exe
cd ..\..
```

Check:

```powershell
Test-Path .\GA-PDF-Editor-SVC.exe   # should be True
```

**Dev-C++ / Embarcadero:** `Makefile.win` is the original Dev-C++ makefile (include/lib paths point at a local Dev-C++ install — edit or use the `gcc` lines above if those paths do not match your machine).

You need **`GA-PDF-Editor-SVC.exe` at the repo root** (same folder as `app\`). That is the binary `package.ps1` will put in release zips.

### 4. Run the app

```powershell
# Prefer: start the SVC you just built
.\GA-PDF-Editor-SVC.exe
```

On bind it writes **`Open GA PDF Editor.url`** next to the EXE (default `http://127.0.0.1:17880`). Open that once; install as a PWA if you want.

Or re-run setup only to start the server (libs already present):

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\package\setup.ps1 -SkipLibs -SkipFonts
```

Temporary stand-in (no SVC) while debugging UI only:

```powershell
python -m http.server 17880 --directory app
```

`file://` can work for light tests after setup, but **HTTP via the SVC is the intended path**.

Port override:

```text
GA-PDF-Editor-SVC.exe --port 27991
set GAPDF_SVC_PORT=27991
```

### 5. Smoke-check

1. Open a multi-page PDF  
2. Editor: text + rectangle + circle (**O**); undo/redo  
3. Save **Project** (`.gapdf`) and reopen  
4. Save **PDF**  
5. Optional: Form workspace field → export fillable PDF; OCR; password protect  

### 6. Build a redistributable zip (maintainers)

After steps 2–3 (libs + **your built** SVC at repo root):

```powershell
cd tools\package
.\package.ps1                  # dist\GA-PDF-Editor-*-slim-*.zip  (recipients run Setup.bat)
.\package.ps1 -IncludeFullLibs # full offline zip (libs already inside)
```

Zip expands to a single folder:

```text
GA-PDF-Editor\
  GA-PDF-Editor-SVC.exe
  Setup.bat
  app\
  tools\                 setup.ps1, SETUP.md, vendors.manifest.json
  tools\package\         package.ps1 only
  tools\render-docs.ps1
  dev\
  DOCs\
  README.md
  VERSION
  SETUP-FIRST.txt
```

Recipients of a **slim** zip: double-click **`Setup.bat`** once (network). Details: `tools/package/SETUP.md` (becomes `tools\SETUP.md` inside the zip).

### 7. Regenerate documentation HTML

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\render-docs.ps1
# optional: .\tools\render-docs.ps1 -Clean
```

Open `DOCs\index.html` → **Print / PDF**. Edit Markdown under `dev/it-templates/` etc., then re-run.

---

## Repository layout

| Path | Role |
|------|------|
| **`app/`** | Web application (`index.html`, `js/`, `assets/`; `lib/` empty until setup) |
| **`GA-PDF-Editor-SVC.exe`** | Local static server (not in git — build or copy from a release) |
| **`tools/package/`** | `setup.ps1`, `package.ps1`, `vendors.manifest.json`, `SETUP.md` |
| **`tools/render-docs.ps1`** | Render Markdown → `DOCs\` HTML (print / PDF) |
| **`tools/GA-PDF-Launcher/`** | SVC C source (`main.c`, mongoose) |
| **`dev/`** | Design notes, changelogs, multi-doc PWA guide (Markdown) |
| **`dev/it-templates/`** | IT adoption Markdown (edit these) |
| **`DOCs/`** | Print-friendly HTML (case study, `it-templates/`, guides) |
| **`dist/`** | Built zips (**gitignored** — publish via the [download site](https://give.academy/GA-PDF-Editor/)) |

---

## Key capabilities

| Area | Highlights |
|------|------------|
| **Tabs** | Multi-document workspace (optional via `config.js`) |
| **Workspaces** | Editor (annotate + fill) vs Form (design fields) |
| **Fillable forms** | Designer shells; export re-embeds AcroForms; sticky geometry |
| **Passwords** | Open password dialog; optional export protect (QPDF WASM) |
| **History** | Undo / redo (command pattern) |
| **OCR** | Tesseract.js offline; **active tab only** |
| **Project save** | Real PDF + appended gzip JSON (`.gapdf`) |
| **Final PDF** | Flatten annotations; keep fields fillable; optional encrypt |
| **PWA** | `manifest.json`, install-only SW on HTTP(S) |

---

## Deploy options

| Path | How |
|------|-----|
| **Local SVC + PWA** | Unzip → double-click `Setup.bat` (if slim) → open `.url` once |
| **Intranet HTTPS** | Host `app/` on your web server |
| **USB / share** | Slim or full zip from `tools\package\package.ps1` |

---

## Documentation HTML (print / PDF)

**Source of truth is Markdown.** Edit the `.md` files in the tree, then regenerate HTML for browsing or **Print → Save as PDF** (no npm; pure PowerShell).

| What you edit | What you open after render |
|---------------|----------------------------|
| **`dev/it-templates/*.md`** | **`DOCs/it-templates/*.html`** (IT pack: adoption, deploy, security, support, change request) |
| `README.md`, `dev/*.md`, `tools/package/SETUP.md`, … | Matching paths under **`DOCs/`** |
| **`DOCs/CASE-STUDY.html`** | Lives in DOCs (field journal; not generated from Markdown) |

### IT templates → print packet

Internal IT can customize the light adoption templates under **`dev/it-templates/`** (fill in bracketed fields, drop into ServiceNow/wiki, etc.). When you want browser-ready / printable copies:

1. Edit the `.md` files in **`dev/it-templates/`** (and any other package docs you care about).  
2. From the package root, regenerate HTML:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\render-docs.ps1
# full wipe + rebuild:
powershell -ExecutionPolicy Bypass -File .\tools\render-docs.ps1 -Clean
```

3. Open **`DOCs\index.html`** or jump straight to **`DOCs\it-templates\`**.  
4. Use the page **Print / PDF** button (or Ctrl+P → **Save as PDF**). Enable background graphics in the print dialog if you want the dark case-study theme in the PDF.

Do **not** hand-edit files under **`DOCs/`** if you plan to re-run the renderer — `-Clean` regenerates that tree from Markdown.

## Versioning

- Product / package: **`VERSION`** and this README (semver **1.5.4**).  
- Browser cache-bust: `app/config.js` → `version` (may include a short slug after the numbers).  
- Title bar shows the numeric part only (e.g. `GA PDF Editor 1.5.4`).
