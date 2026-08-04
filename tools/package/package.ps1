#Requires -Version 5.1
<#
.SYNOPSIS
  Build a shippable zip: app + GA-PDF-Editor-SVC.exe + setup scripts (optional slim libs).

.DESCRIPTION
  Zip contains a single root folder (so unzip always creates a clean directory):

    GA-PDF-Editor\
      GA-PDF-Editor-SVC.exe   local HTTP shell (serves ./app)
      app\                    web app
      Setup.bat               double-click me (runs tools\setup.ps1)
      tools\                  setup.ps1, SETUP.md, vendors.manifest.json (recipient path)
      tools\package\          package.ps1 only
      tools\render-docs.ps1
      dev\                    notes / it-templates (Markdown)
      DOCs\                   print HTML pack
      README.md
      VERSION
      SETUP-FIRST.txt

  Slim mode strips lib/ binaries and assets/fonts; recipients double-click Setup.bat once.

.PARAMETER OutDir
  Where to write the zip (default: dist/ under the repo root).

.PARAMETER IncludeQpdf
  Copy real lib/qpdf into a slim package.

.PARAMETER IncludeFullLibs
  Ship a full offline package (no vendor stubs).

.EXAMPLE
  .\package.ps1
  .\package.ps1 -IncludeFullLibs
#>
[CmdletBinding()]
param(
    [string]$OutDir = "",
    [switch]$IncludeQpdf,
    [switch]$IncludeFullLibs
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$AppSrc = Join-Path $RepoRoot "app"
if (-not (Test-Path (Join-Path $AppSrc "index.html"))) {
    throw "Cannot find app/ under $RepoRoot"
}

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
}

function Write-Gitkeep([string]$Dir, [string]$Note) {
    Ensure-Dir $Dir
    $text = $Note + "`r`n`r`nRun setup to fill this folder:`r`n  powershell -ExecutionPolicy Bypass -File .\tools\setup.ps1`r`n"
    Set-Content -Path (Join-Path $Dir "README.txt") -Value $text -Encoding UTF8
}

function Copy-AppTree {
    param([string]$From, [string]$To, [string[]]$ExcludeTopLevel = @())
    Ensure-Dir $To
    Get-ChildItem $From -Force | ForEach-Object {
        if ($ExcludeTopLevel -contains $_.Name) { return }
        $dest = Join-Path $To $_.Name
        if ($_.PSIsContainer) {
            Copy-Item -Recurse -Force $_.FullName $dest
        } else {
            Copy-Item -Force $_.FullName $dest
        }
    }
}

# Version for zip name
$ver = "0.0.0"
$cfgPath = Join-Path $AppSrc "config.js"
if (Test-Path $cfgPath) {
    $raw = Get-Content $cfgPath -Raw
    if ($raw -match 'version:\s*"([^"]+)"') {
        $full = $Matches[1]
        if ($full -match '^(\d+(?:\.\d+)*)') { $ver = $Matches[1] } else { $ver = $full }
    }
}

if (-not $OutDir) { $OutDir = Join-Path $RepoRoot "dist" }
Ensure-Dir $OutDir

$stamp = Get-Date -Format "yyyyMMdd"
if ($IncludeFullLibs) {
    $zipName = "GA-PDF-Editor-$ver-full-$stamp.zip"
} else {
    $zipName = "GA-PDF-Editor-$ver-slim-$stamp.zip"
}

$stageRoot = Join-Path $env:TEMP ("ga-pdf-pack-" + [guid]::NewGuid().ToString("n"))
# Everything lives under GA-PDF-Editor\ so the zip expands to one folder (not a file dump)
$rootFolderName = "GA-PDF-Editor"
$stage = Join-Path $stageRoot $rootFolderName
$stageApp = Join-Path $stage "app"
$stageTools = Join-Path $stage "tools"

Write-Host "Staging package -> $stage" -ForegroundColor Cyan
if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
Ensure-Dir $stageApp
Ensure-Dir $stageTools

