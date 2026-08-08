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
    // One queue for open/restore so they don't play chicken mid-render
    let opChain = Promise.resolve();
    let startupOpenCount = 0;
    let startupOpenWaiters = [];
    // Snapshot of "what was open last time" for the Restore bar.
    // Do NOT re-read IDB after open — open's persist rewrites history and Restore
    // becomes "duplicate of the file you just opened." Classic.
    let pendingRestorePayload = null;
    // While true: hands off workspace-v1 in IDB (freeze the past until Restore/Dismiss)
    let sessionPersistHold = false;

    function runSerialized(fn) {
        const run = opChain.then(() => fn());
        opChain = run.catch((e) => {
            console.warn("[workspace] serialized op failed", e);
        });
        return run;
    }

    function cloneSessionPayload(payload) {
        if (!payload || typeof payload !== "object") return null;
        const tabs = Array.isArray(payload.tabs) ? payload.tabs : [];
        return {
            v: payload.v,
            activeId: payload.activeId || null,
            tabs: tabs.map((t) => {
                if (!t || typeof t !== "object") return null;
                return {
                    id: t.id || null,
                    title: t.title || null,
                    pdfName: t.pdfName || null,
                    zoom: t.zoom,
                    fileHandle: t.fileHandle || null,
                    blobKey: t.blobKey || null,
                    hasContent: !!t.hasContent
                };
            }).filter(Boolean)
        };
    }

    function countRestorableTabs(payload) {
        if (!payload || !Array.isArray(payload.tabs)) return 0;
        return payload.tabs.filter((t) => t && (t.fileHandle || t.blobKey || t.hasContent)).length;
    }

    function normalizeDocName(name) {
        return stripName(name || "").toLowerCase();
    }

    function openDocFingerprints() {
        const names = new Set();
        const handles = [];
        docs.forEach((d) => {
            if (!d) return;
            if (pageCountIn(d.viewer) === 0 && isPlaceholderName(d.title || d.pdfName)) return;
            const n = normalizeDocName(d.pdfName || d.title);
            if (n && !isPlaceholderName(n)) names.add(n);
            if (d.fileHandle) handles.push(d.fileHandle);
        });
        return { names, handles };
    }

    async function handlesAreSame(a, b) {
        if (!a || !b || typeof a.isSameEntry !== "function") return false;
        try {
            return !!(await a.isSameEntry(b));
        } catch (_) {
            return false;
        }
    }

    async function sessionTabMatchesOpen(tab, open) {
        if (!tab || !open) return false;
        if (tab.fileHandle && open.handles && open.handles.length) {
            for (let i = 0; i < open.handles.length; i++) {
                if (await handlesAreSame(tab.fileHandle, open.handles[i])) return true;
            }
        }
        const n = normalizeDocName(tab.pdfName || tab.title);
        if (n && !isPlaceholderName(n) && open.names && open.names.has(n)) return true;
        return false;
    }

    async function filterPayloadExcludingOpen(payload) {
        if (!payload || !Array.isArray(payload.tabs)) return payload;
        const open = openDocFingerprints();
        if (open.names.size === 0 && open.handles.length === 0) return payload;

        const tabs = [];
        for (const t of payload.tabs) {
            if (!t) continue;
            if (await sessionTabMatchesOpen(t, open)) continue;
            tabs.push(t);
        }
        return {
            v: payload.v,
            activeId: payload.activeId || null,
            tabs
        };
    }

    function releaseSessionPersistHold() {
        sessionPersistHold = false;
        pendingRestorePayload = null;
        schedulePersist();
    }

    function noteStartupOpen(n) {
        const count = Math.max(0, Number(n) || 0);
        if (count <= 0) return;
        startupOpenCount += count;
        const waiters = startupOpenWaiters.slice();
        startupOpenWaiters = [];
        waiters.forEach((w) => {
            try { w(); } catch (_) { /* ignore */ }
        });
    }

    function waitForStartupOpens(maxMs) {
        const budget = Math.max(0, Number(maxMs) || 0);
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve(startupOpenCount);
            };
            if (startupOpenCount > 0) {
                setTimeout(finish, 50);
                return;
            }
            const timer = setTimeout(finish, budget);
            startupOpenWaiters.push(() => {
                clearTimeout(timer);
                setTimeout(finish, 80);
            });
        });
    }

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

        // Real filenames stick. Empty shells stay Untitled — not the fake "document.pdf" cosplay.
        const live = global.currentPdfName;
        if (live && !isPlaceholderName(live)) {
            doc.pdfName = live;
            doc.title = stripName(live);
        } else if (doc.pdfName && !isPlaceholderName(doc.pdfName)) {
            global.currentPdfName = doc.pdfName;
            doc.title = stripName(doc.pdfName);
        } else {
            doc.pdfName = "Untitled";
            doc.title = "Untitled";
        }

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

    // "Spare" = secret empty pane so APP.DOM.viewer always has a home.
    // Not a real tab until content lands or it's the only thing left.
    function isSpareShell(doc) {
        return !!(doc && doc.spare);
    }

    function isEmptyShell(doc) {
        if (!doc) return true;
        return pageCountIn(doc.viewer) === 0 && !doc.fileHandle;
    }

    // Tab bar guest list: real tabs always. Spares only when flying solo.
    function isTabVisible(doc) {
        if (!doc) return false;
        if (!isSpareShell(doc)) return true;
        if (!isEmptyShell(doc)) {
            doc.spare = false; // grew up — has pages now
            return true;
        }
        let others = 0;
        docs.forEach((d) => {
            if (d && d.id !== doc.id && !isSpareShell(d)) others += 1;
            else if (d && d.id !== doc.id && isSpareShell(d) && !isEmptyShell(d)) others += 1;
        });
        return others === 0;
    }

    function promoteIfNeeded(doc) {
        if (!doc || !doc.spare) return;
        if (!isEmptyShell(doc) || (doc.pdfName && !isPlaceholderName(doc.pdfName))) {
            doc.spare = false;
        }
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
     * Mint a document pane. spare:true = invisible workspace anchor (not a cosplay tab).
     * @param {{ title?: string, fileHandle?: *, activate?: boolean, spare?: boolean }} [opts]
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
            pdfName: (opts.title && !isPlaceholderName(opts.title)) ? opts.title : (opts.title || "Untitled"),
            fileHandle: opts.fileHandle || null,
            undoStack: [],
            redoStack: [],
            savePoint: 0,
            workspaceMode: "editor",
            currentMode: "select",
            isPixelated: false,
            sourcePdfBuffers: null,
            dirty: false,
            spare: !!opts.spare // hidden until useful (or until it's lonely)
        };
        docs.set(id, doc);

        // Soft cap — oldest tab walks the plank
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

    // Always have *somewhere* to put pixels. Reuse spare if we can.
    function ensureActiveDocument() {
        if (activeDoc()) return activeDoc();
        let spare = null;
        docs.forEach((d) => {
            if (!spare && isSpareShell(d) && isEmptyShell(d)) spare = d;
        });
        if (spare) {
            applyDoc(spare);
            return spare;
        }
        return createDocument({ title: "Untitled", activate: true, spare: true });
    }

    function activateDocument(id) {
        if (!id || !docs.has(id)) return;
        if (id === activeId) return;
        stashActive();
        applyDoc(docs.get(id));
    }

    // Close focus: right neighbor first, else left. Browser/VS Code vibes.
    // (Old code grabbed Map.first → often a hidden spare → blank screen. Nope.)
    function neighborDocId(closedId, orderedIds) {
        const ids = Array.isArray(orderedIds) ? orderedIds : Array.from(docs.keys());
        const idx = ids.indexOf(closedId);
        if (idx < 0) {
            return ids.find((i) => i !== closedId) || null;
        }
        if (idx + 1 < ids.length) return ids[idx + 1];
        if (idx - 1 >= 0) return ids[idx - 1];
        return null;
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

        // Order BEFORE delete — Map insertion ≈ tab strip order
        const orderedIds = Array.from(docs.keys());
        const focusId = wasActive ? neighborDocId(id, orderedIds) : null;

        if (doc.viewer && doc.viewer.parentNode) {
            doc.viewer.parentNode.removeChild(doc.viewer);
        }
        forgetDocBytes(id);
        docs.delete(id);

        if (wasActive) {
            activeId = null;
            if (focusId && docs.has(focusId)) {
                applyDoc(docs.get(focusId));
            } else if (docs.size > 0) {
                const fallback = docs.keys().next().value;
                if (fallback) applyDoc(docs.get(fallback));
            } else if (!opts.forceEmpty) {
                // Last tab closed → quiet spare so tools still have a canvas
                createDocument({ title: "Untitled", activate: true, spare: true });
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
        // Close-all still needs a canvas hideout
        if (docs.size === 0) {
            createDocument({ title: "Untitled", activate: true, spare: true });
        }
        updateDocumentTitle();
        renderTabBar();
        schedulePersist();
        return true;
    }

    /**
     * Set title/handle on a specific doc bag (not "whatever is active").
     * Critical during multi-tab open/restore races.
     */
    function setDocTitle(doc, name, fileHandle) {
        if (!doc) return;
        if (name) {
            doc.pdfName = name;
            doc.title = stripName(name);
            if (doc.id === activeId) {
                global.currentPdfName = name;
            }
        }
        if (fileHandle !== undefined) {
            doc.fileHandle = fileHandle || null;
        }
        promoteIfNeeded(doc); // real name? you're a real tab now
        if (doc.id === activeId) updateDocumentTitle();
        renderTabBar();
        schedulePersist();
    }

    function setActiveTitle(name, fileHandle) {
        const doc = activeDoc() || ensureActiveDocument();
        setDocTitle(doc, name, fileHandle);
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

        // Spares crash the party only when they're the only guest
        docs.forEach((doc) => {
            if (!isTabVisible(doc)) return;

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

        // "+" = user asked for a real empty tab (visible). Not a sneaky spare.
        const add = document.createElement("button");
        add.type = "button";
        add.className = "doc-tab-add";
        add.title = "New empty tab";
        add.setAttribute("aria-label", "New tab");
        add.textContent = "+";
        add.addEventListener("click", () => {
            createDocument({ title: "Untitled", activate: true, spare: false });
        });
        bar.appendChild(add);
    }

    // === Session persistence ===

    function schedulePersist() {
        if (!sessionOn() || !global.GaIdb) return;
        // Restore bar is up — leave the frozen past alone
        if (sessionPersistHold) return;
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistTimer = null;
            if (sessionPersistHold) return;
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
        if (sessionPersistHold) {
            return; // frozen session still on ice
        }
        stashActive();
        const store = global.GaIdb.sessionStore();
        const key = cfg("sessionStoreKey", "workspace-v1");
        // Spares/empties don't get a seat on the time machine
        const tabDocs = Array.from(docs.values()).filter(
            (d) => (pageCountIn(d.viewer) > 0 || d.fileHandle) && !isSpareShell(d)
        );
        const payload = {
            v: 2,
            activeId: (tabDocs.some((d) => d.id === activeId) ? activeId : (tabDocs[0] && tabDocs[0].id)) || null,
            tabs: tabDocs.map((d) => ({
                id: d.id,
                title: d.title,
                pdfName: d.pdfName,
                zoom: d.zoom,
                fileHandle: d.fileHandle || null,
                blobKey: d.blobKey || (pageCountIn(d.viewer) > 0 ? blobKeyFor(d.id) : null),
                hasContent: pageCountIn(d.viewer) > 0
            }))
        };
        await store.set(key, payload);
    }

    async function readSessionPayloadFromIdb() {
        if (!global.GaIdb) return null;
        try {
            return await global.GaIdb.sessionStore().get(cfg("sessionStoreKey", "workspace-v1"));
        } catch (e) {
            console.warn("[workspace] session read failed", e);
            return null;
        }
    }

    /**
     * Show Restore/Dismiss bar for a frozen prior session.
     * @param {object} [payloadOverride]
     */
    async function maybeOfferSessionRestore(payloadOverride) {
        if (!sessionOn() || !tabbed() || !global.GaIdb) return;
        if (document.getElementById("ga-session-restore-bar")) return;

        let payload = payloadOverride || pendingRestorePayload;
        if (!payload) {
            payload = await readSessionPayloadFromIdb();
        }
        payload = cloneSessionPayload(payload);
        if (!payload) return;

        // Re-opened the same file? No "Restore 1" duplicate cosplay please
        payload = await filterPayloadExcludingOpen(payload);

        const n = countRestorableTabs(payload);
        if (n === 0) {
            releaseSessionPersistHold();
            return;
        }

        pendingRestorePayload = payload;
        sessionPersistHold = true;

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
            yes.disabled = true;
            no.disabled = true;
            // Soft toast only — multi-page restore streams like a normal open. No disco dim.
            let ownsGate = false;
            try {
                if (typeof global.beginDocGate === "function") {
                    global.beginDocGate("session-restore");
                    ownsGate = true;
                }
                if (typeof global.setDocLoadStatus === "function") {
                    global.setDocLoadStatus(
                        `Restoring ${n} document(s)…  ·  Save/print wait until done`
                    );
                }
                await restoreSession({ forcePrompt: true, payload: pendingRestorePayload });
            } finally {
                if (ownsGate && typeof global.endDocGate === "function") {
                    try { global.endDocGate(); } catch (_) { /* ignore */ }
                } else if (typeof global.setDocLoadStatus === "function") {
                    global.setDocLoadStatus(null);
                }
                releaseSessionPersistHold();
            }
        });
        no.addEventListener("click", () => {
            bar.remove();
            releaseSessionPersistHold(); // keep only what they just opened
        });
        bar.appendChild(yes);
        bar.appendChild(no);
        document.body.appendChild(bar);
    }

    /**
     * Restore tabs that still have a FileSystemFileHandle (+ re-request permission).
     * @param {{ forcePrompt?: boolean, payload?: object }} [opts]
     */
    async function restoreSession(opts = {}) {
        return runSerialized(() => restoreSessionUnlocked(opts));
    }

    async function restoreSessionUnlocked(opts = {}) {
        if (!sessionOn() || !tabbed() || !global.GaIdb) return false;
        if (!global.isSecureContext) {
            console.info("[workspace] session restore skipped (insecure context)");
            return false;
        }

        let payload = opts.payload || pendingRestorePayload || null;
        if (!payload) {
            payload = await readSessionPayloadFromIdb();
        }
        payload = cloneSessionPayload(payload);
        if (!payload || !Array.isArray(payload.tabs) || payload.tabs.length === 0) return false;

        payload = await filterPayloadExcludingOpen(payload);

        const restorable = payload.tabs.filter(
            (t) => t && (t.fileHandle || t.blobKey || t.hasContent)
        );
        if (restorable.length === 0) return false;

        const store = global.GaIdb.sessionStore();
        let restored = 0;
        let needsGesture = false;
        /** @type {Map<string, string>} */
        const idMap = new Map();
        let lastRestoredId = null;
        const alreadyOpenIds = new Set(Array.from(docs.keys()));

        for (const t of restorable) {
            try {
                let arrayBuffer = null;
                let handle = t.fileHandle || null;
                let title = t.title || t.pdfName || "document.pdf";

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
                            arrayBuffer = null;
                        }
                    } else {
                        needsGesture = true;
                    }
                }

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

                const doc = createDocument({
                    title,
                    fileHandle: handle,
                    activate: false,
                    spare: false
                });
                if (t.id) idMap.set(t.id, doc.id);
                lastRestoredId = doc.id;

                if (t.blobKey && t.id && doc.id !== t.id) {
                    doc.blobKey = blobKeyFor(doc.id);
                    try {
                        await store.set(doc.blobKey, arrayBuffer.slice(0));
                    } catch (_) { /* ignore */ }
                } else {
                    doc.blobKey = t.blobKey || blobKeyFor(doc.id);
                }
                doc.zoom = Number(t.zoom) > 0 ? Number(t.zoom) : defaultZoom();
                doc.pdfName = title;
                setDocTitle(doc, title, handle);

                if (typeof global.setDocLoadStatus === "function") {
                    const label = title || "document";
                    global.setDocLoadStatus(
                        `Restoring ${restored + 1}/${restorable.length}: ${label}  ·  Save/print wait until done`
                    );
                }

                stashActive();
                applyDoc(doc);
                if (typeof global.renderPDF === "function") {
                    await global.renderPDF(arrayBuffer, false, { viewer: doc.viewer });
                }
                setDocTitle(doc, title, handle);
                await rememberDocBytes(arrayBuffer, doc);
                restored += 1;
            } catch (err) {
                console.warn("[workspace] failed to restore tab", t && t.title, err);
            }
        }

        if (restored === 0 && needsGesture && !opts.forcePrompt) {
            return false;
        }

        if (restored > 0) {
            // Spares stay put but invisible — no blank "document.pdf" tab cosplay
            const wantOld = payload.activeId;
            const wantNew = (wantOld && idMap.get(wantOld)) || lastRestoredId;
            if (wantNew && docs.has(wantNew)) {
                activateDocument(wantNew);
            } else if (lastRestoredId) {
                activateDocument(lastRestoredId);
            }
            docs.forEach((d) => {
                if (isEmptyShell(d) && isPlaceholderName(d.title || d.pdfName)) {
                    d.spare = true;
                }
            });
            renderTabBar();
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
        noteStartupOpen(list.length);
        return runSerialized(() => openFilesAsTabsUnlocked(items, opts));
    }

    async function openFilesAsTabsUnlocked(items, opts = {}) {
        const list = Array.from(items || []).filter(Boolean);
        if (list.length === 0) return;

        const normalized = list.map((item) => {
            if (item instanceof File) return { file: item, handle: null };
            if (item && item.file) return { file: item.file, handle: item.handle || null };
            return null;
        }).filter(Boolean);

        const total = normalized.length;
        const showBusy = total > 1 && typeof global.showLoading === "function";

        try {
            if (showBusy) {
                global.showLoading(`Loading PDF 1 of ${total}…`);
            }

            if (!tabbed() || opts.replaceActive) {
                const doc = ensureActiveDocument();
                const first = normalized[0];
                setDocTitle(doc, first.file.name, first.handle);
                if (typeof global.renderPDF === "function") {
                    await global.renderPDF(await first.file.arrayBuffer(), false, { viewer: doc.viewer });
                }
                for (let i = 1; i < normalized.length; i++) {
                    if (showBusy) {
                        global.showLoading(`Appending PDF ${i + 1} of ${total}…`);
                    }
                    await global.renderPDF(await normalized[i].file.arrayBuffer(), true, { viewer: doc.viewer });
                }
                setDocTitle(doc, first.file.name, first.handle);
                schedulePersist();
                return;
            }

            for (let i = 0; i < normalized.length; i++) {
                if (showBusy) {
                    global.showLoading(`Opening PDF ${i + 1} of ${total}…`);
                }
                const { file, handle } = normalized[i];
                let doc = activeDoc();
                const emptyActive = doc && pageCountIn(doc.viewer) === 0;
                if (i === 0 && emptyActive) {
                    setDocTitle(doc, file.name, handle);
                } else {
                    doc = createDocument({ title: file.name, fileHandle: handle, activate: true });
                    setDocTitle(doc, file.name, handle);
                }
                await global.renderPDF(await file.arrayBuffer(), false, { viewer: doc.viewer });
                setDocTitle(doc, file.name, handle);
                if (doc.id !== activeId) {
                    activateDocument(doc.id);
                }
            }
            schedulePersist();
        } finally {
            if (showBusy && typeof global.hideLoading === "function") {
                global.hideLoading();
            }
        }
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
                noteStartupOpen(items.length);

                if (isCombineMode && items.length > 1) {
                    await runSerialized(async () => {
                        const total = items.length;
                        const showBusy = typeof global.showLoading === "function";
                        try {
                            if (showBusy) {
                                global.showLoading(`Combining PDF 1 of ${total}…`);
                            }
                            const doc = ensureActiveDocument();
                            setDocTitle(doc, items[0].file.name, items[0].handle);
                            await global.renderPDF(await items[0].file.arrayBuffer(), false, {
                                viewer: doc.viewer
                            });
                            for (let i = 1; i < items.length; i++) {
                                if (showBusy) {
                                    global.showLoading(`Combining PDF ${i + 1} of ${total}…`);
                                }
                                await global.renderPDF(await items[i].file.arrayBuffer(), true, {
                                    viewer: doc.viewer
                                });
                            }
                            setDocTitle(doc, items[0].file.name, items[0].handle);
                            try {
                                global.history.replaceState({}, document.title, global.location.pathname || "./");
                            } catch (_) { /* ignore */ }
                            schedulePersist();
                        } finally {
                            if (showBusy && typeof global.hideLoading === "function") {
                                global.hideLoading();
                            }
                        }
                    });
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
                pdfName: (global.currentPdfName && !isPlaceholderName(global.currentPdfName))
                    ? global.currentPdfName
                    : "Untitled",
                fileHandle: null,
                undoStack: (global.historyEngine && global.historyEngine.undoStack) || [],
                redoStack: (global.historyEngine && global.historyEngine.redoStack) || [],
                savePoint: (global.historyEngine && global.historyEngine.savePoint) || 0,
                workspaceMode: (global.APP && global.APP.workspaceMode) || "editor",
                currentMode: (global.APP && global.APP.currentMode) || "select",
                isPixelated: !!(global.APP && global.APP.isPixelated),
                sourcePdfBuffers: null,
                dirty: false,
                spare: true
            };
            docs.set(id, doc);
            activeId = id;
            if (global.APP && global.APP.DOM) global.APP.DOM.viewer = legacy;
        } else if (docs.size === 0) {
            createDocument({ title: "Untitled", activate: true, spare: true });
        }

        // Apply default zoom for empty docs
        if (pageCountIn(activeDoc() && activeDoc().viewer) === 0) {
            global.currentZoom = defaultZoom();
            if (typeof global.setZoom === "function") global.setZoom(global.currentZoom);
        }

        applyConfigToChrome();
        initLaunchQueue();

        // Freeze last session BEFORE any open can rewrite IDB. Blob keys stay valid.
        let priorSession = null;
        if (tabbed() && sessionOn() && global.GaIdb) {
            try {
                priorSession = cloneSessionPayload(await readSessionPayloadFromIdb());
            } catch (_) {
                priorSession = null;
            }
            if (countRestorableTabs(priorSession) > 0) {
                pendingRestorePayload = priorSession;
                sessionPersistHold = true;
            }
        }

        // Brief window for shell/launchQueue "open these files" before auto-restore.
        // Race those and you get blank tabs with the wrong names. Party foul.
        global.__GA_WORKSPACE_ACCEPTING_STARTUP_OPENS__ = true;
        global.dispatchEvent(new CustomEvent("ga-workspace-accepting-opens"));

        await waitForStartupOpens(350);
        await opChain.catch(() => {});

        global.__GA_WORKSPACE_ACCEPTING_STARTUP_OPENS__ = false;
        const openedAtStartup = startupOpenCount > 0;
        const priorN = countRestorableTabs(priorSession);

        // Opened via OS? Offer restore bar — don't silently dump last week's tabs under them.
        if (tabbed() && sessionOn()) {
            if (openedAtStartup) {
                if (priorN > 0) {
                    try {
                        await maybeOfferSessionRestore(priorSession);
                    } catch (e) {
                        console.warn("[workspace] maybeOfferSessionRestore", e);
                        releaseSessionPersistHold();
                    }
                } else {
                    sessionPersistHold = false;
                    pendingRestorePayload = null;
                    schedulePersist();
                }
            } else {
                try {
                    const ok = priorN > 0
                        ? await restoreSession({ payload: priorSession })
                        : false;
                    sessionPersistHold = false;
                    pendingRestorePayload = null;
                    if (ok) {
                        schedulePersist();
                    } else if (priorN > 0) {
                        await maybeOfferSessionRestore(priorSession);
                    }
                } catch (e) {
                    console.warn("[workspace] restoreSession", e);
                    try {
                        await maybeOfferSessionRestore(priorSession);
                    } catch (_) { /* ignore */ }
                }
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

        global.__GA_WORKSPACE_READY__ = true;
        global.dispatchEvent(new CustomEvent("ga-workspace-ready"));
        console.log(
            "[workspace] ready — tabbed:", tabbed(),
            "version:", cfg("version", "?"),
            "startupOpens:", startupOpenCount
        );
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
        setDocTitle,
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
        noteStartupOpen,
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
