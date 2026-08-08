# Changelog — tabs, restore, load busy (1.5.5 → 1.5.11)

**Product:** `1.5.11`  
**Cache-bust:** `app/config.js` → `1.5.11-tab-close-focus`  
**Date:** 2026-08-07  

A pile of "why is my tab blank / why did I save half a PDF" fixes. Packaging/SVC untouched.

---

## TL;DR (if you're skimming)

- Multi-file combine: dim + block save until done (no half-sandwich exports).
- Big single PDF: pages stream in, soft toast, save/print wait — no disco dim.
- Session restore: freeze-before-open, soft toast, no blank ghost tabs.
- Spare empty shell = secret canvas, not a fake tab.
- Close active tab → focus right, else left (not "Map.first = blank").
- Multi-drop actually gets all the files (Chromium DataTransferItem gotcha).

---

## 1.5.11 — Tab close focus
Right neighbor first, else left. Old code grabbed Map.first → often a hidden spare → blank until click.

## 1.5.10 — Spare shell hidden
Internal empty pane for the DOM. Not a tab while real docs exist. `+` still makes a real Untitled.

## 1.5.9 — Empty shell cleanup
Hard-refresh was leaving a blank tab buddy. Spares + don't persist empties.

## 1.5.8 — Restore soft status
Restore bar uses toast + gate, not full-screen dim.

## 1.5.7 — Soft doc gate
Multi-page open: watch pages roll in; save/print gated; 30min panic timeout; `forceClearAppBusy()`.

## 1.5.6–1.5.5 — Load / restore / multi-drop
Startup open vs restore race fixed; restore de-dupe; Chromium multi-drop fix; multi-file dim+busy.