# Local HTTP shell next to app\
$svcCandidates = @(
    (Join-Path $RepoRoot "GA-PDF-Editor-SVC.exe"),
    (Join-Path $RepoRoot "tools\GA-PDF-Launcher\GA-PDF-Editor-SVC.exe")
)
$svcSrc = $null
foreach ($c in $svcCandidates) {
    if (Test-Path $c) { $svcSrc = $c; break }
}
if ($svcSrc) {
    Copy-Item -Force $svcSrc (Join-Path $stage "GA-PDF-Editor-SVC.exe")
    Write-Host "Included GA-PDF-Editor-SVC.exe" -ForegroundColor Green
} else {
    Write-Warning "GA-PDF-Editor-SVC.exe not found - package will not include the Windows server shell"
}

if ($IncludeFullLibs) {
    Copy-AppTree -From $AppSrc -To $stageApp
} else {
    Copy-AppTree -From $AppSrc -To $stageApp -ExcludeTopLevel @("lib")
    $fontsDir = Join-Path $stageApp "assets\fonts"
    if (Test-Path $fontsDir) {
        Get-ChildItem $fontsDir -File -ErrorAction SilentlyContinue | Remove-Item -Force
    }
}

if (-not $IncludeFullLibs) {
    Write-Host "Writing lib/ + fonts stubs ..."
    $libRoot = Join-Path $stageApp "lib"
    if (Test-Path $libRoot) { Remove-Item -Recurse -Force $libRoot }
    Write-Gitkeep (Join-Path $libRoot "pdfjs") "PDF.js + cmaps + standard_fonts (from pdfjs-dist)"
    Write-Gitkeep (Join-Path $libRoot "pdf-lib") "pdf-lib"
    Write-Gitkeep (Join-Path $libRoot "html2canvas") "html2canvas"
    Write-Gitkeep (Join-Path $libRoot "tesseract") "tesseract.js + OCR language data"
    Write-Gitkeep (Join-Path $libRoot "qpdf") "qpdf WASM (password protect)"

    $fontsDir = Join-Path $stageApp "assets\fonts"
    if (Test-Path $fontsDir) { Remove-Item -Recurse -Force $fontsDir }
    Write-Gitkeep $fontsDir "Google Fonts .woff2 files (written by setup.ps1)"

    $fontsCss = Join-Path $stageApp "assets\css\fonts.css"
    Ensure-Dir (Split-Path $fontsCss -Parent)
    $stubCss = "/* STUB - web fonts not installed yet." + "`r`n" +
        " * Run:  powershell -ExecutionPolicy Bypass -File .\tools\setup.ps1" + "`r`n" +
        " * System fonts (Arial, Georgia, etc.) still work until then." + "`r`n" +
        " */" + "`r`n"
    Set-Content $fontsCss -Value $stubCss -Encoding UTF8

    if ($IncludeQpdf) {
        $qSrc = Join-Path $AppSrc "lib\qpdf"
        if ((Test-Path (Join-Path $qSrc "qpdf.js")) -and (Test-Path (Join-Path $qSrc "qpdf.wasm"))) {
            Write-Host "Including real lib/qpdf ..." -ForegroundColor Yellow
            Ensure-Dir (Join-Path $stageApp "lib\qpdf")
            Copy-Item -Force (Join-Path $qSrc "qpdf.js") (Join-Path $stageApp "lib\qpdf\qpdf.js")
            Copy-Item -Force (Join-Path $qSrc "qpdf.wasm") (Join-Path $stageApp "lib\qpdf\qpdf.wasm")
            if (Test-Path (Join-Path $qSrc "qpdf.wasm.embed.js")) {
                Copy-Item -Force (Join-Path $qSrc "qpdf.wasm.embed.js") (Join-Path $stageApp "lib\qpdf\qpdf.wasm.embed.js")
            }
        } else {
            Write-Warning "IncludeQpdf requested but source app\lib\qpdf incomplete"
        }
    }
}

