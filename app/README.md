# app/ layout

```
app/
  index.html          # shell + script loader
  config.js           # version + feature flags
  manifest.json       # PWA
  sw.js               # network-only service worker
  assets/
    css/              # app stylesheets
      fonts.css
      style.css
    fonts/            # UI web fonts (.woff2)
    icons/            # favicon + PWA icons
  js/                 # application source
    core/
    engine/
    features/
    interaction/
    overlays/
    ui/
  lib/                # third-party vendors (do not edit lightly)
    pdfjs/            # PDF.js + cmaps + standard_fonts
    pdf-lib/
    html2canvas/
    qpdf/
    tesseract/
```

Paths in code are relative to `app/` (where index.html lives).

## Slim package / offline vendors

Heavy `lib/` and `assets/fonts/` can be omitted for shipping. Maintainers:

```powershell
cd tools\package
.\package.ps1                 # dist\*-slim-*.zip  (ships tools\setup.ps1 in the zip)
.\package.ps1 -IncludeFullLibs
```

Recipients (after unzip): double-click **`Setup.bat`** at the package root.

See `tools/SETUP.md` in the zip (source: `tools/package/SETUP.md`).
