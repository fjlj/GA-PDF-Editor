// ==========================================
// file-import.js: PDF LOADING & MODALS
// ==========================================

// --- Unified File Import Engine ---
window.pendingImportFiles = [];
/** Optional FileSystemFileHandle parallel to pendingImportFiles (same index). */
window.pendingImportHandles = [];
/**
 * Why the drop-choice modal is open:
 *  - "append"     → active doc has pages; choose Append vs New tab(s)
 *  - "empty-multi"→ empty canvas + multiple files; choose Combine vs each as tab
 */
window.pendingImportIntent = null;

function activePageCount() {
    if (window.GaWorkspace && typeof window.GaWorkspace.activePageCount === "function") {
        return window.GaWorkspace.activePageCount();
    }
    const viewer = (window.APP && APP.DOM && APP.DOM.viewer) || document.getElementById("viewer");
    return viewer ? viewer.querySelectorAll(".pageWrapper").length : 0;
}

function tabbedMode() {
    return !!(window.GaWorkspace && window.GaWorkspace.tabbed && window.GaWorkspace.tabbed());
}

function workspaceApi() {
    return window.GaWorkspace || null;
}

/**
 * Load one or more PDFs into the *active* tab (first replaces/fills empty, rest append).
 * @param {File[]} pdfFiles
 * @param {Array} handles
 */
async function loadFilesIntoActiveTab(pdfFiles, handles) {
    if (!pdfFiles || !pdfFiles.length) return;
    const ws = workspaceApi();

    window.currentPdfName = pdfFiles[0].name;
    if (ws && ws.setActiveTitle) {
        ws.setActiveTitle(pdfFiles[0].name, handles[0] || null);
    } else if (ws && ws.setActiveFileHandle && handles[0]) {
        ws.setActiveFileHandle(handles[0]);
    }
    await window.renderPDF(await pdfFiles[0].arrayBuffer(), false);
    for (let i = 1; i < pdfFiles.length; i++) {
        await window.renderPDF(await pdfFiles[i].arrayBuffer(), true);
    }

    if (window.pendingProjectData) {
        const modal = document.getElementById("pendingProjectModal");
        if (modal) modal.style.display = "none";
        const schema = window.pendingProjectData;
        window.pendingProjectData = null;
        try {
            const root = (window.APP && APP.DOM && APP.DOM.viewer) || document.getElementById("viewer");
            if (root) {
                root._gaProjectSchema = schema;
                const expectedForms = (Array.isArray(schema.pages) ? schema.pages : [])
                    .reduce((n, p) => n + ((p.overlays || []).filter((o) => o && o.type === "formField").length), 0);
                if (expectedForms > 0) root.dataset.expectedFormFields = String(expectedForms);
            }
            window.applyProjectData(schema);
            if (typeof window.scheduleSuppressNativesForDesignerTwins === "function") {
                window.scheduleSuppressNativesForDesignerTwins(root || undefined);
            }
            if (typeof window.scheduleEnsureFormsReady === "function") {
                window.scheduleEnsureFormsReady(root, { schema });
            }
        } catch (e) {
            console.warn("[file-import] pending project apply failed", e);
        }
    }
    if (ws && ws.renderTabBar) {
        ws.renderTabBar();
        if (ws.persistSession) ws.persistSession().catch(() => {});
    }
}

/**
 * Show Append vs New Tab (or empty-multi Combine vs Each) modal.
 * @param {File[]} pdfFiles
 * @param {Array} handles
 * @param {"append"|"empty-multi"} intent
 */
function showDropChoiceModal(pdfFiles, handles, intent) {
    window.pendingImportFiles = pdfFiles;
    window.pendingImportHandles = handles;
    window.pendingImportIntent = intent;

    const titleEl = document.querySelector("#dropChoiceModal h3");
    const appendBtn = document.getElementById("dropAppendBtn");
    const newBtn = document.getElementById("dropNewBtn");
    const n = pdfFiles.length;
    const multi = n > 1;

    if (intent === "empty-multi") {
        if (titleEl) {
            titleEl.textContent = multi
                ? `How would you like to load these ${n} PDFs?`
                : "How would you like to load this PDF?";
        }
        if (appendBtn) {
            appendBtn.textContent = multi
                ? "📚 Combine into This Document"
                : "📄 Open in This Tab";
        }
        if (newBtn) {
            newBtn.textContent = multi
                ? "📑 Open Each as New Tab"
                : "📄 Open as New Tab";
        }
    } else {
        if (titleEl) {
            titleEl.textContent = multi
                ? `How would you like to load these ${n} PDFs?`
                : "How would you like to load this PDF?";
        }
        if (appendBtn) {
            appendBtn.textContent = multi
                ? "➕ Append All to Current"
                : "➕ Append to Current";
        }
        if (newBtn) {
            if (tabbedMode()) {
                newBtn.textContent = multi
                    ? "📑 Open Each as New Tab"
                    : "📄 Open as New Tab";
            } else {
                newBtn.textContent = multi
                    ? "📄 Open as New (combine)"
                    : "📄 Open as New";
            }
        }
    }

    if (APP.DOM && APP.DOM.dropChoiceModal) {
        APP.DOM.dropChoiceModal.style.display = "flex";
    }
}