# Setup toolkit sources: repo keeps them next to package.ps1; a shipped zip
# flattens them to tools\ (parent of tools\package\). Prefer local, then parent.
$toolsParent = Split-Path -Parent $ScriptDir  # .../tools
function Resolve-SetupSource([string]$Name) {
    foreach ($dir in @($ScriptDir, $toolsParent)) {
        $p = Join-Path $dir $Name
        if (Test-Path $p) { return $p }
    }
    return $null
}

# Flat under tools\ for recipients (Setup.bat / SETUP-FIRST path) — single copy only
foreach ($name in @("setup.ps1", "vendors.manifest.json", "SETUP.md")) {
    $src = Resolve-SetupSource $name
    if ($src) {
        Copy-Item -Force $src (Join-Path $stageTools $name)
    } else {
        Write-Warning "$name not found under tools\package\ or tools\"
    }
}

# Packager only under tools\package\ (no second copy of setup files)
$stagePkg = Join-Path $stageTools "package"
Ensure-Dir $stagePkg
$packagePs1 = Join-Path $ScriptDir "package.ps1"
if (-not (Test-Path $packagePs1)) {
    $packagePs1 = Join-Path $toolsParent "package\package.ps1"
}
if (Test-Path $packagePs1) {
    Copy-Item -Force $packagePs1 (Join-Path $stagePkg "package.ps1")
    Write-Host "Included tools\package\package.ps1 (packager only)" -ForegroundColor Green
} else {
    Write-Warning "package.ps1 not found"
}

# Docs renderer (regenerate DOCs\ from Markdown after editing templates)
$renderDocs = Join-Path $RepoRoot "tools\render-docs.ps1"
if (Test-Path $renderDocs) {
    Copy-Item -Force $renderDocs (Join-Path $stageTools "render-docs.ps1")
    Write-Host "Included tools\render-docs.ps1" -ForegroundColor Green
}

# Root Setup.bat — double-click target for recipients (not buried under tools\)
$rootBatSrc = Join-Path $RepoRoot "Setup.bat"
if (Test-Path $rootBatSrc) {
    Copy-Item -Force $rootBatSrc (Join-Path $stage "Setup.bat")
    Write-Host "Included Setup.bat (package root)" -ForegroundColor Green
} else {
    Write-Warning "Setup.bat not found at repo root - slim recipients need a double-click launcher"
}

# Markdown / design notes (source). Case study HTML lives under DOCs\ only.
$devSrc = Join-Path $RepoRoot "dev"
if (Test-Path $devSrc) {
    $stageDev = Join-Path $stage "dev"
    if (Test-Path $stageDev) { Remove-Item -Recurse -Force $stageDev }
    Copy-Item -Recurse -Force $devSrc $stageDev
    # Capture/demo rebuild kit stays in the repo only
    foreach ($drop in @(
            (Join-Path $stageDev "case-study"),
            (Join-Path $stageDev "CASE-STUDY.html")
        )) {
        if (Test-Path $drop) {
            Remove-Item -Recurse -Force $drop
            Write-Host "Omitted $($drop.Substring($stage.Length).TrimStart('\','/')) (case study ships in DOCs\)" -ForegroundColor DarkGray
        }
    }
    Get-ChildItem -Path $stageDev -Recurse -Directory -Filter "node_modules" -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
    Get-ChildItem -Path $stageDev -Recurse -File -Filter "package-lock.json" -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -Force $_.FullName }
    Write-Host "Included dev\ (notes + it-templates Markdown)" -ForegroundColor Green
} else {
    Write-Warning "dev\ folder not found - skipping"
}

