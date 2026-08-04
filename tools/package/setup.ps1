#Requires -Version 5.1
<#
.SYNOPSIS
  Download vendor libs + Google Fonts, generate offline assets, and start the local SVC.

.DESCRIPTION
  Run from the unzipped package root (or pass -AppRoot).

  After a slim package (empty lib/ + fonts/), this restores offline capability:
    - lib/pdfjs, pdf-lib, html2canvas, tesseract (+ file:// embeds)
    - assets/fonts/*.woff2 + assets/css/fonts.css
    - lib/qpdf if -QpdfSource is provided (custom WASM build)

  If GA-PDF-Editor-SVC.exe is present next to app\, setup starts it (package root as
  working directory) so Open GA PDF Editor.url is written. Default port is 17880;
  setup only assumes that is free on first run — the live URL is always the .url file.

.PARAMETER AppRoot
  Path to the app/ directory (contains index.html).

.PARAMETER QpdfSource
  Optional folder containing qpdf.js + qpdf.wasm to copy (and embed for file://).

.PARAMETER SkipFonts
  Skip Google Fonts download / fonts.css generation.

.PARAMETER SkipLibs
  Skip vendor library downloads.

.PARAMETER EnableStartup
  Install GA-PDF-Editor-SVC.exe to start at user logon (no prompt).

.PARAMETER DisableStartup
  Remove any previous start-on-boot registration (no prompt).

.PARAMETER SkipStartup
  Do not ask about or change start-on-boot.

.PARAMETER StartupMethod
  How to register start-on-boot: StartupFolder (default) or Registry.

.EXAMPLE
  .\setup.ps1
  .\setup.ps1 -AppRoot D:\ship\app -EnableStartup
  .\setup.ps1 -EnableStartup -StartupMethod Registry
  .\setup.ps1 -DisableStartup -SkipLibs -SkipFonts
#>
[CmdletBinding()]
param(
    [string]$AppRoot = "",
    [string]$QpdfSource = "",
    [switch]$SkipFonts,
    [switch]$SkipLibs,
    [switch]$EnableStartup,
    [switch]$DisableStartup,
    [switch]$SkipStartup,
    [ValidateSet("StartupFolder", "Registry")]
    [string]$StartupMethod = "StartupFolder"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "  XX  $msg" -ForegroundColor Red }

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Download-File {
    param(
        # Single URL or list of fallbacks (jsDelivr / unpkg / npm / cdnjs, etc.)
        [Parameter(Mandatory = $true)]
        $Url,
        [string]$Dest,
        [hashtable]$Headers = $null
    )
    Ensure-Dir (Split-Path $Dest -Parent)
    $tmp = $Dest + ".tmp"
    $urls = @()
    if ($Url -is [System.Array]) { $urls = @($Url) }
    elseif ($null -ne $Url) { $urls = @([string]$Url) }

    $errors = New-Object System.Collections.Generic.List[string]
    foreach ($u in $urls) {
        if ([string]::IsNullOrWhiteSpace($u)) { continue }
        try {
            Write-Host ("    GET " + $u)
            if ($null -ne $Headers) {
                Invoke-WebRequest -Uri $u -OutFile $tmp -UseBasicParsing -Headers $Headers
            } else {
                Invoke-WebRequest -Uri $u -OutFile $tmp -UseBasicParsing
            }
            if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 0)) {
                Move-Item -Force $tmp $Dest
                return
            }
            $errors.Add("$u -> empty response")
        } catch {
            $msg = $_.Exception.Message
            $errors.Add("$u -> $msg")
            Write-Warn ("    failed: " + $msg)
            if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
        }
    }
    throw ("Download failed for " + $Dest + "`n  " + ($errors -join "`n  "))
}

# Collect url + urls[] + fallbackUrl from a manifest object into a list.
function Get-UrlList($item) {
    $list = New-Object System.Collections.Generic.List[string]
    if ($null -eq $item) { return @() }
    if ($item.PSObject.Properties.Name -contains "urls" -and $item.urls) {
        foreach ($u in @($item.urls)) { if ($u) { [void]$list.Add([string]$u) } }
    }
    if ($item.PSObject.Properties.Name -contains "url" -and $item.url) {
        $u = [string]$item.url
        if (-not $list.Contains($u)) { [void]$list.Insert(0, $u) }
    }
    if ($item.PSObject.Properties.Name -contains "fallbackUrl" -and $item.fallbackUrl) {
        $u = [string]$item.fallbackUrl
        if (-not $list.Contains($u)) { [void]$list.Add($u) }
    }
    # Prefer non-jsdelivr first when DNS blocks jsdelivr (common corp / offline DNS issues)
    $preferred = New-Object System.Collections.Generic.List[string]
    $rest = New-Object System.Collections.Generic.List[string]
    foreach ($u in $list) {
        if ($u -match "jsdelivr") { [void]$rest.Add($u) } else { [void]$preferred.Add($u) }
    }
    return @($preferred + $rest)
}

function Write-Base64Embed {
    param(
        [string]$SourcePath,
        [string]$DestPath,
        [string]$GlobalName,
        [string]$Comment
    )
    Ensure-Dir (Split-Path $DestPath -Parent)
    $bytes = [IO.File]::ReadAllBytes($SourcePath)
    $b64 = [Convert]::ToBase64String($bytes)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $sw = New-Object System.IO.StreamWriter($DestPath, $false, $utf8)
    try {
        $sw.WriteLine("// $Comment")
        $sw.WriteLine("// Do not edit by hand. Generated by tools/setup.ps1")
        $sw.Write("window.$GlobalName = `"")
        $sw.Write($b64)
        $sw.WriteLine("`";")
    } finally {
        $sw.Close()
    }
}

# --- Resolve paths ---
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $AppRoot) {
    $candidates = @(
        (Join-Path $ScriptDir "..\app"),      # shipped: tools\setup.ps1 -> app\
        (Join-Path $ScriptDir "..\..\app"),   # repo: tools\package\setup.ps1 -> app\
        (Join-Path (Get-Location) "app"),
        (Get-Location).Path
    )
    foreach ($c in $candidates) {
        try {
            $resolved = Resolve-Path $c -ErrorAction Stop
            if (Test-Path (Join-Path $resolved.Path "index.html")) {
                $AppRoot = $resolved.Path
                break
            }
        } catch {
            # try next
        }
    }
}
if (-not $AppRoot) {
    throw "App root not found (no index.html). Pass -AppRoot path\to\app"
}
$AppRoot = (Resolve-Path $AppRoot).Path
if (-not (Test-Path (Join-Path $AppRoot "index.html"))) {
    throw "App root not found (no index.html). Pass -AppRoot path\to\app"
}

$ManifestPath = Join-Path $ScriptDir "vendors.manifest.json"
if (-not (Test-Path $ManifestPath)) {
    throw "Missing vendors.manifest.json next to setup.ps1"
}
$Manifest = Get-Content $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Host "GA PDF Editor - offline setup"
Write-Host "App root: $AppRoot"

# ============================================================================
# LIBS
# ============================================================================
if (-not $SkipLibs) {
    Write-Step "Vendor libraries"

    # --- pdf.js ---
    $pdfjs = $Manifest.pdfjs
    $tarball = Join-Path $env:TEMP ("pdfjs-dist-" + $pdfjs.version + ".tgz")
    $extractRoot = Join-Path $env:TEMP ("pdfjs-dist-" + $pdfjs.version + "-extract")
    Write-Host ("  pdfjs-dist@" + $pdfjs.version + " ...")
    $pdfjsTarballs = @($pdfjs.npmTarball)
    if ($pdfjs.PSObject.Properties.Name -contains "npmTarballFallbacks" -and $pdfjs.npmTarballFallbacks) {
        $pdfjsTarballs += @($pdfjs.npmTarballFallbacks)
    }
    Download-File -Url $pdfjsTarballs -Dest $tarball
    if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
    Ensure-Dir $extractRoot
    & tar -xzf $tarball -C $extractRoot
    if ($LASTEXITCODE -ne 0) {
        throw "tar failed extracting pdfjs-dist (need Windows tar / bsdtar)"
    }

    foreach ($prop in $pdfjs.map.PSObject.Properties) {
        $src = Join-Path $extractRoot $prop.Name
        $dest = Join-Path $AppRoot $prop.Value
        if (-not (Test-Path $src)) { throw "Missing in tarball: $($prop.Name)" }
        Ensure-Dir (Split-Path $dest -Parent)
        Copy-Item -Force $src $dest
        Write-Ok $prop.Value
    }
    foreach ($prop in $pdfjs.copyDirs.PSObject.Properties) {
        $src = Join-Path $extractRoot $prop.Name
        $dest = Join-Path $AppRoot $prop.Value
        if (-not (Test-Path $src)) { throw "Missing dir in tarball: $($prop.Name)" }
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        Ensure-Dir (Split-Path $dest -Parent)
        Copy-Item -Recurse -Force $src $dest
        Write-Ok ($prop.Value + "/")
    }

    # --- pdf-lib ---
    Write-Host "  pdf-lib ..."
    $dest = Join-Path $AppRoot $Manifest.pdfLib.dest
    Download-File -Url (Get-UrlList $Manifest.pdfLib) -Dest $dest
    Write-Ok $Manifest.pdfLib.dest

    # --- html2canvas ---
    Write-Host "  html2canvas ..."
    $dest = Join-Path $AppRoot $Manifest.html2canvas.dest
    Download-File -Url (Get-UrlList $Manifest.html2canvas) -Dest $dest
    Write-Ok $Manifest.html2canvas.dest

    # --- tesseract ---
    Write-Host "  tesseract.js ..."
    $tess = $Manifest.tesseract
    foreach ($key in @("tesseractJs", "worker", "core")) {
        $item = $tess.$key
        $dest = Join-Path $AppRoot $item.dest
        Download-File -Url (Get-UrlList $item) -Dest $dest
        Write-Ok $item.dest
    }
    $td = $tess.traineddata
    $tdDest = Join-Path $AppRoot $td.dest
    Download-File -Url (Get-UrlList $td) -Dest $tdDest
    Write-Ok $td.dest

    # file:// embeds (base64 globals)
    Write-Host "  generating file:// embeds ..."
    $workerSrc = Join-Path $AppRoot "lib\tesseract\tes.worker.min.js"
    $coreSrc   = Join-Path $AppRoot "lib\tesseract\tesseract-core-simd-lstm.wasm.js"
    $engGz     = Join-Path $AppRoot "lib\tesseract\eng.traineddata.gz"
    Write-Base64Embed -SourcePath $workerSrc `
        -DestPath (Join-Path $AppRoot "lib\tesseract\tes.worker.embed.js") `
        -GlobalName "__TESS_WORKER_B64" `
        -Comment "Auto-generated for file:// OCR. tes.worker.min.js source"
    Write-Base64Embed -SourcePath $coreSrc `
        -DestPath (Join-Path $AppRoot "lib\tesseract\tesseract-core.embed.js") `
        -GlobalName "__TESS_CORE_B64" `
        -Comment "Auto-generated for file:// OCR. tesseract-core-simd-lstm.wasm.js source"
    Write-Base64Embed -SourcePath $engGz `
        -DestPath (Join-Path $AppRoot "lib\tesseract\eng.traineddata.embed.js") `
        -GlobalName "__ENG_TRAINEDDATA_GZ_B64" `
        -Comment "Auto-generated: eng.traineddata.gz as base64 for file:// OCR"
    Write-Ok "tesseract embeds"

    # --- qpdf (@neslinesli93/qpdf-wasm + tiny QpdfModule glue) ---
    # This is the same build already in the tree: Emscripten qpdf CLI with
    # callMain/FS. Only difference from npm is we append window.QpdfModule.
    Write-Host "  qpdf (npm @neslinesli93/qpdf-wasm) ..."
    $qpdfDest = Join-Path $AppRoot "lib\qpdf"
    Ensure-Dir $qpdfDest
    $qcfg = $Manifest.qpdf
    $qsrc = $QpdfSource
    if (-not $qsrc -and $env:QPDF_SOURCE_DIR) { $qsrc = $env:QPDF_SOURCE_DIR }

    $qjsOut = Join-Path $AppRoot $qcfg.jsDest
    $qwasmOut = Join-Path $AppRoot $qcfg.wasmDest

    if ($qsrc -and (Test-Path (Join-Path $qsrc "qpdf.js")) -and (Test-Path (Join-Path $qsrc "qpdf.wasm"))) {
        Copy-Item -Force (Join-Path $qsrc "qpdf.js") $qjsOut
        Copy-Item -Force (Join-Path $qsrc "qpdf.wasm") $qwasmOut
        Write-Ok "lib/qpdf from -QpdfSource"
    } else {
        $qtgz = Join-Path $env:TEMP ("qpdf-wasm-" + $qcfg.version + ".tgz")
        $qextract = Join-Path $env:TEMP ("qpdf-wasm-" + $qcfg.version + "-extract")
        $qTarballs = @($qcfg.npmTarball)
        if ($qcfg.PSObject.Properties.Name -contains "npmTarballFallbacks" -and $qcfg.npmTarballFallbacks) {
            $qTarballs += @($qcfg.npmTarballFallbacks)
        }
        Download-File -Url $qTarballs -Dest $qtgz
        if (Test-Path $qextract) { Remove-Item -Recurse -Force $qextract }
        Ensure-Dir $qextract
        & tar -xzf $qtgz -C $qextract
        if ($LASTEXITCODE -ne 0) { throw "tar failed extracting qpdf-wasm" }
        $jsSrc = Join-Path $qextract $qcfg.jsFrom
        $wasmSrc = Join-Path $qextract $qcfg.wasmFrom
        if (-not (Test-Path $jsSrc) -or -not (Test-Path $wasmSrc)) {
            throw "qpdf-wasm tarball missing dist/qpdf.js or dist/qpdf.wasm"
        }
        Copy-Item -Force $wasmSrc $qwasmOut
        # Patch classic-script export (npm package is CommonJS/AMD only)
        $jsText = [IO.File]::ReadAllText($jsSrc)
        if ($jsText -notmatch "window\.QpdfModule") {
            $jsText = $jsText.TrimEnd() + @"

// GA PDF Editor: expose factory for classic <script> tags (setup.ps1)
if (typeof window !== "undefined") {
  window.QpdfModule = Module;
}
"@
        }
        [IO.File]::WriteAllText($qjsOut, $jsText)
        Write-Ok "lib/qpdf from npm (patched QpdfModule)"
    }

    Write-Base64Embed -SourcePath $qwasmOut `
        -DestPath (Join-Path $qpdfDest "qpdf.wasm.embed.js") `
        -GlobalName "__QPDF_WASM_B64" `
        -Comment "Auto-generated: qpdf.wasm as base64 for file://"
    Write-Ok "lib/qpdf/qpdf.wasm.embed.js"
}

# ============================================================================
# FONTS + fonts.css
# ============================================================================
if (-not $SkipFonts) {
    Write-Step "Google Fonts to assets/fonts + fonts.css"

    $gf = $Manifest.googleFonts
    $fontsDir = Join-Path $AppRoot $gf.fontsDir
    $cssDest  = Join-Path $AppRoot $gf.cssDest
    Ensure-Dir $fontsDir
    Ensure-Dir (Split-Path $cssDest -Parent)

    $familyParams = New-Object System.Collections.Generic.List[string]
    foreach ($f in $gf.families) {
        $name = $f.family -replace " ", "+"
        $weights = @($f.weights)
        if ($weights.Count -gt 1 -or ($weights.Count -eq 1 -and [int]$weights[0] -ne 400)) {
            $wght = ($weights -join ";")
            [void]$familyParams.Add("family=${name}:wght@${wght}")
        } else {
            [void]$familyParams.Add("family=$name")
        }
    }
    $cssUrl = "https://fonts.googleapis.com/css2?" + ($familyParams -join "&") + "&display=swap"
    Write-Host "  fetching CSS ..."

    $ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    $cssTmp = Join-Path $env:TEMP "ga-fonts-remote.css"
    Download-File -Url $cssUrl -Dest $cssTmp -Headers @{ "User-Agent" = $ua }

    $remoteCss = [IO.File]::ReadAllText($cssTmp)
    $urlRegex = [regex]'url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)'
    $found = $urlRegex.Matches($remoteCss)
    $seen = @{}
    $n = 0
    foreach ($m in $found) {
        $url = $m.Groups[1].Value
        if ($seen.ContainsKey($url)) { continue }
        $seen[$url] = $true
        $fileName = ($url -split "/")[-1]
        $dest = Join-Path $fontsDir $fileName
        if (-not (Test-Path $dest)) {
            Download-File -Url $url -Dest $dest -Headers @{ "User-Agent" = $ua }
            $n++
        }
        $remoteCss = $remoteCss.Replace($url, "../fonts/$fileName")
    }

    $remoteCss = $remoteCss -replace 'url\("(\.\./fonts/[^"]+)"\)', 'url($1)'
    $remoteCss = $remoteCss -replace "url\('(\.\./fonts/[^']+)'\)", 'url($1)'

    $names = ($gf.families | ForEach-Object { $_.family }) -join ", "
    $banner = @"
/* Generated by tools/setup.ps1 - do not hand-edit for shipping.
 * UI web fonts for offline use. Paths relative to assets/css/ -> ../fonts/
 * Families: $names
 */

"@
    [IO.File]::WriteAllText($cssDest, $banner + $remoteCss)
    Write-Ok ("downloaded $n new font files; wrote " + $gf.cssDest)
}

