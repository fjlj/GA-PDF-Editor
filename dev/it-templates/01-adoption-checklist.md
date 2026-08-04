# GA PDF Editor — Adoption checklist

**Owner:** [Team / person]  
**Date:** [YYYY-MM-DD]  
**Target environment:** [Lab | Pilot | Production]  
**Package version:** [e.g. 1.5.4]

Use this to decide whether the app fits your org and what must be true before users get it.

---

## 1. Fit

- [ ] Use case is clear (annotate PDFs, fill/design AcroForms, local OCR, offline project files)
- [ ] Users understand **final PDF** flattens annotations; **`.gapdf` project** keeps layers editable
- [ ] Not a substitute for enterprise DMS / e-sign platform if you already standardize on one
- [ ] Browser baseline agreed ([Chrome | Edge | Firefox] + min version)

## 2. Deployment model (pick one)

- [ ] **A. Local SVC + optional PWA** — unzip, `Setup.bat` if slim, open `Open GA PDF Editor.url`
- [ ] **B. Intranet HTTPS** — host `app/` on internal web server
- [ ] **C. USB / share drop** — full or slim zip for air-gapped / field staff

Record choice: **[ A / B / C ]**  
Install path / URL: **[ … ]**

## 3. Network & install

- [ ] Slim package: one-time setup may need outbound HTTPS to fetch vendors (see `vendors.manifest.json`) **or** ship **full** offline zip
- [ ] SVC binds `127.0.0.1` high port only (default **17880**) — no admin rights required
- [ ] Port conflicts process known (do not silently rebind if PWA is installed)
- [ ] Start-on-boot (user Startup / HKCU Run) approved if requested

## 4. Security & compliance gate

- [ ] Security brief reviewed (`03-security-privacy-brief.md`)
- [ ] Data classification: PDFs may contain **[PII / PHI / CUI / none]** — handling rules attached
- [ ] Password-protect export (QPDF WASM) understood as **client-side**, not a full DRM solution
- [ ] “No document upload by the app” accepted (browser still talks only to localhost / your host)

## 5. Support readiness

- [ ] Support runbook published (`04-support-runbook.md`)
- [ ] Known limitations communicated (browser print quirks, OCR language pack = eng by default, etc.)
- [ ] Escalation path: **[L2 owner / mailbox]**

## 6. Pilot

| Item | Value |
|------|--------|
| Pilot group | [names / OU] |
| Start / end | [dates] |
| Success criteria | [e.g. open/edit/save project + export PDF without data leaving device] |
| Exit criteria | [go / no-go] |

- [ ] Pilot feedback captured
- [ ] Go / no-go signed by **[name]** on **[date]**

## 7. Production

- [ ] Change request filed (`05-change-request.md`)
- [ ] Version pinned in inventory / software catalog
- [ ] Update process documented (replace folder + bump users’ cache via `config.js` version)
- [ ] Rollback package stored **[path]**

---

**Decision:** [ ] Adopt  [ ] Pilot only  [ ] Decline  
**Notes:**
