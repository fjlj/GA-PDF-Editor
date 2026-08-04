/**
 * workspace.js — multi-document workspace + session restore + launchQueue.
 *
 * When GA_CONFIG.enableTabbedMode is false, behaves as a single hidden document
 * (classic one-canvas editor). When true, keeps each document's DOM viewer
 * mounted (hidden when inactive) so canvas/overlays/state survive tab switches.
 */
(function (global) {
    "use strict";

    const cfg = (k, d) => (global.gaConfig ? global.gaConfig(k, d) : d);

    /** @type {Map<string, DocRecord>} */
    const docs = new Map();
    let activeId = null;
    let seq = 0;
    let bootstrapped = false;
    let persistTimer = null;

    /**
     * @typedef {Object} DocRecord
     * @property {string} id
     * @property {string} title
     * @property {HTMLElement} viewer
     * @property {number} zoom
     * @property {number} scrollTop
     * @property {string} pdfName
     * @property {FileSystemFileHandle|null} fileHandle
     * @property {any[]} undoStack
     * @property {any[]} redoStack
     * @property {number} savePoint
     * @property {string} workspaceMode
     * @property {string} currentMode
     * @property {boolean} isPixelated
     * @property {object|null} sourcePdfBuffers snapshot ref (shared map ok)
     * @property {boolean} dirty
     */

    function tabbed() {
        return !!cfg("enableTabbedMode", true);
    }

    function sessionOn() {
        return !!cfg("enableSessionRestore", true);
    }

    function maxTabs() {
        return Math.max(1, Number(cfg("maxTabs", 16)) || 16);
    }

    function defaultZoom() {
        const z = Number(cfg("defaultZoom", 1.0));
        return Number.isFinite(z) && z > 0 ? z : 1.0;
    }

    function workspaceRoot() {
        return document.getElementById("workspaceRoot") || document.body;
    }

    function tabBarEl() {
        return document.getElementById("docTabBar");
    }

    function uid() {
        seq += 1;
        return `doc-${Date.now().toString(36)}-${seq}`;
    }

    function pageCountIn(viewer) {
        if (!viewer) return 0;
        return viewer.querySelectorAll(".pageWrapper").length;
    }

    function activeDoc() {
        return activeId ? docs.get(activeId) || null : null;
    }

    /**
     * Capture live globals into the active document bag (call before switch/close).
     */
    function stashActive() {
        const doc = activeDoc();
        if (!doc) return;
        if (global.APP && global.APP.DOM && global.APP.DOM.viewer === doc.viewer) {
            doc.scrollTop = doc.viewer.scrollTop || 0;
        } else if (doc.viewer) {
            doc.scrollTop = doc.viewer.scrollTop || 0;
        }
        doc.zoom = global.currentZoom || doc.zoom || defaultZoom();

        // Prefer a real live filename; never let leftover "Untitled" / "document.pdf"
        // from an empty shell overwrite a title set via setActiveTitle.
        const live = global.currentPdfName;
        if (live && !isPlaceholderName(live)) {
            doc.pdfName = live;
        } else if (!doc.pdfName || isPlaceholderName(doc.pdfName)) {
            doc.pdfName = live || doc.pdfName || doc.title || "document.pdf";
        }
        // If bag already has a real name, keep it (and re-sync the global)
        if (doc.pdfName && !isPlaceholderName(doc.pdfName)) {
            global.currentPdfName = doc.pdfName;
        }
        doc.title = stripName(doc.pdfName || doc.title);

        if (global.historyEngine) {
            doc.undoStack = global.historyEngine.undoStack || [];
            doc.redoStack = global.historyEngine.redoStack || [];
            doc.savePoint = global.historyEngine.savePoint || 0;
        }
        if (global.APP) {
            doc.workspaceMode = global.APP.workspaceMode || "editor";
            doc.currentMode = global.APP.currentMode || "select";
            doc.isPixelated = !!global.APP.isPixelated;
        }
        doc.dirty = isDocDirty(doc);
    }

    function isDocDirty(doc) {
        const undoLen = (doc.undoStack && doc.undoStack.length) || 0;
        const sp = doc.savePoint || 0;
        // When active, prefer live stacks
        if (doc.id === activeId && global.historyEngine) {
            return (global.historyEngine.undoStack.length || 0) !== (global.historyEngine.savePoint || 0);
        }
        return undoLen !== sp;
    }

    function stripName(name) {
        const n = String(name || "Untitled").trim();
        return n || "Untitled";
    }

    /** Placeholder tab/file names that must not clobber a real open document name */
    function isPlaceholderName(name) {
        const s = String(name || "").trim().toLowerCase();
        return !s
            || s === "untitled"
            || s === "document"
            || s === "document.pdf"
            || s === "document.gapdf";
    }

    /**
     * Point APP.DOM.viewer + globals at a document and show its pane.
     */
    function applyDoc(doc) {
        if (!doc) return;

        // Hide all viewers; show this one
        docs.forEach((d) => {
            if (!d.viewer) return;
            d.viewer.classList.toggle("is-active-doc", d.id === doc.id);
            d.viewer.hidden = d.id !== doc.id;
            d.viewer.setAttribute("aria-hidden", d.id === doc.id ? "false" : "true");
        });

        if (global.APP && global.APP.DOM) {
            global.APP.DOM.viewer = doc.viewer;
        }

        global.currentZoom = doc.zoom || defaultZoom();
        global.currentPdfName = doc.pdfName || doc.title || "document.pdf";

        if (global.historyEngine) {
            global.historyEngine.undoStack = doc.undoStack || [];
            global.historyEngine.redoStack = doc.redoStack || [];
            global.historyEngine.savePoint = doc.savePoint || 0;
            global.historyEngine.actionQueue = [];
            global.historyEngine.isProcessing = false;
        }

        if (global.APP) {
            global.APP.workspaceMode = doc.workspaceMode || "editor";
            global.APP.currentMode = doc.currentMode || "select";
            global.APP.isPixelated = !!doc.isPixelated;
            global.APP.activeOverlay = null;
            if (global.APP.multiSelectedItems) global.APP.multiSelectedItems.clear();
        }

        // Zoom UI + page transforms for THIS viewer only
        if (typeof global.setZoom === "function") {
            global.setZoom(global.currentZoom);
        } else {
            const zl = document.getElementById("zoomLabel");
            if (zl) zl.innerText = Math.round(global.currentZoom * 100) + "%";
            document.documentElement.style.setProperty("--ui-inverse-scale", 1 / global.currentZoom);
        }

        // Restore scroll after layout
        requestAnimationFrame(() => {
            if (doc.viewer) doc.viewer.scrollTop = doc.scrollTop || 0;
        });

        if (typeof global.updateHistoryUI === "function") global.updateHistoryUI();
        if (typeof global.syncPageThumbnails === "function") global.syncPageThumbnails();
        if (typeof global.applyWorkspaceMode === "function") {
            global.applyWorkspaceMode({ preferredTool: doc.currentMode || "select" });
        }
        // Always re-sync pointer-tool body classes so native forms stay clickable
        if (typeof global.syncToolBodyClass === "function") {
            global.syncToolBodyClass();
        } else if (global.APP) {
            const m = global.APP.currentMode || "select";
            document.body.classList.toggle("tool-select", m === "select");
            document.body.classList.toggle("tool-nonselect", m !== "select");
        }
        if (typeof global.clearActiveOverlay === "function") {
            try { global.clearActiveOverlay(true); } catch (_) { /* ignore */ }
        }

        activeId = doc.id;
        renderTabBar();
        updateDocumentTitle();
        schedulePersist();

        // After restore/switch: repair missing form shells (project re-apply or native import)
        if (typeof global.scheduleEnsureFormsReady === "function") {
            global.scheduleEnsureFormsReady(doc.viewer, {
                schema: doc.viewer && doc.viewer._gaProjectSchema
            });
        } else if (typeof global.ensureNativeFormImportForViewer === "function") {
            Promise.resolve(global.ensureNativeFormImportForViewer(doc.viewer)).catch((e) => {
                console.warn("[workspace] ensureNativeFormImportForViewer", e);
            });
        }
    }

    /** Numeric version only (e.g. 1.4.3) — strip cache-bust slug after the last digits. */
    function displayVersion() {
        const ver = String(cfg("version", "") || "");
        const m = ver.match(/^(\d+(?:\.\d+)*)/);
        return m ? m[1] : ver;
    }

    function appTitleWithVersion() {
        const base = cfg("appTitle", "GA PDF Editor");
        const ver = displayVersion();
        return ver ? `${base} ${ver}` : base;
    }

    function updateDocumentTitle() {
        const doc = activeDoc();
        const base = appTitleWithVersion();
        document.title = doc && doc.title && doc.title !== "Untitled"
            ? `${doc.title} — ${base}`
            : base;
    }

    /**
     * Create a new document pane (empty). Does not activate unless activate=true.
     * @param {{ title?: string, fileHandle?: FileSystemFileHandle|null, activate?: boolean }} [opts]
     */
    function createDocument(opts = {}) {
        const id = uid();
        const viewer = document.createElement("div");
        viewer.className = "doc-viewer";
        viewer.id = docs.size === 0 && !document.getElementById("viewer") ? "viewer" : `viewer-${id}`;
        viewer.dataset.docId = id;
        viewer.hidden = true;
        viewer.setAttribute("role", "tabpanel");
        workspaceRoot().appendChild(viewer);

        /** @type {DocRecord} */
        const doc = {
            id,
            title: stripName(opts.title || "Untitled"),
            viewer,
            zoom: defaultZoom(),
            scrollTop: 0,
            pdfName: opts.title || "document.pdf",
            fileHandle: opts.fileHandle || null,
            undoStack: [],
            redoStack: [],
            savePoint: 0,
            workspaceMode: "editor",
            currentMode: "select",
            isPixelated: false,
            sourcePdfBuffers: null,
            dirty: false
        };
        docs.set(id, doc);

        // Enforce max tabs (tabbed only)
        if (tabbed() && docs.size > maxTabs()) {
            const oldest = docs.keys().next().value;
            if (oldest && oldest !== id) {
                console.warn("[workspace] maxTabs exceeded; closing oldest tab", oldest);
                closeDocument(oldest, { force: true, skipConfirm: true });
            }
        }

        if (opts.activate !== false) {
            stashActive();
            applyDoc(doc);
        } else {
            renderTabBar();
            schedulePersist();
        }
        return doc;
    }

    /**
     * Ensure at least one document exists and is active (for single-canvas ops).
     */
    function ensureActiveDocument() {
        if (activeDoc()) return activeDoc();
        return createDocument({ title: "Untitled", activate: true });
    }

    function activateDocument(id) {
        if (!id || !docs.has(id)) return;
        if (id === activeId) return;
        stashActive();
        applyDoc(docs.get(id));
    }

    async function closeDocument(id, opts = {}) {
        const doc = docs.get(id);
        if (!doc) return false;

        if (!opts.skipConfirm) {
            const dirty = id === activeId
                ? (global.historyEngine &&
                    (global.historyEngine.undoStack.length || 0) !== (global.historyEngine.savePoint || 0))
                : isDocDirty(doc);
            if (dirty && typeof global.customConfirm === "function") {
                const ok = await global.customConfirm(
                    `Close "${doc.title}"? Unsaved changes will be lost.`,
                    "⚠️ Close tab"
                );
                if (!ok) return false;
            }
        }

        const wasActive = id === activeId;
        if (wasActive) stashActive();

        // Drop page DOM + buffers tied only to this viewer
        if (doc.viewer && doc.viewer.parentNode) {
            doc.viewer.parentNode.removeChild(doc.viewer);
        }
        forgetDocBytes(id);
        docs.delete(id);

        if (wasActive) {
            activeId = null;
            const next = docs.keys().next().value;
            if (next) {
                applyDoc(docs.get(next));
            } else if (!opts.forceEmpty) {
                // Keep one empty shell so APP.DOM.viewer stays valid
                createDocument({ title: "Untitled", activate: true });
            } else if (global.APP && global.APP.DOM) {
                global.APP.DOM.viewer = null;
            }
        } else {
            renderTabBar();
            schedulePersist();
        }
        return true;
    }

    /** Close the active document (File → Close). */
    async function closeActiveDocument(opts = {}) {
        const doc = activeDoc();
        if (!doc) return false;
        // Empty untitled shell — nothing meaningful to close
        if (!opts.force && pageCountIn(doc.viewer) === 0
            && (!doc.title || doc.title === "Untitled")
            && docs.size <= 1) {
            if (typeof global.customAlert === "function") {
                await global.customAlert("No document to close.", "📄 File");
            }
            return false;
        }
        return closeDocument(doc.id, opts);
    }

    /**
     * Close every open document (File → Close all).
     * Confirms once if any tab is dirty.
     */
    async function closeAllDocuments(opts = {}) {
        if (docs.size === 0) return true;

        if (!opts.skipConfirm) {
            // Stash so dirty check for active is current
            try { stashActive(); } catch (_) { /* ignore */ }
            let anyDirty = false;
            docs.forEach((doc) => {
                if (isDocDirty(doc)) anyDirty = true;
                if (doc.id === activeId && global.historyEngine
                    && (global.historyEngine.undoStack.length || 0) !== (global.historyEngine.savePoint || 0)) {
                    anyDirty = true;
                }
            });
            if (anyDirty && typeof global.customConfirm === "function") {
                const ok = await global.customConfirm(
                    `Close all ${docs.size} document(s)? Unsaved changes will be lost.`,
                    "⚠️ Close all"
                );
                if (!ok) return false;
            } else if (docs.size > 1 && typeof global.customConfirm === "function") {
                const ok = await global.customConfirm(
                    `Close all ${docs.size} document(s)?`,
                    "📄 Close all"
                );
                if (!ok) return false;
            }
        }

        const ids = Array.from(docs.keys());
        for (const id of ids) {
            await closeDocument(id, { skipConfirm: true, forceEmpty: true });
        }
        // Leave one empty shell
        if (docs.size === 0) {
            createDocument({ title: "Untitled", activate: true });
        }
        updateDocumentTitle();
        renderTabBar();
        schedulePersist();
        return true;
    }

    function setActiveTitle(name, fileHandle) {
        const doc = activeDoc() || ensureActiveDocument();
        if (name) {
            doc.pdfName = name;
            doc.title = stripName(name);
            // Keep global in sync so stashActive / export never reverts to Untitled
            global.currentPdfName = name;
        }
        if (fileHandle) doc.fileHandle = fileHandle;
        updateDocumentTitle();
        renderTabBar();
        schedulePersist();
    }

    function setActiveFileHandle(handle) {
        const doc = activeDoc();
        if (!doc) return;
        doc.fileHandle = handle || null;
        schedulePersist();
    }

    function renderTabBar() {
        const bar = tabBarEl();
        if (!bar) return;

        if (!tabbed()) {
            bar.hidden = true;
            bar.innerHTML = "";
            document.body.classList.remove("has-doc-tabs");
            return;
        }

        document.body.classList.add("has-doc-tabs");
        bar.hidden = false;
        bar.innerHTML = "";
        bar.setAttribute("role", "tablist");
        bar.setAttribute("aria-label", "Open documents");

        docs.forEach((doc) => {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "doc-tab" + (doc.id === activeId ? " is-active" : "");
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", doc.id === activeId ? "true" : "false");
            tab.dataset.docId = doc.id;
            tab.title = doc.title;

            const label = document.createElement("span");
            label.className = "doc-tab-label";
            const dirty = isDocDirty(doc) || (doc.id === activeId && global.historyEngine &&
                (global.historyEngine.undoStack.length || 0) !== (global.historyEngine.savePoint || 0));
            label.textContent = (dirty ? "• " : "") + doc.title;
            tab.appendChild(label);

            const close = document.createElement("span");
            close.className = "doc-tab-close";
            close.setAttribute("aria-label", "Close " + doc.title);
            close.textContent = "×";
            close.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeDocument(doc.id);
            });
            tab.appendChild(close);

            tab.addEventListener("click", () => activateDocument(doc.id));
            tab.addEventListener("auxclick", (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    closeDocument(doc.id);
                }
            });
            bar.appendChild(tab);
        });

        // New tab button
        const add = document.createElement("button");
        add.type = "button";
        add.className = "doc-tab-add";
        add.title = "New empty tab";
        add.setAttribute("aria-label", "New tab");
        add.textContent = "+";
        add.addEventListener("click", () => {
            createDocument({ title: "Untitled", activate: true });
        });
        bar.appendChild(add);
    }

    // --- Session persistence ---

    function schedulePersist() {
        if (!sessionOn() || !global.GaIdb) return;
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistTimer = null;
            persistSession().catch((e) => console.warn("[workspace] persist failed", e));
        }, 200);
    }

    function blobKeyFor(docId) {
        return "pdf-blob:" + docId;
    }

    /**
     * Cache PDF bytes for the active document so refresh/reopen can restore
     * even without a FileSystemFileHandle (File menu / plain input).
     * @param {ArrayBuffer|Uint8Array} bytes
     * @param {DocRecord} [doc]
     */
    async function rememberDocBytes(bytes, doc) {
        if (!sessionOn() || !cfg("persistPdfBytesInSession", true) || !global.GaIdb) return;
        const d = doc || activeDoc();
        if (!d || !bytes) return;
        const max = Number(cfg("maxSessionPdfBytes", 80 * 1024 * 1024)) || (80 * 1024 * 1024);
        const ab = bytes instanceof ArrayBuffer
            ? bytes
            : (bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : null);
        if (!ab || ab.byteLength === 0) return;
        if (ab.byteLength > max) {
            console.info("[workspace] skip session byte cache (file too large)", ab.byteLength);
            return;
        }
        try {
            const store = global.GaIdb.sessionStore();
            const key = blobKeyFor(d.id);
            // Copy so later mutations to source buffers don't corrupt IDB write mid-flight
            await store.set(key, ab.slice(0));
            d.blobKey = key;
            schedulePersist();
        } catch (e) {
            console.warn("[workspace] rememberDocBytes failed", e);
        }
    }

    async function forgetDocBytes(docId) {
        if (!global.GaIdb || !docId) return;
        try {
            await global.GaIdb.sessionStore().del(blobKeyFor(docId));
        } catch (_) { /* ignore */ }
    }

    async function persistSession() {
        if (!sessionOn() || !global.GaIdb) return;
        stashActive();
        const store = global.GaIdb.sessionStore();
        const key = cfg("sessionStoreKey", "workspace-v1");
        const payload = {
            v: 2,
            activeId,
            tabs: Array.from(docs.values()).map((d) => ({
                id: d.id,
                title: d.title,
                pdfName: d.pdfName,
                zoom: d.zoom,
                // FileSystemFileHandle is structured-cloneable into IDB (when present)
                fileHandle: d.fileHandle || null,
                // PDF bytes cached separately under blobKey (see rememberDocBytes)
                blobKey: d.blobKey || (pageCountIn(d.viewer) > 0 ? blobKeyFor(d.id) : null),
                hasContent: pageCountIn(d.viewer) > 0
            }))
        };
        await store.set(key, payload);
    }

    async function maybeOfferSessionRestore() {
        if (!sessionOn() || !tabbed() || !global.GaIdb) return;
        let payload;
        try {
            payload = await global.GaIdb.sessionStore().get(cfg("sessionStoreKey", "workspace-v1"));
        } catch (_) {
            return;
        }
        if (!payload || !Array.isArray(payload.tabs)) return;
        const n = payload.tabs.filter((t) => t && (t.fileHandle || t.blobKey || t.hasContent)).length;
        if (n === 0) return;
        if (document.getElementById("ga-session-restore-bar")) return;

        const bar = document.createElement("div");
        bar.id = "ga-session-restore-bar";
        bar.style.cssText = [
            "position:fixed", "bottom:16px", "left:50%", "transform:translateX(-50%)",
            "z-index:100001", "display:flex", "align-items:center", "gap:12px",
            "padding:10px 16px", "border-radius:8px",
            "background:rgba(20,20,20,0.95)", "color:#eee",
            "box-shadow:0 8px 24px rgba(0,0,0,0.45)", "font:13px/1.3 system-ui,sans-serif",
            "border:1px solid rgba(0,170,255,0.45)"
        ].join(";");
        bar.innerHTML = `<span>Restore ${n} previous document tab(s)?</span>`;
        const yes = document.createElement("button");
        yes.textContent = "Restore";
        yes.style.cssText = "background:#0af;color:#111;border:none;border-radius:4px;padding:6px 12px;font-weight:700;cursor:pointer;";
        const no = document.createElement("button");
        no.textContent = "Dismiss";
        no.style.cssText = "background:transparent;color:#ccc;border:1px solid #555;border-radius:4px;padding:6px 12px;cursor:pointer;";
        yes.addEventListener("click", async () => {
            bar.remove();
            await restoreSession({ forcePrompt: true });
        });
        no.addEventListener("click", () => bar.remove());
        bar.appendChild(yes);
        bar.appendChild(no);
        document.body.appendChild(bar);
    }

    /**
     * Restore tabs that still have a FileSystemFileHandle (+ re-request permission).
     * @param {{ forcePrompt?: boolean }} [opts]
     */
    async function restoreSession(opts = {}) {
        if (!sessionOn() || !tabbed() || !global.GaIdb) return false;
        if (!global.isSecureContext) {
            console.info("[workspace] session restore skipped (insecure context)");
            return false;
        }

        let payload;
        try {
            const store = global.GaIdb.sessionStore();
            payload = await store.get(cfg("sessionStoreKey", "workspace-v1"));
        } catch (e) {
            console.warn("[workspace] session read failed", e);
            return false;
        }
        if (!payload || !Array.isArray(payload.tabs) || payload.tabs.length === 0) return false;

        // Restorable = has handle and/or cached PDF bytes
        const restorable = payload.tabs.filter(
            (t) => t && (t.fileHandle || t.blobKey || t.hasContent)
        );
        if (restorable.length === 0) return false;

        const store = global.GaIdb.sessionStore();
        let restored = 0;
        let needsGesture = false;

        for (const t of restorable) {
            try {
                let arrayBuffer = null;
                let handle = t.fileHandle || null;
                let title = t.title || t.pdfName || "document.pdf";

                // 1) Prefer live file handle (fresh bytes from disk)
                if (handle && typeof handle.getFile === "function") {
                    let perm = "granted";
                    if (handle.queryPermission) {
                        perm = await handle.queryPermission({ mode: "read" });
                    }
                    if (perm !== "granted") {
                        if (opts.forcePrompt && handle.requestPermission) {
                            perm = await handle.requestPermission({ mode: "read" });
                        } else if (!opts.forcePrompt && handle.requestPermission) {
                            try {
                                perm = await handle.requestPermission({ mode: "read" });
                            } catch (_) {
                                perm = "denied";
                            }
                        }
                    }
                    if (perm === "granted") {
                        try {
                            const file = await handle.getFile();
                            arrayBuffer = await file.arrayBuffer();
                            title = file.name || title;
                        } catch (e) {
                            console.warn("[workspace] handle.getFile failed, trying blob cache", e);
                            handle = handle; // keep for re-prompt
                            arrayBuffer = null;
                        }
                    } else {
                        needsGesture = true;
                    }
                }

                // 2) Fallback: PDF bytes cached in IndexedDB
                const tryKeys = [t.blobKey, t.id ? blobKeyFor(t.id) : null].filter(Boolean);
                for (let ki = 0; !arrayBuffer && ki < tryKeys.length; ki++) {
                    try {
                        const cached = await store.get(tryKeys[ki]);
                        if (cached instanceof ArrayBuffer) arrayBuffer = cached;
                        else if (cached && cached.buffer) {
                            arrayBuffer = cached.buffer.slice(
                                cached.byteOffset || 0,
                                (cached.byteOffset || 0) + cached.byteLength
                            );
                        }
                    } catch (e) {
                        console.warn("[workspace] blob cache read failed", e);
                    }
                }

                if (!arrayBuffer) {
                    if (handle) needsGesture = true;
                    continue;
                }

                // Preserve original tab id when possible so blob keys stay stable
                const doc = createDocument({
                    title,
                    fileHandle: handle,
                    activate: false
                });
                // Re-key blob under new id if we created a fresh id
                if (t.blobKey && t.id && doc.id !== t.id) {
                    doc.blobKey = blobKeyFor(doc.id);
                    try {
                        await store.set(doc.blobKey, arrayBuffer.slice(0));
                    } catch (_) { /* ignore */ }
                } else {
                    doc.blobKey = t.blobKey || blobKeyFor(doc.id);
                }
                doc.zoom = Number(t.zoom) > 0 ? Number(t.zoom) : defaultZoom();
                doc.pdfName = t.pdfName || title;

                stashActive();
                applyDoc(doc);
                if (typeof global.renderPDF === "function") {
                    await global.renderPDF(arrayBuffer, false);
                }
                setActiveTitle(title, handle);
                await rememberDocBytes(arrayBuffer, doc);
                restored += 1;
            } catch (err) {
                console.warn("[workspace] failed to restore tab", t && t.title, err);
            }
        }

        // If nothing restored but handles need permission, surface the restore bar
        if (restored === 0 && needsGesture && !opts.forcePrompt) {
            return false;
        }

        if (restored > 0) {
            // Drop leftover empty shell tabs from bootstrap
            const empties = Array.from(docs.values()).filter(
                (d) => pageCountIn(d.viewer) === 0 && !d.fileHandle
            );
            for (const d of empties) {
                if (docs.size <= 1) break;
                await closeDocument(d.id, { force: true, skipConfirm: true });
            }
            if (payload.activeId && docs.has(payload.activeId)) {
                activateDocument(payload.activeId);
            }
        }

        return restored > 0;
    }

    /**
     * Open File / FileSystemFileHandle list as new tab(s) (or replace if !tabbed).
     * @param {Array<File|{file:File, handle?:FileSystemFileHandle}>} items
     * @param {{ replaceActive?: boolean }} [opts]
     */
    async function openFilesAsTabs(items, opts = {}) {
        const list = Array.from(items || []).filter(Boolean);
        if (list.length === 0) return;

        const normalized = list.map((item) => {
            if (item instanceof File) return { file: item, handle: null };
            if (item && item.file) return { file: item.file, handle: item.handle || null };
            return null;
        }).filter(Boolean);

        if (!tabbed() || opts.replaceActive) {
            ensureActiveDocument();
            const first = normalized[0];
            setActiveTitle(first.file.name, first.handle);
            if (typeof global.renderPDF === "function") {
                await global.renderPDF(await first.file.arrayBuffer(), false);
            }
            for (let i = 1; i < normalized.length; i++) {
                await global.renderPDF(await normalized[i].file.arrayBuffer(), true);
            }
            schedulePersist();
            return;
        }

        for (let i = 0; i < normalized.length; i++) {
            const { file, handle } = normalized[i];
            const emptyActive = activeDoc() && pageCountIn(activeDoc().viewer) === 0;
            if (i === 0 && emptyActive) {
                setActiveTitle(file.name, handle);
                await global.renderPDF(await file.arrayBuffer(), false);
            } else {
                createDocument({ title: file.name, fileHandle: handle, activate: true });
                setActiveTitle(file.name, handle);
                await global.renderPDF(await file.arrayBuffer(), false);
            }
        }
        schedulePersist();
    }

    /**
     * launchQueue / File Handling API consumer.
     */
    function initLaunchQueue() {
        if (!cfg("enableLaunchQueue", true)) return;
        if (!("launchQueue" in global) || !global.launchQueue || typeof global.launchQueue.setConsumer !== "function") {
            return;
        }

        global.launchQueue.setConsumer(async (launchParams) => {
            try {
                if (!launchParams || !launchParams.files || launchParams.files.length === 0) return;
                const items = [];
                for (const handle of launchParams.files) {
                    try {
                        // Handles may be FileSystemFileHandle
                        if (handle && typeof handle.getFile === "function") {
                            const file = await handle.getFile();
                            items.push({ file, handle });
                        }
                    } catch (e) {
                        console.warn("[workspace] launchQueue handle failed", e);
                    }
                }
                if (items.length === 0) return;

                const urlParams = new URLSearchParams(global.location.search);
                const isCombineMode = urlParams.get("mode") === "combine";
                if (isCombineMode && items.length > 1) {
                    ensureActiveDocument();
                    setActiveTitle(items[0].file.name, items[0].handle);
                    await global.renderPDF(await items[0].file.arrayBuffer(), false);
                    for (let i = 1; i < items.length; i++) {
                        await global.renderPDF(await items[i].file.arrayBuffer(), true);
                    }
                    try {
                        global.history.replaceState({}, document.title, global.location.pathname || "./");
                    } catch (_) { /* ignore */ }
                    schedulePersist();
                    return;
                }

                await openFilesAsTabs(items);
            } catch (err) {
                console.error("[workspace] launchQueue consumer error", err);
            }
        });
    }

    /**
     * Apply feature flags from config to chrome (OCR, form mode, tabs).
     */
    function applyConfigToChrome() {
        const ocrBtn = document.getElementById("ocrBtn");
        if (ocrBtn) {
            ocrBtn.style.display = cfg("disableOCR", false) ? "none" : "";
        }

        const formSwitch = document.getElementById("workspaceModeSwitch");
        if (formSwitch) {
            formSwitch.style.display = cfg("enableFormMode", true) ? "" : "none";
        }

        // Zoom limits from config
        if (global.APP) {
            if (cfg("minZoom") != null) global.APP.MIN_ZOOM = Number(cfg("minZoom", 0.5));
            if (cfg("maxZoom") != null) global.APP.MAX_ZOOM = Number(cfg("maxZoom", 3.0));
            if (cfg("zoomStep") != null) global.APP.ZOOM_STEP = Number(cfg("zoomStep", 0.25));
        }

        renderTabBar();
    }

    /**
     * Bootstrap after all deferred app scripts have loaded.
     */
    async function bootstrap() {
        if (bootstrapped) return;
        bootstrapped = true;

        // Migrate legacy #viewer into workspace if present
        const root = workspaceRoot();
        let legacy = document.getElementById("viewer");
        if (legacy && !legacy.dataset.docId) {
            // Wrap as first document
            const id = uid();
            legacy.dataset.docId = id;
            legacy.classList.add("doc-viewer", "is-active-doc");
            if (legacy.parentNode !== root) {
                root.appendChild(legacy);
            }
            const doc = {
                id,
                title: "Untitled",
                viewer: legacy,
                zoom: global.currentZoom || defaultZoom(),
                scrollTop: 0,
                pdfName: global.currentPdfName || "document.pdf",
                fileHandle: null,
                undoStack: (global.historyEngine && global.historyEngine.undoStack) || [],
                redoStack: (global.historyEngine && global.historyEngine.redoStack) || [],
                savePoint: (global.historyEngine && global.historyEngine.savePoint) || 0,
                workspaceMode: (global.APP && global.APP.workspaceMode) || "editor",
                currentMode: (global.APP && global.APP.currentMode) || "select",
                isPixelated: !!(global.APP && global.APP.isPixelated),
                sourcePdfBuffers: null,
                dirty: false
            };
            docs.set(id, doc);
            activeId = id;
            if (global.APP && global.APP.DOM) global.APP.DOM.viewer = legacy;
        } else if (docs.size === 0) {
            createDocument({ title: "Untitled", activate: true });
        }

        // Apply default zoom for empty docs
        if (pageCountIn(activeDoc() && activeDoc().viewer) === 0) {
            global.currentZoom = defaultZoom();
            if (typeof global.setZoom === "function") global.setZoom(global.currentZoom);
        }

        applyConfigToChrome();
        initLaunchQueue();

        // Session restore (tabbed + enabled only).
        // File System Access may require a user gesture for requestPermission —
        // we try quietly first; if handles exist but none restored, show a bar.
        if (tabbed() && sessionOn()) {
            try {
                const ok = await restoreSession();
                if (!ok) await maybeOfferSessionRestore();
            } catch (e) {
                console.warn("[workspace] restoreSession", e);
                try { await maybeOfferSessionRestore(); } catch (_) { /* ignore */ }
            }
        }

        // Persist on page hide
        window.addEventListener("pagehide", () => {
            stashActive();
            if (sessionOn()) {
                persistSession().catch(() => {});
            }
        });

        // Keep dirty dots fresh on any history record (instruction tape or legacy)
        if (global.historyEngine && !global.historyEngine.__gaWorkspacePatched) {
            const origPush = global.historyEngine.push.bind(global.historyEngine);
            const origRecord = global.historyEngine.record
                ? global.historyEngine.record.bind(global.historyEngine)
                : null;
            global.historyEngine.push = function patchedPush(action) {
                const r = origPush(action);
                renderTabBar();
                schedulePersist();
                return r;
            };
            if (origRecord) {
                global.historyEngine.record = function patchedRecord(inst) {
                    const r = origRecord(inst);
                    renderTabBar();
                    schedulePersist();
                    return r;
                };
            }
            global.historyEngine.__gaWorkspacePatched = true;
        }

        global.dispatchEvent(new CustomEvent("ga-workspace-ready"));
        console.log("[workspace] ready — tabbed:", tabbed(), "version:", cfg("version", "?"));
    }

    global.GaWorkspace = {
        tabbed,
        bootstrap,
        createDocument,
        ensureActiveDocument,
        activateDocument,
        closeDocument,
        closeActiveDocument,
        closeAllDocuments,
        setActiveTitle,
        setActiveFileHandle,
        openFilesAsTabs,
        restoreSession,
        persistSession,
        rememberDocBytes,
        renderTabBar,
        updateDocumentTitle,
        appTitleWithVersion,
        displayVersion,
        applyConfigToChrome,
        stashActive,
        getActiveId: () => activeId,
        getDocs: () => docs,
        activeDoc,
        pageCountIn,
        /** Active viewer page count */
        activePageCount: () => {
            const d = activeDoc();
            return d ? pageCountIn(d.viewer) : 0;
        }
    };
})(typeof window !== "undefined" ? window : globalThis);