/**
 * @param {FileList|File[]|Array} files
 * @param {boolean} [forceAppend]  true = skip choice, go to insert-location modal
 * @param {{ handles?: Array<FileSystemFileHandle|null> }} [opts]
 */
window.processPdfFiles = async function(files, forceAppend = false, opts = {}) {
    const list = Array.from(files || []);
    const pdfFiles = list.filter(f => f && (
        f.name.toLowerCase().endsWith(".gapdf")
        || f.name.toLowerCase().endsWith(".pdf")
        || f.type === "application/pdf"
    ));
    if (pdfFiles.length === 0) return;

    const handles = Array.isArray(opts.handles) ? opts.handles : [];
    const ws = workspaceApi();

    // Ensure workspace has an active document shell
    if (ws && typeof ws.ensureActiveDocument === "function") {
        ws.ensureActiveDocument();
    }

    const pageCount = activePageCount();

    // Forced append (e.g. sidebar drop / Insert PDF) → where to insert
    if (forceAppend) {
        if (pageCount === 0) {
            // Nothing to append to — just open into the empty tab
            await loadFilesIntoActiveTab(pdfFiles, handles);
            return;
        }
        window.pendingImportFiles = pdfFiles;
        window.pendingImportHandles = handles;
        window.pendingImportIntent = "append";
        const insertModal = document.getElementById("insertChoiceModal");
        if (insertModal) insertModal.style.display = "flex";
        return;
    }

    // Empty active canvas
    if (pageCount === 0) {
        // Multiple files + tabs: let user combine or split into tabs
        if (pdfFiles.length > 1 && tabbedMode()) {
            showDropChoiceModal(pdfFiles, handles, "empty-multi");
            return;
        }
        await loadFilesIntoActiveTab(pdfFiles, handles);
        return;
    }

    // Active tab already has pages → always ask Append vs New tab(s)
    // (works for single and multi-file picks)
    showDropChoiceModal(pdfFiles, handles, "append");
};

// --- The Location Engine (Top, Current, Bottom) ---
window.processInsertion = async function(position) {
    document.getElementById("insertChoiceModal").style.display = "none";
    if (window.pendingImportFiles.length === 0) return;

    const insertBtn = document.getElementById("insertPdfBtn");
    const originalText = insertBtn ? insertBtn.innerText : "";
    if (insertBtn) {
        insertBtn.innerText = "Processing...";
        insertBtn.disabled = true;
    }

    let allAddedWrappers = [];

    for (let file of window.pendingImportFiles) {
        const addedWrappers = await window.renderPDF(await file.arrayBuffer(), true);
        if (addedWrappers) allAddedWrappers = allAddedWrappers.concat(addedWrappers);
    }

    if (allAddedWrappers.length > 0) {
        const allWrappers = Array.from(APP.DOM.viewer.querySelectorAll(".pageWrapper"));
        const oldWrappers = allWrappers.filter(w => !allAddedWrappers.includes(w));

        let referenceSibling = null;

        if (position === "top") {
            referenceSibling = oldWrappers[0] || null;
        } else if (position === "current") {
            let currentWrapper = null;
            let minDiff = Infinity;
            const viewerRect = APP.DOM.viewer.getBoundingClientRect();
            const viewerCenter = viewerRect.top + (viewerRect.height / 2);

            oldWrappers.forEach(w => {
                const rect = w.getBoundingClientRect();
                const wrapperCenter = rect.top + (rect.height / 2);
                const diff = Math.abs(wrapperCenter - viewerCenter);
                if (diff < minDiff) {
                    minDiff = diff;
                    currentWrapper = w;
                }
            });

            if (currentWrapper) {
                const currentIndex = oldWrappers.indexOf(currentWrapper);
                referenceSibling = oldWrappers[currentIndex + 1] || null;
            }
        } else if (position === "bottom") {
            referenceSibling = null;
        }

        allAddedWrappers.forEach(w => {
            if (referenceSibling && referenceSibling.parentNode === APP.DOM.viewer) {
                APP.DOM.viewer.insertBefore(w, referenceSibling);
            } else {
                APP.DOM.viewer.appendChild(w);
            }
        });

        window.syncPageThumbnails();

        setTimeout(() => {
            if (allAddedWrappers[0]) {
                APP.DOM.viewer.scrollTo({
                    top: allAddedWrappers[0].offsetTop - 20,
                    behavior: "smooth"
                });
            }
        }, 50);

        if (window.GaProcessor && allAddedWrappers.length) {
            const steps = allAddedWrappers.map((w) =>
                window.GaProcessor.build.createNode(w, "Insert page")
            );
            window.GaProcessor.commit(
                window.GaProcessor.build.compound(
                    steps,
                    `Inserted ${window.pendingImportFiles.length} PDF(s)`
                )
            );
        }
    }

    if (insertBtn) {
        insertBtn.innerText = originalText;
        insertBtn.disabled = false;
    }
    window.pendingImportFiles = [];
    window.pendingImportHandles = [];
    window.pendingImportIntent = null;
};

