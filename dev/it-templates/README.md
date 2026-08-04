# IT adoption templates (light set)

Optional starter docs for an internal IT / desktop team that wants to **evaluate, pilot, or support** GA PDF Editor.

These are **templates**, not policy. Copy into your own wiki / ServiceNow / Confluence, replace bracketed fields, and attach to your change process.

| Template | When to use |
|----------|-------------|
| [01-adoption-checklist.md](01-adoption-checklist.md) | Decide if/how to roll out |
| [02-deployment-runbook.md](02-deployment-runbook.md) | Install / update / rollback steps |
| [03-security-privacy-brief.md](03-security-privacy-brief.md) | Security review / data handling Q&A |
| [04-support-runbook.md](04-support-runbook.md) | Tier-1/2 support playbook |
| [05-change-request.md](05-change-request.md) | CAB / change ticket body |

**Related in-repo docs (not templates):**

- Root `README.md`, `VERSION`, `SETUP-FIRST.txt`
- `tools/SETUP.md` (or zip `tools\SETUP.md`) — offline setup
- `dev/GUIDE-multi-doc-pwa.md` — tabs / PWA / config flags
- `dev/CASE-STUDY.html` — technical narrative

**Product facts (fill dates/owners as you adopt):**

- Offline-first static web app + optional localhost SVC (`GA-PDF-Editor-SVC.exe`)
- Document bytes stay on the client; no app-side upload to a vendor cloud
- Stack: HTML/CSS/vanilla JS, PDF.js, pdf-lib, QPDF WASM, Tesseract.js, html2canvas