# Printable HTML pack (case study, it-templates HTML, changelogs, index)
$docsSrc = Join-Path $RepoRoot "DOCs"
if (Test-Path $docsSrc) {
    $stageDocs = Join-Path $stage "DOCs"
    if (Test-Path $stageDocs) { Remove-Item -Recurse -Force $stageDocs }
    Copy-Item -Recurse -Force $docsSrc $stageDocs
    # Never ship capture tooling if it snuck under DOCs\case-study\demos
    $docsDemos = Join-Path $stageDocs "case-study\demos"
    if (Test-Path $docsDemos) {
        Remove-Item -Recurse -Force $docsDemos
        Write-Host "Omitted DOCs\case-study\demos (capture tooling)" -ForegroundColor DarkGray
    }
    Get-ChildItem -Path $stageDocs -Recurse -Directory -Filter "node_modules" -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -Recurse -Force $_.FullName }
    Get-ChildItem -Path $stageDocs -Recurse -File -Filter "package-lock.json" -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -Force $_.FullName }
    Write-Host "Included DOCs\ (print HTML + case study)" -ForegroundColor Green
} else {
    Write-Warning "DOCs\ not found - run tools\render-docs.ps1 before packaging if you want the HTML pack"
}

foreach ($doc in @("README.md", "VERSION")) {
    $src = Join-Path $RepoRoot $doc
    if (Test-Path $src) {
        Copy-Item -Force $src (Join-Path $stage $doc)
        Write-Host "Included $doc" -ForegroundColor Green
    } else {
        Write-Warning "$doc not found at repo root - skipping"
    }
}

$built = Get-Date -Format "yyyy-MM-dd"
$lines = New-Object System.Collections.Generic.List[string]
[void]$lines.Add("GA PDF Editor - package")
[void]$lines.Add("=======================")
[void]$lines.Add("Version: $ver")
[void]$lines.Add("Built:   $built")
[void]$lines.Add("")
if ($IncludeFullLibs) {
    [void]$lines.Add("FULL offline package.")
    [void]$lines.Add("")
    [void]$lines.Add("1. Unzip anywhere.")
    [void]$lines.Add("2. Double-click GA-PDF-Editor-SVC.exe (starts local server; no browser).")
    [void]$lines.Add("   On bind it writes 'Open GA PDF Editor.url' with the live port")
    [void]$lines.Add("   (default 17880 assumed free on first run).")
    [void]$lines.Add("3. Open 'Open GA PDF Editor.url' once (PWA install in the browser).")
    [void]$lines.Add("4. Optional start-on-boot (server only, still no browser):")
    [void]$lines.Add("     powershell -ExecutionPolicy Bypass -File .\tools\setup.ps1 -SkipLibs -SkipFonts")
} else {
    [void]$lines.Add("SLIM package (libs + fonts not included).")
    [void]$lines.Add("")
    [void]$lines.Add("1. Unzip anywhere.")
    [void]$lines.Add("2. Double-click Setup.bat")
    [void]$lines.Add("")
    [void]$lines.Add("   Downloads vendors/fonts, starts GA-PDF-Editor-SVC.exe so")
    [void]$lines.Add("   'Open GA PDF Editor.url' is written (default port 17880 assumed")
    [void]$lines.Add("   free on first run), and can enable start-on-boot.")
    [void]$lines.Add("")
    [void]$lines.Add("3. Open 'Open GA PDF Editor.url' once (install PWA if desired).")
    [void]$lines.Add("")
    [void]$lines.Add("See tools\SETUP.md for details.")
}
Set-Content (Join-Path $stage "SETUP-FIRST.txt") -Value ($lines -join "`r`n") -Encoding UTF8

$zipPath = Join-Path $OutDir $zipName
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Write-Host "Compressing $zipPath (root folder: $rootFolderName\) ..." -ForegroundColor Cyan
# Compress the folder itself so zip root is GA-PDF-Editor\... not loose files
Compress-Archive -Path $stage -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -Recurse -Force $stageRoot

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ""
Write-Host ("Created: {0} ({1} MB)" -f $zipPath, $sizeMb) -ForegroundColor Green
Write-Host "Unzip creates: $rootFolderName\  (app, tools, DOCs, Setup.bat, ...)" -ForegroundColor DarkGray
if (-not $IncludeFullLibs) {
    Write-Host "Recipients must run Setup.bat once (network required)." -ForegroundColor Yellow
}
