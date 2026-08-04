# Changelog — Forms reliability, app layout, offline package & SVC (1.4 → 1.5.3)

**Product version:** `1.5.3` (see root `VERSION` for current)  
**Runtime cache-bust:** `app/config.js` → `1.5.3-pack-docs`  
**Date:** 2026-07-30  

**Later:** **[CHANGELOG-1.5.4-circle.md](CHANGELOG-1.5.4-circle.md)** — Circle / Ellipse shape tool (+ `dev/patches/1.5.4-circle-shape.diff`).

Earlier series still documented separately:

- `CHANGELOG-1.2.0-tabs.md` — multi-doc tabs, session restore, form fill UX  
- `CHANGELOG-1.3.0-instruction-processor.md` — GaProcessor / command-pattern history  
- **`CASE-STUDY.html`** — narrative technical case study (accomplishments, hurdles, tricks)

This file covers work from **~1.3.6 through 1.5.3** (forms export/import races, folder reorg, slim package, local server shell).

---

## 1.5.3 — Pack docs, ship layout polish (2026-07-30)

**Packager / ship**

- Slim zip root now includes **`dev/`**, **`README.md`**, **`VERSION`** (not only `app\` + tools).
- Setup scripts ship under **`tools\`** (not nested `tools\package\`) for a clearer user layout.
- Root **`README.md`** / **`VERSION`** refreshed to match multi-tab, SVC, and setup flow.
- Maintainer scripts remain under repo `tools\package\` (`package.ps1` flattens into the zip).

**SVC (unchanged behavior, documented in this release chain)**

- See 1.5.2 notes: single-instance, sticky port, `.url` file, no auto-browser.

---

## 1.5.2 — Offline setup, multi-CDN, SVC packaging (2026-07-30)

**`tools/package/`**

| Script | Role |
|--------|------|
| `package.ps1` | Build slim/full zip (`dist\GA-PDF-Editor-*-slim-*.zip`) |
| `setup.ps1` | Download vendors + fonts; generate embeds; optional start-on-boot |
| `vendors.manifest.json` | Pinned versions + **URL fallbacks** (unpkg / npm / cdnjs before jsDelivr) |
| `SETUP.md` | Operator docs |

**Downloads (setup)**

- pdfjs-dist **3.11.174** → `lib/pdfjs/` (`pdf.local.js` / `pdf.worker.local.js` + cmaps + standard_fonts)
- pdf-lib, html2canvas, tesseract.js + eng.traineddata + **file:// `*.embed.js`**
- **qpdf** from npm **`@neslinesli93/qpdf-wasm@0.3.0`** + 4-line `window.QpdfModule` glue (same build as in-tree; wasm SHA matches)
- Google Fonts → `assets/fonts/` + generated `assets/css/fonts.css`

**Start-on-boot**

- Optional: user **Startup folder** shortcut (default) or **HKCU Run**
- **No admin** — localhost high port does not need elevation
- Working directory = package root so mongoose `./app` resolves
- Flags: `-EnableStartup`, `-DisableStartup`, `-StartupMethod Registry|StartupFolder`

**SVC packaging**

- Zip includes **`GA-PDF-Editor-SVC.exe`** next to `app\`

---

## 1.5.1 — OCR active tab only (2026-07-30)

**Bug:** Scan OCR walked every `.pageContainer` in the document (all tabs).  

**Fix:** Scope OCR to the **active viewer** (`getActiveViewer()` / `APP.DOM.viewer`).

---

## 1.5.0 — App folder reorg (2026-07-30)

```text
app/
  assets/
    css/          fonts.css, style.css
    fonts/        *.woff2
    icons/        favicon + PWA icons
  js/             application source (unchanged structure)
  lib/
    pdfjs/        pdf.local.js, worker, cmaps/, standard_fonts/
    pdf-lib/
    html2canvas/
    qpdf/
    tesseract/
  index.html, config.js, manifest.json, sw.js
```

All loaders and runtime paths updated (index script list, PDF.js cMap/font URLs, OCR, qpdf, manifest icons).

---

## 1.4.4 — Title shows numeric version only (2026-07-30)

Browser title uses **semver digits only** (e.g. `GA PDF Editor 1.5.3`), not the cache-bust slug (`-pack-docs`, etc.).

---

## 1.4.3 — Title + File menu Close (2026-07-30)

- Version string in window title (`appTitle` + version).
- File menu: **Close** / **Close All** (wired to `GaWorkspace.closeActiveDocument` / `closeAllDocuments`).

---

## 1.4.2 — Forms restore race after open/refresh (2026-07-30)

**Bug:** Form shells sometimes missing after hard refresh / session restore (intermittent).

**Causes & fixes**

- Removed fire-and-forget `setTimeout(100)` for `applyProjectData` — apply **immediately** after pages + annotation layers finish.
- Id collision checks scoped to **this viewer** (not `document.getElementById` across tabs).
- **`ensureFormsReadyForViewer` / `scheduleEnsureFormsReady`**: re-apply schema or re-import natives at 0 / 120 / 400 / 1000 / 2500 ms.
- Native re-import no longer gated on annotation-layer DOM classes (those paint async).

---

## 1.4.1 — Form embed: create vs page widget (2026-07-30)

**Bug signature (console):**

```text
wrote widgets= 0  failed= N  form.getFields()= N
```

Fields were registered on the AcroForm, but **page widgets never landed** (or create collided with zombies).

**Fixes**

- Drain / hard-reset leftover fields after strip.
- Safe box math (never pass `NaN` into `addToPage`).
- `ga_` field name prefix; retry boxes; count **fields with page widgets**.
- `embedOneFormField` helper.

---

## 1.4.0 — KISS form export path (2026-07-30)

**Problem:** Live PDF export dropped forms; gapdf round-trip was the only “workaround,” then that broke too after aggressive strip/cache experiments.

**Approach**

1. Snapshot designer shells from the DOM.  
2. Strip original page Widget annots + catalog AcroForm.  
3. Create a **fresh** AcroForm and write snapshots.  
4. Flat field names (no hierarchical `.` segments for pdf-lib).  
5. Project save also re-embeds designer fields into the project PDF half.

Related earlier attempts (1.3.8–1.3.9): formCache invalidate after strip — necessary insight, but incomplete until 1.4.0/1.4.1.

---

## 1.3.7 — Form multi-select group drag (2026-07-30)

**Bug:** Marquee selected form fields, but group drag failed in Form mode.

**Cause:** CSS `pointer-events: none` on `.stencil-box` under `body.workspace-form`, and drag-engine isolation rejected non-`formFieldOverlay` elements (stencil is a group shell).

**Fix:** Stencil stays interactive/opaque in Form mode; stencil/group drag allowed through workspace isolation.

---

## 1.3.6 — Export: strip native widgets hard (2026-07-29)

**Bug:** Deleted designer forms still appeared in exported PDF (orphaned page `/Widget` annots after `copyPages`).

**Fix:** Aggressive strip: `removeField` + page Annots Widget pass + catalog `/AcroForm` cleanup. Export path: strip when forms managed, then re-embed remaining designer shells.

(Later refinements in 1.4.x fixed re-embed reliability.)

---

## Forms lifecycle (end state as of 1.5.3)

| Stage | Behavior |
|-------|----------|
| **Open fillable PDF** | Import natives → designer shells; hide/suppress natives when managed |
| **Edit in Form mode** | Move/resize multi-select via stencil; geometry syncs |
| **Save `.gapdf`** | Schema overlays + strip natives from embedded PDF + re-embed designers |
| **Export PDF** | Strip + re-embed from live designer shells; report widget count |
| **Reopen / hard refresh** | Immediate project apply + scheduled ensure-forms-ready |
| **Delete all forms** | Strip only → exported PDF has zero AcroForms |

---

## SVC shell (1.5.x)

| Feature | Detail |
|---------|--------|
| Default URL | `http://127.0.0.1:17880/` |
| Single instance | Named mutex; second launch exits quietly |
| No auto-browser | Startup-safe |
| PWA entry | Writes **`Open GA PDF Editor.url`** with live port |
| Sticky port | Reuses port from `.url` unless `--port` / `GAPDF_SVC_PORT` |
| Port busy | MessageBox (no silent port hop — protects installed PWA origin) |
| Working dir | `chdir` to EXE folder so `./app` works from Startup / Run |

Source: `tools/GA-PDF-Launcher/main.c`.

---

## Config version timeline (cache-bust strings)

Approximate `GA_CONFIG.version` progression in this arc:

| String | Theme |
|--------|--------|
| `1.3.6-strip-widgets-hard` | Export strip natives |
| `1.3.7-form-group-drag` | Stencil drag in Form mode |
| `1.3.8` / `1.3.9` | formCache / re-embed experiments |
| `1.4.0-forms-kiss` | Snapshot → strip → fresh embed |
| `1.4.1-form-addtopage` | Widget-on-page reliability |
| `1.4.2-forms-ready-race` | Restore races |
| `1.4.3-title-close` | Title + Close menu |
| `1.4.4-title-semver` | Numeric title only |
| `1.5.0-folder-reorg` | assets/ + lib/* packages |
| `1.5.1-ocr-active-tab` | OCR scope |
| `1.5.2-offline-setup` | package/setup scripts |
| `1.5.3-pack-docs` | Ship dev/README/VERSION; tools flat |
| `1.5.4-pack-docs` | Add Circle tool; Fix toolbar rotating with shapes |

---

## Operator quick reference

```powershell
# Build slim zip
cd tools\package
.\package.ps1

# Recipient setup (from zip root)
powershell -ExecutionPolicy Bypass -File .\tools\setup.ps1

# Local server
.\GA-PDF-Editor-SVC.exe
# then open: Open GA PDF Editor.url  (once for PWA)
```