# ============================================================================
# Sanity
# ============================================================================
Write-Step "Sanity check"
$required = @(
    "lib/pdfjs/pdf.local.js",
    "lib/pdfjs/pdf.worker.local.js",
    "lib/pdfjs/cmaps",
    "lib/pdfjs/standard_fonts",
    "lib/pdf-lib/pdf-lib.min.js",
    "lib/html2canvas/html2canvas.min.js",
    "lib/tesseract/tesseract.min.js",
    "lib/tesseract/tes.worker.min.js",
    "lib/tesseract/tesseract-core-simd-lstm.wasm.js",
    "lib/tesseract/eng.traineddata.gz",
    "assets/css/fonts.css",
    "assets/css/style.css"
)
$missing = @()
foreach ($r in $required) {
    $p = Join-Path $AppRoot ($r -replace "/", "\")
    if (-not (Test-Path $p)) {
        $missing += $r
        Write-Fail "missing $r"
    } else {
        Write-Ok $r
    }
}
$fontCount = @(Get-ChildItem (Join-Path $AppRoot "assets\fonts") -Filter "*.woff2" -ErrorAction SilentlyContinue).Count
Write-Host "  fonts: $fontCount woff2 files"
if ($fontCount -lt 5 -and -not $SkipFonts) {
    Write-Warn "few font files - check Google Fonts network access"
}

if (Test-Path (Join-Path $AppRoot "lib\qpdf\qpdf.wasm")) {
    Write-Ok "lib/qpdf (password protect available)"
} else {
    Write-Warn "lib/qpdf incomplete - password-protect export unavailable"
}

# ============================================================================
# Start-on-boot for local HTTP shell (GA-PDF-Editor-SVC.exe)
# ============================================================================
# Package layout:  <root>\GA-PDF-Editor-SVC.exe  +  <root>\app\
$PackageRoot = Split-Path $AppRoot -Parent
$SvcExe = Join-Path $PackageRoot "GA-PDF-Editor-SVC.exe"
$StartupName = "GA PDF Editor Local Server"
$RunValueName = "GA-PDF-Editor-SVC"

function Remove-SvcStartup {
    # Startup folder shortcut
    $startupDir = [Environment]::GetFolderPath("Startup")
    $lnk = Join-Path $startupDir ($StartupName + ".lnk")
    if (Test-Path $lnk) {
        Remove-Item -Force $lnk -ErrorAction SilentlyContinue
        Write-Ok "removed Startup shortcut: $lnk"
    }
    # HKCU Run
    $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    try {
        $existing = Get-ItemProperty -Path $runKey -Name $RunValueName -ErrorAction SilentlyContinue
        if ($null -ne $existing) {
            Remove-ItemProperty -Path $runKey -Name $RunValueName -ErrorAction SilentlyContinue
            Write-Ok "removed registry Run value: $RunValueName"
        }
    } catch { /* ignore */ }
}

function Install-SvcStartup {
    param([string]$Method)

    if (-not (Test-Path $SvcExe)) {
        Write-Warn "GA-PDF-Editor-SVC.exe not found next to app\ ($PackageRoot) - cannot enable start-on-boot"
        return $false
    }

    # Absolute path; working dir must be package root so mongoose root_dir ./app works
    $svcFull = (Resolve-Path $SvcExe).Path
    $workDir = (Resolve-Path $PackageRoot).Path

    if ($Method -eq "Registry") {
        $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        # Quote path; optional: start minimized is not available via Run key alone
        $cmd = "`"$svcFull`""
        Set-ItemProperty -Path $runKey -Name $RunValueName -Value $cmd -Type String
        # Clear Startup-folder duplicate if any
        $startupDir = [Environment]::GetFolderPath("Startup")
        $lnk = Join-Path $startupDir ($StartupName + ".lnk")
        if (Test-Path $lnk) { Remove-Item -Force $lnk -ErrorAction SilentlyContinue }
        Write-Ok "HKCU Run -> $cmd"
        Write-Ok "Working directory is process-dependent; ensure the EXE lives next to app\ (it does)."
        return $true
    }

    # Default: user Startup folder shortcut (easy to see/remove; set WorkingDirectory)
    $startupDir = [Environment]::GetFolderPath("Startup")
    Ensure-Dir $startupDir
    $lnkPath = Join-Path $startupDir ($StartupName + ".lnk")
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($lnkPath)
    $sc.TargetPath = $svcFull
    $sc.WorkingDirectory = $workDir
    $sc.WindowStyle = 7  # minimized
    $sc.Description = "GA PDF Editor local server (default http://127.0.0.1:17880) - serves app\"
    $sc.Save()
    # Clear registry duplicate if any
    try {
        Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
            -Name $RunValueName -ErrorAction SilentlyContinue
    } catch { /* ignore */ }
    Write-Ok "Startup shortcut -> $lnkPath"
    Write-Ok "WorkingDirectory = $workDir"
    return $true
}

# Default listen port only — actual bind may differ if sticky .url / --port / GAPDF_SVC_PORT.
# Setup assumes the default is free the first time; the live URL is written to the .url file.
$DefaultSvcPort = 17880
$UrlShortcut = Join-Path $PackageRoot "Open GA PDF Editor.url"

function Get-UrlFromShortcut([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
        if ($raw -match '(?im)^\s*URL\s*=\s*(\S+)') { return $Matches[1].Trim() }
    } catch { /* ignore */ }
    return $null
}

function Start-SvcAndWaitForUrl {
    if (-not (Test-Path $SvcExe)) {
        Write-Warn "GA-PDF-Editor-SVC.exe not found next to app\ ($PackageRoot)"
        return $false
    }

    $svcFull = (Resolve-Path $SvcExe).Path
    $workDir = (Resolve-Path $PackageRoot).Path
    $already = Get-Process -Name "GA-PDF-Editor-SVC" -ErrorAction SilentlyContinue

    if ($already) {
        Write-Ok "GA-PDF-Editor-SVC already running (PID $(($already | Select-Object -ExpandProperty Id) -join ', '))"
    } else {
        Write-Host "  Starting GA-PDF-Editor-SVC.exe (working dir = package root) ..."
        # Minimized; no browser auto-open. First bind writes Open GA PDF Editor.url.
        try {
            Start-Process -FilePath $svcFull -WorkingDirectory $workDir -WindowStyle Minimized
        } catch {
            Write-Fail ("failed to start SVC: " + $_.Exception.Message)
            return $false
        }
        Write-Ok "process started"
    }

    # Wait for .url (SVC writes it on successful bind). Default port assumed free on first run.
    $deadline = (Get-Date).AddSeconds(12)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $UrlShortcut) { break }
        Start-Sleep -Milliseconds 250
    }

    if (Test-Path $UrlShortcut) {
        $live = Get-UrlFromShortcut $UrlShortcut
        if ($live) {
            Write-Ok "wrote Open GA PDF Editor.url -> $live"
        } else {
            Write-Ok "wrote Open GA PDF Editor.url"
        }
        return $true
    }

    Write-Warn "Open GA PDF Editor.url not created yet (default port $DefaultSvcPort may be busy, or SVC exited)."
    Write-Warn "Start GA-PDF-Editor-SVC.exe manually; if the port conflicts, free it or pass --port / GAPDF_SVC_PORT."
    return $false
}

if ($DisableStartup) {
    Write-Step "Remove start-on-boot"
    Remove-SvcStartup
} elseif (-not $SkipStartup) {
    Write-Step "Start on boot (GA-PDF-Editor-SVC.exe)"
    if (-not (Test-Path $SvcExe)) {
        Write-Warn "No GA-PDF-Editor-SVC.exe at package root - skip start-on-boot"
    } else {
        $want = $false
        if ($EnableStartup) {
            $want = $true
        } else {
            Write-Host ""
            Write-Host "  GA-PDF-Editor-SVC.exe serves app\ on localhost (default port $DefaultSvcPort)."
            Write-Host "  Setup assumes that default is free on first run; the live URL is written to"
            Write-Host "  'Open GA PDF Editor.url' next to the EXE (no browser auto-open; no admin)."
            Write-Host ""
            $ans = Read-Host "  Start this server automatically when you log in? [y/N]"
            if ($ans -match '^(y|yes)$') { $want = $true }
        }

        if ($want) {
            [void](Install-SvcStartup -Method $StartupMethod)
            Write-Host "  Remove later:  .\tools\setup.ps1 -DisableStartup -SkipLibs -SkipFonts" -ForegroundColor DarkGray
            Write-Host "  Or delete the shortcut under shell:Startup" -ForegroundColor DarkGray
        } else {
            Write-Ok "start-on-boot left unchanged (answered no / default)"
        }
    }
}

# ============================================================================
# Start local server so Open GA PDF Editor.url exists after setup
# ============================================================================
$svcUrlReady = $false
if (Test-Path $SvcExe) {
    Write-Step "Start local server (generate Open GA PDF Editor.url)"
    $svcUrlReady = Start-SvcAndWaitForUrl
}

Write-Host ""
if ($missing.Count -eq 0) {
    Write-Host "Setup complete." -ForegroundColor Green
    if (Test-Path $SvcExe) {
        $live = Get-UrlFromShortcut $UrlShortcut
        if ($svcUrlReady -and $live) {
            Write-Host "  Server running. Open:  Open GA PDF Editor.url  ($live)" -ForegroundColor Green
            Write-Host "  Install as a PWA once from the browser if desired." -ForegroundColor Green
        } elseif (Test-Path $UrlShortcut) {
            Write-Host "  Open:  Open GA PDF Editor.url  (next to the EXE)" -ForegroundColor Green
        } else {
            Write-Host "  Start:  GA-PDF-Editor-SVC.exe  (default :$DefaultSvcPort; writes the .url on bind)" -ForegroundColor Green
            Write-Host "  Then open: Open GA PDF Editor.url" -ForegroundColor Green
        }
    }
    Write-Host "  Or open: app\index.html directly" -ForegroundColor Green
    exit 0
} else {
    Write-Host ("Setup finished with " + $missing.Count + " missing required path(s).") -ForegroundColor Yellow
    exit 1
}
