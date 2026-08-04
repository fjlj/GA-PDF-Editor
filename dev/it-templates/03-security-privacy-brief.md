# GA PDF Editor — Security & privacy brief

**Audience:** Security / compliance / IT risk  
**Product version:** [e.g. 1.5.4]  
**Date:** [YYYY-MM-DD]  
**Classification of this brief:** [Internal]

---

## One-liner

Client-side PDF viewer/editor. Document content is processed **in the browser** (and optional local SVC). The application **does not upload PDF contents to a remote application backend**.

---

## Architecture snapshot

| Component | Role | Trust boundary |
|-----------|------|----------------|
| `app/` static assets | UI + PDF.js + pdf-lib + WASM helpers | Served from disk or your HTTPS host |
| `GA-PDF-Editor-SVC.exe` | Localhost static file server only | Binds **127.0.0.1**, not LAN by design |
| Browser | Renders PDF, runs JS, holds open docs | User workstation |
| IndexedDB (optional) | Session restore / cached PDF bytes | Same origin (localhost or your host) |
| Setup script | One-time vendor download (slim package) | Needs outbound HTTPS once |

---

## Data handling

| Question | Answer |
|----------|--------|
| Does the app send PDFs to the vendor cloud? | **No** application cloud upload path |
| Where do edits live until save? | In-memory / DOM + optional IndexedDB session |
| Project format | Real PDF bytes + appended gzip JSON (`.gapdf`) on disk chosen by user |
| Final PDF | Annotations flattened client-side; AcroForm fields can remain fillable |
| Password protect | QPDF compiled to WASM — encryption runs locally in the browser |
| Telemetry / analytics | None built into the product as shipped (verify you did not add any) |
| Crash reports | None built-in |

**Still true:** the **browser** and **OS** may have their own sync, enterprise DLP agents, or print drivers. Treat workstation policy as the outer control.

---

## Network

| Path | Expected traffic |
|------|------------------|
| After full offline install | None required for normal edit/save |
| Slim first-time setup | HTTPS to mirrors listed in `vendors.manifest.json` (npm/unpkg/cdnjs/jsDelivr) |
| SVC mode | Loopback HTTP only (`127.0.0.1:port`) |
| Intranet host mode | Users load assets from **your** origin only |

---

## Privilege model

- SVC and start-on-boot use **per-user**, non-elevated mechanisms.
- No service account, no admin install required for default layout.
- EXE is a small embedded HTTP server (mongoose-based launcher tree under `tools/GA-PDF-Launcher/`). Treat like any unsigned/internally signed binary: code-sign if your standard requires it.

---

## Threat notes (honest)

| Topic | Note |
|-------|------|
| XSS / malicious PDF | PDF.js and HTML overlays reduce but do not eliminate browser risks; keep browser patched |
| “Redact” line tool | Visual redaction bar — **not** certified secure redaction; use approved tools for sensitive sanitization |
| Password export | Protects the file at rest; key strength depends on user password and qpdf defaults |
| Supply chain | Vendors pinned in manifest; prefer full offline package for locked environments |
| Multi-tenant SaaS | **Not** a multi-tenant hosted product |

---

## Recommended controls

- [ ] Prefer full offline package on highly restricted networks
- [ ] Allowlist `GA-PDF-Editor-SVC.exe` path if AV blocks WASM/EXE
- [ ] Document that loopback port is intentional; block LAN bind if you fork the server
- [ ] Store user projects on managed drives with existing DLP/backup
- [ ] For regulated data, pair with existing classification / retention policy
- [ ] Review before enabling session restore of PDF bytes on shared kiosks (`config.js` flags)

---

## Config flags that affect privacy (examples)

See `app/config.js` and `dev/GUIDE-multi-doc-pwa.md`:

| Flag | Risk-relevant effect |
|------|----------------------|
| `enableSessionRestore` | May persist tab state across restarts |
| `persistPdfBytesInSession` | May store PDF bytes in IndexedDB |
| `maxSessionPdfBytes` | Caps cached size |
| `disableOCR` | Removes local OCR path if undesired |

---

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Security | | | [ ] Accept [ ] Accept with conditions [ ] Reject |
| IT owner | | | |
| Business owner | | | |

**Conditions / residual risk:**
