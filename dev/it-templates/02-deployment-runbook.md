# GA PDF Editor — Deployment runbook

**Version covered:** [e.g. 1.5.4]  
**Last updated:** [YYYY-MM-DD]  
**Maintainer:** [IT owner]

---

## Package types

| Type | Contents | When |
|------|----------|------|
| **Slim** | App + SVC + setup scripts; vendors downloaded once | Normal intranet / first install with network |
| **Full** | Slim + vendored `app/lib` + fonts | Offline / locked-down networks |

Build (maintainers only):

```powershell
cd tools\package
.\package.ps1                  # slim zip → dist\
.\package.ps1 -IncludeFullLibs # full zip
```

---

## Path A — Desktop / SVC (recommended default)

### Install

1. Unzip to a fixed path, e.g. `C:\Apps\GA-PDF-Editor\` (or user profile path).
2. If slim: double-click **`Setup.bat`** (or `tools\setup.ps1`).
3. Confirm **`GA-PDF-Editor-SVC.exe`** is running (listens on `127.0.0.1:17880` by default).
4. Open **`Open GA PDF Editor.url`** once.
5. Optional: browser **Install app** (PWA) for a pinned window.

### Port / instance

| Setting | How |
|---------|-----|
| Default port | `17880` |
| Override | `GA-PDF-Editor-SVC.exe --port N` or env `GAPDF_SVC_PORT` |
| Single instance | Mutex — second launch exits quietly |
| Sticky port | Reuses port from existing `.url` (PWA-safe) |

### Start at logon (optional, no admin)

During setup or via:

```powershell
.\tools\setup.ps1 -EnableStartup
# or -StartupMethod Registry|StartupFolder
# disable: -DisableStartup
```

### Update

1. Stop SVC if running (exit tray/process as your policy allows).
2. Replace package files (keep user projects elsewhere — they are not inside `app\`).
3. Ensure `app\config.js` `version` string changed so browsers re-fetch scripts.
4. Start SVC; smoke-test open PDF → edit → save project + PDF.

### Rollback

1. Stop SVC.
2. Restore previous unzip folder from **[backup path]**.
3. Start SVC; open `.url`.

---

## Path B — Intranet HTTPS

1. Publish contents of `app/` to `https://[internal-host]/[path]/`.
2. Ensure MIME types for `.wasm`, `.woff2`, worker JS are correct.
3. Service worker / PWA: install only over HTTPS (or localhost).
4. OCR + password paths: prefer HTTP(S) with real files under `lib/`; `file://` needs embed bundles (setup generates them).

---

## Path C — USB / share

1. Prefer **full** package.
2. Users run SVC from the extracted folder (writable location; avoid execute-from-zip).
3. Document that antivirus may quarantine WASM / EXE on first run — allowlist process if approved.

---

## Smoke test (every deploy)

- [ ] Open a multi-page PDF
- [ ] Add text + rectangle + circle; undo/redo
- [ ] Save **Project** (`.gapdf`) and reopen
- [ ] Save **PDF** (annotations flattened)
- [ ] Optional: Form workspace — add a text field, export fillable PDF, reopen and fill
- [ ] Optional: OCR on a scanned page (active tab only)
- [ ] Optional: password protect on export

---

## Uninstall

1. Disable start-on-boot if enabled.
2. Stop/kill `GA-PDF-Editor-SVC.exe`.
3. Delete install folder.
4. Clear browser site data for `http://127.0.0.1:17880` (or your host) if PWA was installed.
5. Optional: clear app IndexedDB session keys if policy requires (browser site data).

---

## Inventory fields (example)

| Field | Example |
|-------|---------|
| Product | GA PDF Editor |
| Vendor | Give Academy LLC (internal) |
| Version | 1.5.4 |
| Path | `C:\Apps\GA-PDF-Editor\` |
| Port | 17880 |
| Owner | [team] |
