# Guide: Config, tabs, single-instance open, session restore

For the GA PDF Editor personal branch (localhost C-server + PWA).

---

## 1. Centralized configuration & cache-busting

### Files

- `app/config.js` — must load first  
- `app/index.html` — lightweight sequential loader  

### How it works

1. Browser loads `config.js` (sync) → `window.GA_CONFIG`  
2. Loader appends `?v={GA_CONFIG.version}` to CSS and every script URL  
3. Scripts load **in order** after `DOMContentLoaded`  
4. When the chain finishes → `GaWorkspace.bootstrap()`  

### Toggle tabbed mode

```js
// app/config.js
enableTabbedMode: true,   // multi-doc tabs
// enableTabbedMode: false, // classic single canvas
```

Also useful:

| Key | Effect |
|-----|--------|
| `enableFormMode` | Editor/Form switcher |
| `disableOCR` | Hides Scan OCR |
| `enableSessionRestore` | IndexedDB session |
| `enableLaunchQueue` | OS file → this window |
| `defaultZoom` | New-tab zoom (e.g. `1.5`) |
| `version` | Cache-bust token |

After any JS/CSS edit in production-ish installs, **bump `version`**.

---

## 2. Internal tabbed UI

### Layout

```
#docTabBar          (fixed, 32px, only if enableTabbedMode)
#headerBar          (fixed, 40px; top: 32px when tabs on)
#workspaceRoot
  .doc-viewer × N   (one per open document; inactive = hidden, not destroyed)
```

### State isolation

On tab switch, workspace:

1. Stashes active zoom, scroll, history stacks, tool mode into the doc bag  
2. Points `APP.DOM.viewer` at the target pane  
3. Restores that bag + thumbnails + history UI  

Canvases and overlays stay in the inactive pane’s DOM.

### User actions

- Click tab → activate  
- × or middle-click → close (dirty confirm)  
- `+` → empty tab  
- Drop / Open when pages exist → **Append** or **Open as New Tab**  

---

## 3. Single-instance file handling

### `manifest.json`

```json
"launch_handler": { "client_mode": "focus-existing" },
"file_handlers": [{
  "action": "./",
  "accept": {
    "application/pdf": [".pdf"],
    "application/octet-stream": [".gapdf"]
  }
}]
```

### Runtime

`GaWorkspace` registers:

```js
launchQueue.setConsumer(async (params) => {
  // params.files → FileSystemFileHandle[]
  // open each as a tab (or replace if !enableTabbedMode)
});
```

### Requirements

- Served over **http(s)** (your C-server on localhost is fine)  
- App **installed** as PWA (or browser support for File Handling)  
- Chromium-based browser for full File Handling + launchQueue  

---

## 4. Session restoration (IndexedDB)

### What is stored

```js
{
  v: 1,
  activeId: "doc-…",
  tabs: [{
    id, title, pdfName, zoom,
    fileHandle,   // structured-cloneable when present
    hasContent
  }]
}
```

DB name / key: `sessionDbName` / `sessionStoreKey` in config.

### Permissions

Browsers require `queryPermission` / `requestPermission({ mode: "read" })` before `handle.getFile()` after reload.

- Quiet attempt on bootstrap  
- If handles exist but none restored → bottom **Restore** bar (user gesture)  

### What does **not** restore

Files chosen only via `<input type="file">` usually have **no** `FileSystemFileHandle`, so they cannot be re-opened from disk automatically. Prefer OS “Open with” / launchQueue for restorable tabs.

---

## 5. Service worker (keep simple)

`app/sw.js`:

- Install / activate only  
- Fetch = network pass-through  
- Clears any old caches on activate  

Do **not** add cache-first strategies for this localhost workflow.

---

## 6. Quick verification

```text
1. Serve app/ via the C launcher (http://127.0.0.1:…)
2. Open PDF A, annotate, open PDF B as new tab
3. Switch A ↔ B — annotations still there
4. Set enableTabbedMode: false, hard-refresh (new ?v=) — single canvas
5. Install PWA, open second PDF from Explorer — same window, new tab
6. Reload — Restore bar if needed → tabs return
```

---

## 7. Module load order (reference)

```
config.js
→ fonts.css, style.css, manifest
→ pdf.js libs
→ state, idb, project-audit, history, io
→ ui/*
→ engine/*
→ overlays/*
→ interaction/*
→ features/*
→ workspace.js   ← bootstrap
→ host-bridge.js
```
