#requires -Version 5.1
<#
.SYNOPSIS
  Render repository Markdown into a print-friendly HTML tree under DOCs/.

.DESCRIPTION
  No npm. Pure PowerShell. Discovers *.md under the package root (skips dist,
  node_modules, backups) and writes mirrored *.html under DOCs/, plus index.html.

  Open DOCs/index.html in a browser, then Print → Save as PDF if needed.

.EXAMPLE
  # From package / repo root:
  powershell -ExecutionPolicy Bypass -File .\tools\render-docs.ps1

.EXAMPLE
  powershell -File .\tools\render-docs.ps1 -Clean
#>
[CmdletBinding()]
param(
    [string]$Root,
    [string]$OutDirName = "DOCs",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

# Build fancy glyphs at runtime so Windows PowerShell 5.1 never mis-decodes the .ps1 file itself
$script:EmDash = [string][char]0x2014   # —
$script:MidDot = [string][char]0x00B7   # ·
$script:Utf8Bom = New-Object System.Text.UTF8Encoding $true
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Read-TextFileUtf8([string]$path) {
    $bytes = [IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        return $script:Utf8NoBom.GetString($bytes, 3, $bytes.Length - 3)
    }
    # Prefer UTF-8; most project markdown is UTF-8 without BOM
    return $script:Utf8NoBom.GetString($bytes)
}

function Write-TextFileUtf8Bom([string]$path, [string]$text) {
    # BOM helps browsers (and file://) pick UTF-8 so titles don't show as "â€""
    [IO.File]::WriteAllText($path, $text, $script:Utf8Bom)
}

if (-not $Root) {
    $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    $Root = (Resolve-Path $Root).Path
}

$outRoot = Join-Path $Root $OutDirName
$excludeDirNames = @(
    "node_modules", "dist", ".git", "_backup_pre_port_20260730-035918",
    "DOCs", "docs"  # avoid re-rendering output
)
# Path prefixes (posix-style, relative to package root) never rendered
$excludePathPrefixes = @(
    "dev/case-study/"   # demo/scripts assets — not operator docs
    # tools/package/ SETUP.md is included — packager ships in the zip now
)

function Test-ExcludedPath([string]$fullPath) {
    $rel = $fullPath.Substring($Root.Length).TrimStart("\", "/").Replace("\", "/")
    foreach ($prefix in $excludePathPrefixes) {
        if ($rel.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    foreach ($seg in ($rel -split "/")) {
        if ($excludeDirNames -contains $seg) { return $true }
        if ($seg -like "_backup*") { return $true }
    }
    return $false
}

function Convert-MdToHtmlBody([string]$md) {
    $lines = $md -split "`r?`n"
    $html = New-Object System.Collections.Generic.List[string]
    $i = 0

    $st = @{
        InCode    = $false
        InUl      = $false
        InOl      = $false
        InTable   = $false
        InBq      = $false
        CodeBuf   = New-Object System.Collections.Generic.List[string]
        TableRows = New-Object System.Collections.Generic.List[string]
        BqBuf     = New-Object System.Collections.Generic.List[string]
    }

    function Inline([string]$t) {
        # Split out inline code so we don't style-match inside ticks
        $parts = [regex]::Split($t, '(`[^`]+`)')
        $out = New-Object System.Collections.Generic.List[string]
        foreach ($part in $parts) {
            if ($part -match '^`([^`]+)`$') {
                $out.Add("<code>" + [System.Net.WebUtility]::HtmlEncode($Matches[1]) + "</code>")
                continue
            }
            $s = [System.Net.WebUtility]::HtmlEncode($part)
            # Links: [text](url); rewrite .md -> .html for local docs (loop for PS 5.1 safety)
            $linkRx = [regex]'\[([^\]]+)\]\(([^)]+)\)'
            $sb = New-Object System.Text.StringBuilder
            $last = 0
            foreach ($m in $linkRx.Matches($s)) {
                [void]$sb.Append($s.Substring($last, $m.Index - $last))
                $label = $m.Groups[1].Value
                $href = $m.Groups[2].Value
                if ($href -match '\.md($|#)') { $href = $href -replace '\.md(?=$|#)', '.html' }
                if ($href -match '\.markdown($|#)') { $href = $href -replace '\.markdown(?=$|#)', '.html' }
                [void]$sb.Append("<a href=`"$href`">$label</a>")
                $last = $m.Index + $m.Length
            }
            [void]$sb.Append($s.Substring($last))
            $s = $sb.ToString()
            $s = [regex]::Replace($s, '\*\*([^*]+)\*\*', '<strong>$1</strong>')
            $s = [regex]::Replace($s, '(?<!\*)\*([^*]+)\*(?!\*)', '<em>$1</em>')
            $s = [regex]::Replace($s, '~~([^~]+)~~', '<del>$1</del>')
            $out.Add($s)
        }
        return ($out -join "")
    }

    function Is-TableSeparator([string]$row) {
        $t = $row.Trim().Trim("|").Trim()
        if ($t -eq "") { return $false }
        $parts = $t -split "\|" | ForEach-Object { $_.Trim() }
        if ($parts.Count -lt 1) { return $false }
        foreach ($p in $parts) {
            if ($p -notmatch '^:?-{3,}:?$') { return $false }
        }
        return $true
    }

    function Close-Lists {
        if ($st.InUl) { $html.Add("</ul>"); $st.InUl = $false }
        if ($st.InOl) { $html.Add("</ol>"); $st.InOl = $false }
    }

    function Close-Blockquote {
        if (-not $st.InBq) { return }
        $joined = ($st.BqBuf | ForEach-Object { $_.Trim() }) -join " "
        $html.Add("<blockquote>" + (Inline $joined) + "</blockquote>")
        $st.BqBuf.Clear()
        $st.InBq = $false
    }

    function Close-Table {
        if (-not $st.InTable) { return }
        $html.Add("<table>")
        $headerDone = $false
        foreach ($row in $st.TableRows) {
            if (Is-TableSeparator $row) { continue }
            $cells = @(($row.Trim().Trim("|") -split "\|") | ForEach-Object { $_.Trim() })
            if ($cells.Count -eq 0) { continue }
            $tag = if (-not $headerDone) { "th" } else { "td" }
            $html.Add("<tr>")
            foreach ($c in $cells) { $html.Add("<$tag>" + (Inline $c) + "</$tag>") }
            $html.Add("</tr>")
            $headerDone = $true
        }
        $html.Add("</table>")
        $st.TableRows.Clear()
        $st.InTable = $false
    }

    function Close-All-Blocks {
        Close-Lists
        Close-Table
        Close-Blockquote
    }

    $fence = ([string][char]0x60) * 3

    while ($i -lt $lines.Count) {
        $line = $lines[$i]

        if ($line.StartsWith($fence)) {
            if ($st.InCode) {
                Close-All-Blocks
                $html.Add("<pre><code>" + [System.Net.WebUtility]::HtmlEncode(($st.CodeBuf -join "`n")) + "</code></pre>")
                $st.CodeBuf.Clear(); $st.InCode = $false
            } else {
                Close-All-Blocks
                $st.InCode = $true
            }
            $i++; continue
        }
        if ($st.InCode) { $st.CodeBuf.Add($line); $i++; continue }

        if ($line -match '^\s*\|') {
            Close-Lists
            Close-Blockquote
            $st.InTable = $true
            $st.TableRows.Add($line)
            $i++; continue
        }
        if ($st.InTable) { Close-Table }

        if ($line -match '^\s*$') {
            Close-All-Blocks
            $i++; continue
        }

        if ($line -match '^>\s?(.*)$') {
            Close-Lists
            Close-Table
            $st.InBq = $true
            $st.BqBuf.Add($Matches[1])
            $i++; continue
        }
        if ($st.InBq) { Close-Blockquote }

        if ($line -match '^#### (.+)$') {
            Close-All-Blocks
            $html.Add("<h4>" + (Inline $Matches[1]) + "</h4>")
            $i++; continue
        }
        if ($line -match '^### (.+)$') {
            Close-All-Blocks
            $html.Add("<h3>" + (Inline $Matches[1]) + "</h3>")
            $i++; continue
        }
        if ($line -match '^## (.+)$') {
            Close-All-Blocks
            $html.Add("<h2>" + (Inline $Matches[1]) + "</h2>")
            $i++; continue
        }
        if ($line -match '^# (.+)$') {
            Close-All-Blocks
            $html.Add("<h1>" + (Inline $Matches[1]) + "</h1>")
            $i++; continue
        }

        if ($line -match '^---+\s*$') {
            Close-All-Blocks
            $html.Add("<hr>")
            $i++; continue
        }

        # Task list / checkbox
        if ($line -match '^[-*]\s+\[([ xX])\]\s+(.+)$') {
            if (-not $st.InUl) {
                Close-Lists
                $html.Add("<ul class=`"task-list`">")
                $st.InUl = $true
            }
            $checked = if ($Matches[1] -match '[xX]') { " checked" } else { "" }
            $html.Add("<li class=`"task`"><input type=`"checkbox`" disabled$checked> " + (Inline $Matches[2]) + "</li>")
            $i++; continue
        }

        if ($line -match '^[-*] (.+)$') {
            if (-not $st.InUl) {
                Close-Lists
                $html.Add("<ul>")
                $st.InUl = $true
            }
            $html.Add("<li>" + (Inline $Matches[1]) + "</li>")
            $i++; continue
        }

        if ($line -match '^\d+\.\s+(.+)$') {
            if (-not $st.InOl) {
                Close-Lists
                $html.Add("<ol>")
                $st.InOl = $true
            }
            $html.Add("<li>" + (Inline $Matches[1]) + "</li>")
            $i++; continue
        }

        Close-Lists
        $html.Add("<p>" + (Inline $line) + "</p>")
        $i++
    }

    Close-All-Blocks
    if ($st.InCode) {
        $html.Add("<pre><code>" + [System.Net.WebUtility]::HtmlEncode(($st.CodeBuf -join "`n")) + "</code></pre>")
    }
    return ($html -join "`n")
}

function Get-DocTitle([string]$md, [string]$fallback) {
    foreach ($line in ($md -split "`r?`n")) {
        if ($line -match '^#\s+(.+)$') {
            return $Matches[1].Trim()
        }
    }
    return $fallback
}

function Get-RelativePath([string]$fromDir, [string]$toFile) {
    $fromUri = New-Object Uri (([IO.Path]::GetFullPath($fromDir).TrimEnd("\") + [IO.Path]::DirectorySeparatorChar))
    $toUri = New-Object Uri ([IO.Path]::GetFullPath($toFile))
    $rel = $fromUri.MakeRelativeUri($toUri).ToString()
    return [Uri]::UnescapeDataString($rel).Replace("\", "/")
}

function Get-SharedCss {
    # Visual language matches dev/CASE-STUDY.html (dark field-journal theme)
    @"
:root {
  --bg: #0f1419;
  --bg-elev: #1a222c;
  --bg-card: #1e2833;
  --border: #2d3a47;
  --text: #e7ecf1;
  --muted: #9aa8b5;
  --accent: #0af;
  --accent-dim: rgba(0, 170, 255, 0.12);
  --warn: #f0a030;
  --ok: #3ecf8e;
  --danger: #e85d5d;
  --purple: #a78bfa;
  --font: "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "Cascadia Code", "Fira Code", Consolas, monospace;
  --radius: 10px;
  --max: 54rem;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.65;
  font-size: 16.5px;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  background-image:
    linear-gradient(rgba(0, 170, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 170, 255, 0.03) 1px, transparent 1px);
  background-size: 48px 48px;
  pointer-events: none;
  z-index: 0;
}
.top {
  position: sticky; top: 0; z-index: 30;
  background: rgba(15, 20, 25, 0.9);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.top-inner {
  position: relative; z-index: 1;
  max-width: var(--max);
  margin: 0 auto;
  padding: 0.7rem 1.5rem;
  display: flex; flex-wrap: wrap; gap: 0.65rem 1.1rem;
  align-items: center; justify-content: space-between;
  font-size: 0.9rem;
}
.brand {
  font-weight: 700; color: var(--text); text-decoration: none; letter-spacing: -0.01em;
}
.brand span { color: var(--muted); font-weight: 500; }
.top nav { display: flex; flex-wrap: wrap; gap: 0.5rem 0.95rem; align-items: center; }
.top a { color: var(--accent); text-decoration: none; font-weight: 600; }
.top a:hover { text-decoration: underline; }
.btn-print {
  border: 1px solid var(--border);
  background: var(--bg-elev);
  border-radius: 8px;
  padding: 0.35rem 0.7rem;
  font: inherit; font-weight: 600; cursor: pointer;
  color: var(--text);
}
.btn-print:hover {
  border-color: rgba(0, 170, 255, 0.45);
  color: var(--accent);
  background: var(--accent-dim);
}
.wrap {
  position: relative; z-index: 1;
  max-width: var(--max);
  margin: 0 auto;
  padding: 2rem 1.5rem 5rem;
}
.eyebrow {
  display: inline-block;
  font-size: 0.75rem; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent);
  background: var(--accent-dim);
  border: 1px solid rgba(0, 170, 255, 0.25);
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  margin: 0 0 0.85rem;
}
.doc-meta {
  display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem;
  font-size: 0.88rem; color: var(--muted);
  margin: 0 0 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}
.doc-meta strong { color: var(--text); font-weight: 600; }
.doc-meta code {
  font-family: var(--mono); font-size: 0.86em;
  background: var(--bg-elev); border: 1px solid var(--border);
  padding: 0.1em 0.35em; border-radius: 4px;
}
article h1 {
  font-size: clamp(1.85rem, 4vw, 2.45rem);
  line-height: 1.2; font-weight: 750;
  margin: 0 0 0.75rem; letter-spacing: -0.02em;
}
article h2 {
  font-size: 1.4rem; margin: 2rem 0 0.85rem;
  padding-bottom: 0.5rem; border-bottom: 1px solid var(--border);
  letter-spacing: -0.015em;
}
article h3 { font-size: 1.05rem; margin: 1.35rem 0 0.5rem; color: var(--text); }
article h4 { font-size: 0.98rem; margin: 1.15rem 0 0.4rem; color: var(--muted); }
article p { margin: 0 0 0.9rem; }
article ul, article ol { margin: 0 0 0.9rem; padding-left: 1.35rem; }
article li { margin: 0.3rem 0; }
article li::marker { color: var(--accent); }
article ul.task-list { list-style: none; padding-left: 0.15rem; }
article li.task { display: flex; gap: 0.5rem; align-items: flex-start; }
article li.task::marker { content: none; }
article li.task input { margin-top: 0.35rem; accent-color: var(--accent); }
a { color: var(--accent); }
code, .mono { font-family: var(--mono); font-size: 0.86em; }
code {
  background: var(--bg-elev); border: 1px solid var(--border);
  padding: 0.1em 0.35em; border-radius: 4px;
}
pre {
  background: #0a0e12; border: 1px solid var(--border);
  border-radius: var(--radius); padding: 0.9rem 1.05rem;
  overflow-x: auto; font-family: var(--mono); font-size: 0.78rem;
  line-height: 1.5; margin: 0 0 1rem; color: #c5d0da;
}
pre code { background: none; border: 0; padding: 0; color: inherit; }
table {
  width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0 0 1rem;
}
th, td {
  text-align: left; padding: 0.5rem 0.6rem;
  border-bottom: 1px solid var(--border); vertical-align: top;
}
th {
  color: var(--muted); font-weight: 650; font-size: 0.78rem;
  text-transform: uppercase; letter-spacing: 0.04em;
}
tr:hover td { background: rgba(255, 255, 255, 0.02); }
blockquote {
  margin: 0 0 1rem; padding: 0.55rem 0 0.55rem 1rem;
  border-left: 3px solid var(--accent); color: var(--muted);
}
blockquote strong { color: var(--text); }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.8rem 0; }
.footer-note {
  margin-top: 2.5rem; padding-top: 1.35rem;
  border-top: 1px solid var(--border);
  font-size: 0.85rem; color: var(--muted);
}
/* Index */
.hero-block { margin-bottom: 1.75rem; }
.hero-block .lede { color: var(--muted); max-width: 42rem; margin: 0.5rem 0 1rem; }
.cards { display: grid; gap: 0.85rem; }
@media (min-width: 720px) { .cards { grid-template-columns: 1fr 1fr; } }
a.card-link {
  display: block; text-decoration: none; color: inherit;
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 1.05rem 1.2rem;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
a.card-link:hover {
  border-color: rgba(0, 170, 255, 0.4);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}
a.card-link h3 {
  margin: 0 0 0.35rem; font-size: 1.02rem; color: var(--accent);
}
a.card-link p { margin: 0; font-size: 0.9rem; color: var(--muted); }
a.card-link .path {
  font-family: var(--mono); font-size: 0.75rem;
  color: var(--muted); margin-top: 0.55rem; opacity: 0.9;
}
.section-label {
  margin: 1.75rem 0 0.65rem; font-size: 0.75rem;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--muted); font-weight: 700;
}
@media print {
  body::before { display: none; }
  .top { position: static; backdrop-filter: none; }
  .btn-print, .no-print { display: none !important; }
  .wrap { max-width: none; padding: 0.5rem 0 1.5rem; }
  .footer-note { display: none; }
  a { color: inherit; }
  h2, h3 { break-after: avoid; }
  table, pre, blockquote, a.card-link { break-inside: avoid; }
  pre { white-space: pre-wrap; }
}
"@
}

function Wrap-Page {
    param(
        [string]$Title,
        [string]$Body,
        [string]$SourceRel,
        [string]$IndexHref,
        [string]$CssHref,
        [string]$CaseStudyHref = "",
        [string]$ExtraNav = "",
        [string]$Eyebrow = "Documentation"
    )
    $srcNote = if ($SourceRel) {
        "<strong>Source</strong> <code>$([System.Net.WebUtility]::HtmlEncode($SourceRel))</code>"
    } else {
        "<strong>Generated</strong> by <code>tools\render-docs.ps1</code>"
    }
    $caseNav = if ($CaseStudyHref) {
        "<a href=`"$CaseStudyHref`">Case study</a>"
    } else { "" }

@"
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>$([System.Net.WebUtility]::HtmlEncode($Title)) $($script:EmDash) GA PDF Editor</title>
<link rel="stylesheet" href="$CssHref">
</head>
<body>
<header class="top">
  <div class="top-inner">
    <a class="brand" href="$IndexHref">GA PDF Editor <span>$($script:MidDot) Docs</span></a>
    <nav class="no-print">
      <a href="$IndexHref">Index</a>
      $caseNav
      $ExtraNav
      <button type="button" class="btn-print" onclick="window.print()">Print / PDF</button>
    </nav>
  </div>
</header>
<div class="wrap">
  <div class="eyebrow">$([System.Net.WebUtility]::HtmlEncode($Eyebrow))</div>
  <p class="doc-meta">$srcNote</p>
  <article>
$body
  </article>
  <p class="footer-note">Same visual language as the field journal / case study. Chrome / Edge: <strong>Print $($script:EmDash) Save as PDF</strong> (enable background graphics to keep the dark theme).</p>
</div>
</body>
</html>
"@
}

function Get-OutputRelForSource([string]$relUnix) {
    # Promote IT templates to DOCs/it-templates/ (not nested under DOCs/dev/)
    if ($relUnix -match '^dev/it-templates/(.+)$') {
        return "it-templates/" + [IO.Path]::ChangeExtension($Matches[1], ".html")
    }
    return [IO.Path]::ChangeExtension($relUnix, ".html")
}

function Fix-ItTemplateHrefs([string]$html, [string]$outRelUnix) {
    # Rewrite links that still point at the source tree path dev/it-templates/...
    # into the promoted DOCs/it-templates/ location (relative to the current page).
    $depth = @($outRelUnix.Split("/") | Where-Object { $_ }).Count - 1
    if ($depth -lt 0) { $depth = 0 }
    $toRoot = if ($depth -le 0) { "" } else { ("../" * $depth) }
    $toIt = $toRoot + "it-templates/"

    $rx = [regex]'href="(?:\./)?(?:(?:\.\./)+)?dev/it-templates/([^"]+)"'
    $sb = New-Object System.Text.StringBuilder
    $last = 0
    foreach ($m in $rx.Matches($html)) {
        [void]$sb.Append($html.Substring($last, $m.Index - $last))
        $leaf = $m.Groups[1].Value
        [void]$sb.Append("href=`"$toIt$leaf`"")
        $last = $m.Index + $m.Length
    }
    [void]$sb.Append($html.Substring($last))
    return $sb.ToString()
}

# --- Discover markdown -------------------------------------------------------
$mdFiles = @(
    Get-ChildItem -Path $Root -Recurse -File -Filter "*.md"
    Get-ChildItem -Path $Root -Recurse -File -Filter "*.markdown" -ErrorAction SilentlyContinue
) | Where-Object { $_ -and -not (Test-ExcludedPath $_.FullName) } |
    Sort-Object FullName -Unique

if ($mdFiles.Count -eq 0) {
    Write-Warning "No markdown files found under $Root"
    exit 1
}

# Preserve hand-authored case study across -Clean (not generated from Markdown)
$preserveCaseStudy = $null
$preserveCaseAssets = @()
$csKeep = Join-Path $outRoot "CASE-STUDY.html"
$csAssetDir = Join-Path $outRoot "case-study"
if ($Clean -and (Test-Path $outRoot)) {
    if (Test-Path $csKeep) {
        $preserveCaseStudy = [IO.File]::ReadAllBytes($csKeep)
    }
    if (Test-Path $csAssetDir) {
        Get-ChildItem $csAssetDir -File -ErrorAction SilentlyContinue | ForEach-Object {
            $preserveCaseAssets += [pscustomobject]@{ Name = $_.Name; Bytes = [IO.File]::ReadAllBytes($_.FullName) }
        }
    }
    Remove-Item -Path $outRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $outRoot | Out-Null
if ($null -ne $preserveCaseStudy) {
    [IO.File]::WriteAllBytes((Join-Path $outRoot "CASE-STUDY.html"), $preserveCaseStudy)
    Write-Host "  preserved CASE-STUDY.html across -Clean" -ForegroundColor DarkGray
}
if ($preserveCaseAssets.Count -gt 0) {
    $restoredAssets = Join-Path $outRoot "case-study"
    New-Item -ItemType Directory -Force -Path $restoredAssets | Out-Null
    foreach ($a in $preserveCaseAssets) {
        [IO.File]::WriteAllBytes((Join-Path $restoredAssets $a.Name), $a.Bytes)
    }
}
$assetsDir = Join-Path $outRoot "assets"
New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null
$cssPath = Join-Path $assetsDir "docs.css"
Write-TextFileUtf8Bom $cssPath (Get-SharedCss)

$rendered = New-Object System.Collections.Generic.List[object]

foreach ($file in $mdFiles) {
    $rel = $file.FullName.Substring($Root.Length).TrimStart("\", "/")
    $relUnix = $rel.Replace("\", "/")
    $outRel = Get-OutputRelForSource $relUnix
    $outRelUnix = $outRel.Replace("\", "/")
    $outPath = Join-Path $outRoot $outRel
    $outDir = Split-Path $outPath -Parent
    if (-not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }

    $md = Read-TextFileUtf8 $file.FullName
    if ($null -eq $md) { $md = "" }
    $title = Get-DocTitle $md ([IO.Path]::GetFileNameWithoutExtension($file.Name))
    $body = Convert-MdToHtmlBody $md
    $body = Fix-ItTemplateHrefs $body $outRelUnix

    $cssHref = (Get-RelativePath $outDir $cssPath)
    $indexHref = (Get-RelativePath $outDir (Join-Path $outRoot "index.html"))
    $caseHref = (Get-RelativePath $outDir (Join-Path $outRoot "CASE-STUDY.html"))

    $eyebrow = if ($relUnix -match '^dev/it-templates') { "IT adoption template" }
        elseif ($relUnix -match '^dev/') { "Development notes" }
        elseif ($relUnix -match '^tools/') { "Tools / setup" }
        elseif ($relUnix -match '^app/') { "Application" }
        else { "Documentation" }

    $page = Wrap-Page -Title $title -Body $body -SourceRel $relUnix `
        -IndexHref $indexHref -CssHref $cssHref -CaseStudyHref $caseHref `
        -Eyebrow $eyebrow

    Write-TextFileUtf8Bom $outPath $page

    $section = if ($relUnix -match '^dev/it-templates') { "IT templates" }
        elseif ($relUnix -match '^dev/') { "Development notes" }
        elseif ($relUnix -match '^tools/') { "Tools / setup" }
        elseif ($relUnix -match '^app/') { "Application" }
        else { "Package root" }

    $rendered.Add([pscustomobject]@{
        Title   = $title
        RelMd   = $relUnix
        RelHtml = $outRelUnix
        Section = $section
    }) | Out-Null

    Write-Host "  $outRelUnix"
}

# Case study lives under DOCs\ as its own HTML (not generated from Markdown).
# If still present under dev\, promote once; never copy demos/ capture tooling.
$caseStudyDoc = Join-Path $outRoot "CASE-STUDY.html"
$caseStudyDev = Join-Path $Root "dev\CASE-STUDY.html"
if (-not (Test-Path $caseStudyDoc) -and (Test-Path $caseStudyDev)) {
    Write-TextFileUtf8Bom $caseStudyDoc (Read-TextFileUtf8 $caseStudyDev)
    Write-Host "  CASE-STUDY.html (promoted from dev\)"
}
$destAssets = Join-Path $outRoot "case-study"
$srcAssetsCandidates = @(
    (Join-Path $Root "DOCs\case-study"),
    (Join-Path $Root "dev\case-study")
)
foreach ($srcAssets in $srcAssetsCandidates) {
    if (-not (Test-Path $srcAssets)) { continue }
    if ((Resolve-Path $srcAssets).Path -eq (Resolve-Path (Split-Path $destAssets -Parent) -ErrorAction SilentlyContinue) ) { }
    # Only shallow media at case-study root (icons, shots) - never demos/
    if (-not (Test-Path $destAssets)) {
        New-Item -ItemType Directory -Force -Path $destAssets | Out-Null
    }
    if (([IO.Path]::GetFullPath($srcAssets)) -ne ([IO.Path]::GetFullPath($destAssets))) {
        Get-ChildItem $srcAssets -File -ErrorAction SilentlyContinue | ForEach-Object {
            Copy-Item -Force $_.FullName (Join-Path $destAssets $_.Name)
        }
    }
    break
}
# Strip demos if present (node_modules, puppeteer, etc.)
$docsDemos = Join-Path $destAssets "demos"
if (Test-Path $docsDemos) {
    Remove-Item -Recurse -Force $docsDemos
    Write-Host "  stripped case-study/demos (capture tooling)" -ForegroundColor DarkGray
}
if (Test-Path $caseStudyDoc) {
    $rendered.Add([pscustomobject]@{
        Title   = "Technical case study / field journal"
        RelMd   = "DOCs/CASE-STUDY.html"
        RelHtml = "CASE-STUDY.html"
        Section = "Development notes"
    }) | Out-Null
    Write-Host "  CASE-STUDY.html (in DOCs\)"
}

# --- Index -------------------------------------------------------------------
$bySection = $rendered | Group-Object Section | Sort-Object {
    switch ($_.Name) {
        "IT templates" { 0 }
        "Package root" { 1 }
        "Application" { 2 }
        "Development notes" { 3 }
        "Tools / setup" { 4 }
        default { 9 }
    }
}

$cardsHtml = New-Object System.Collections.Generic.List[string]
foreach ($grp in $bySection) {
    $cardsHtml.Add("<div class=`"section-label`">$([System.Net.WebUtility]::HtmlEncode($grp.Name))</div>")
    $cardsHtml.Add("<div class=`"cards`">")
    foreach ($item in ($grp.Group | Sort-Object RelHtml)) {
        $t = [System.Net.WebUtility]::HtmlEncode($item.Title)
        $p = [System.Net.WebUtility]::HtmlEncode($item.RelHtml)
        $src = [System.Net.WebUtility]::HtmlEncode($item.RelMd)
        $cardsHtml.Add(@"
<a class="card-link" href="$($item.RelHtml)">
  <h3>$t</h3>
  <p>Open rendered HTML $($script:MidDot) print or Save as PDF from the browser.</p>
  <div class="path">$p <span style="opacity:.7">$($script:EmDash) $src</span></div>
</a>
"@)
    }
    $cardsHtml.Add("</div>")
}

$indexBody = @"
<div class="hero-block">
  <h1>GA PDF Editor $($script:EmDash) documentation</h1>
  <p class="lede">
    Browser-ready copies of package Markdown, styled like the field journal.
    IT adoption templates live in <code>it-templates/</code> at the root of this folder.
  </p>
  <p><strong>Regenerate:</strong> <code>powershell -ExecutionPolicy Bypass -File .\tools\render-docs.ps1</code></p>
</div>
$($cardsHtml -join "`n")
"@

$indexPage = Wrap-Page -Title "Documentation index" -Body $indexBody -SourceRel "" `
    -IndexHref "index.html" -CssHref "assets/docs.css" -CaseStudyHref "CASE-STUDY.html" `
    -Eyebrow "Docs index"

Write-TextFileUtf8Bom (Join-Path $outRoot "index.html") $indexPage

$readmeTxt = @"
GA PDF Editor - DOCs (generated HTML)
=====================================

Produced by:  tools\render-docs.ps1
Source of truth: *.md files in the package tree (not these HTML files).

Open index.html in a browser.
Print / Save as PDF: page header button or Ctrl+P.

Do not hand-edit HTML here if you re-run the renderer (-Clean wipes this folder).
"@
Write-TextFileUtf8Bom (Join-Path $outRoot "README.txt") $readmeTxt

Write-Host ""
Write-Host "Done. $($rendered.Count) page(s) → $outRoot"
Write-Host "Open: $((Join-Path $outRoot 'index.html'))"