// Wire up the Choice Modal Buttons
document.getElementById("insertTopBtn").addEventListener("click", () => window.processInsertion("top"));
document.getElementById("insertCurrentBtn").addEventListener("click", () => window.processInsertion("current"));
document.getElementById("insertBottomBtn").addEventListener("click", () => window.processInsertion("bottom"));
document.getElementById("insertCancelBtn").addEventListener("click", () => {
    document.getElementById("insertChoiceModal").style.display = "none";
    window.pendingImportFiles = [];
    window.pendingImportHandles = [];
    window.pendingImportIntent = null;
});

// --- Open PDF Button Listener ---
APP.DOM.fileInput.addEventListener("change", e => {
    window.processPdfFiles(e.target.files, false);
    APP.DOM.fileInput.value = "";
});

document.getElementById("imageInput").addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        APP.pendingImageSrc = reader.result;
        if (APP.DOM.viewer) APP.DOM.viewer.style.cursor = "crosshair";
        window.clearActiveOverlay();
    };
    reader.readAsDataURL(file); e.target.value = "";
});

// --- Choice Modal Button Wiring ---
document.getElementById("dropAppendBtn").addEventListener("click", async () => {
    APP.DOM.dropChoiceModal.style.display = "none";
    const files = window.pendingImportFiles.slice();
    const handles = (window.pendingImportHandles || []).slice();
    const intent = window.pendingImportIntent;
    window.pendingImportFiles = [];
    window.pendingImportHandles = [];
    window.pendingImportIntent = null;
    if (!files.length) return;

    if (intent === "empty-multi") {
        // Combine all into the empty (or current) document
        await loadFilesIntoActiveTab(files, handles);
        return;
    }

    // Append path → insert location modal
    await window.processPdfFiles(files, true, { handles });
});

document.getElementById("dropNewBtn").addEventListener("click", async () => {
    APP.DOM.dropChoiceModal.style.display = "none";
    if (window.pendingImportFiles.length === 0) return;

    const files = window.pendingImportFiles.slice();
    const handles = (window.pendingImportHandles || []).slice();
    window.pendingImportFiles = [];
    window.pendingImportHandles = [];
    window.pendingImportIntent = null;

    // Tabbed: open each file in its own tab
    if (tabbedMode() && window.GaWorkspace && typeof window.GaWorkspace.openFilesAsTabs === "function") {
        const items = files.map((file, i) => ({ file, handle: handles[i] || null }));
        await window.GaWorkspace.openFilesAsTabs(items);
        return;
    }

    // Classic single-document: replace after dirty confirm
    const savedStackSize = window.historyEngine.savePoint || 0;
    const currentStackSize = window.historyEngine.undoStack.length;

    if (currentStackSize !== savedStackSize && !(await window.customConfirm(
        "You have unsaved changes. Are you sure you want to open a new file and discard your work?",
        "⚠️ Unsaved Changes"
    ))) {
        return;
    }

    await loadFilesIntoActiveTab(files, handles);
});

document.getElementById("dropCancelBtn").addEventListener("click", () => {
    APP.DOM.dropChoiceModal.style.display = "none";
    window.pendingImportFiles = [];
    window.pendingImportHandles = [];
    window.pendingImportIntent = null;
});

// Dirty warning (active tab + any dirty tab bags when tabbed)
window.addEventListener("beforeunload", (e) => {
    let dirty = false;
    if (window.historyEngine) {
        const savedStackSize = window.historyEngine.savePoint || 0;
        const currentStackSize = window.historyEngine.undoStack.length;
        dirty = currentStackSize !== savedStackSize;
    }
    if (!dirty && window.GaWorkspace && window.GaWorkspace.getDocs) {
        window.GaWorkspace.stashActive && window.GaWorkspace.stashActive();
        window.GaWorkspace.getDocs().forEach((doc) => {
            if ((doc.undoStack && doc.undoStack.length) !== (doc.savePoint || 0)) dirty = true;
        });
    }
    if (dirty) {
        e.preventDefault();
        e.returnValue = "";
    }
});
