// Helper bits that grew a personality (busy-state edition)
//
// Two flavors of "please wait":
//  1) Full-screen dim+spinner — multi-file smash-together / export. User is NOT browsing.
//  2) Soft doc gate — big multi-page open. Pages stream in (fun!), but save/print wait
//     until the dust settles. Refcounted + a 30min panic timeout so we never brick the UI.

window._gaOverlayBusy = false;
window._gaDocGateDepth = 0;
window._gaDocGateSafetyTimer = null;
// If something forgets endDocGate, this is the "break glass" timer
const GA_DOC_GATE_SAFETY_MS = 30 * 60 * 1000;

window.isAppBusy = function() {
    return !!window._gaOverlayBusy || (window._gaDocGateDepth > 0);
};

// Little toast at the bottom. Pointer-events: none — it does not eat clicks. Polite.
window.setDocLoadStatus = function(message) {
    let el = document.getElementById("ga-doc-load-status");
    if (!message) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
        return;
    }
    if (!el) {
        el = document.createElement("div");
        el.id = "ga-doc-load-status";
        el.setAttribute("role", "status");
        el.setAttribute("aria-live", "polite");
        el.style.cssText = [
            "position:fixed", "bottom:14px", "left:50%", "transform:translateX(-50%)",
            "z-index:99990", "pointer-events:none",
            "background:rgba(20,20,20,0.9)", "color:#eee",
            "padding:8px 16px", "border-radius:8px",
            "font:13px/1.3 system-ui,sans-serif", "font-weight:600",
            "box-shadow:0 4px 16px rgba(0,0,0,0.4)",
            "border:1px solid rgba(0,170,255,0.45)",
            "max-width:90vw", "text-align:center"
        ].join(";");
        document.body.appendChild(el);
    }
    el.textContent = message;
};

window.beginDocGate = function(/* reason */) {
    window._gaDocGateDepth = (window._gaDocGateDepth || 0) + 1;
    if (window._gaDocGateDepth === 1) {
        if (window._gaDocGateSafetyTimer) {
            clearTimeout(window._gaDocGateSafetyTimer);
        }
        window._gaDocGateSafetyTimer = setTimeout(() => {
            if (window._gaDocGateDepth > 0) {
                console.warn(
                    "[busy] doc gate safety clear after timeout; depth was",
                    window._gaDocGateDepth
                );
                window._gaDocGateDepth = 0;
                window.setDocLoadStatus(null);
            }
            window._gaDocGateSafetyTimer = null;
        }, GA_DOC_GATE_SAFETY_MS);
    }
};

window.endDocGate = function() {
    window._gaDocGateDepth = Math.max(0, (window._gaDocGateDepth || 0) - 1);
    if (window._gaDocGateDepth === 0) {
        if (window._gaDocGateSafetyTimer) {
            clearTimeout(window._gaDocGateSafetyTimer);
            window._gaDocGateSafetyTimer = null;
        }
        window.setDocLoadStatus(null);
    }
};

// Console escape hatch: forceClearAppBusy() if the universe glitches
window.forceClearAppBusy = function() {
    window._gaDocGateDepth = 0;
    if (window._gaDocGateSafetyTimer) {
        clearTimeout(window._gaDocGateSafetyTimer);
        window._gaDocGateSafetyTimer = null;
    }
    window.setDocLoadStatus(null);
    window.hideLoading();
};

window.showLoading = function(message) {
    let loader = document.getElementById("ga-export-loader");
    if (!loader) {
        loader = document.createElement("div");
        loader.id = "ga-export-loader";
        // Under modals (1e6), over the rest of the chrome. Yes, magic z-index. Sue me later.
        loader.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); color:white; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:99999; font-family:sans-serif; font-size:18px; font-weight:bold;";
        loader.innerHTML = `
            <style>@keyframes ga-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            <div style="margin-bottom:20px; border:5px solid rgba(255,255,255,0.2); border-top:5px solid #0af; border-radius:50%; width:50px; height:50px; animation:ga-spin 1s linear infinite;"></div>
            <div id="ga-export-text"></div>
        `;
        document.body.appendChild(loader);
    }
    const textEl = document.getElementById("ga-export-text");
    if (textEl) textEl.innerText = message || "Working…";
    loader.style.display = "flex";
    loader.setAttribute("aria-busy", "true");
    loader.setAttribute("role", "alert");
    window._gaOverlayBusy = true;
};

window.hideLoading = function() {
    const loader = document.getElementById("ga-export-loader");
    if (loader) {
        loader.style.display = "none";
        loader.removeAttribute("aria-busy");
    }
    window._gaOverlayBusy = false;
    // Overlay off ≠ gate off. Soft gate may still be babysitting save/print.
};

// Helper to let the browser breathe so the UI can actually update
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 15));

const stripPdfBaseName = (name) =>
    String(name || "document").replace(/(?:\.(?:pdf|gapdf)|\s*\(\d+\)\s*)+$/ig, "").trim() || "document";

const ensureExtension = (name, ext) => {
    const clean = String(name || "").trim();
    if (!clean) return `document${ext}`;
    return clean.toLowerCase().endsWith(ext.toLowerCase()) ? clean : `${clean}${ext}`;
};

const canvasToPngBytes = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error("canvas.toBlob returned null"));
        try {
            resolve(new Uint8Array(await blob.arrayBuffer()));
        } catch (e) {
            reject(e);
        }
    }, "image/png");
});

/**
 * Acquire a save destination WHILE user activation is still fresh.
 * Call this before long async work (html2canvas, pdf-lib save, etc).
 * @returns {null|object} null if cancelled
 */
window.acquireSaveDestination = async function({
    defaultFileName,
    description,
    accept,
    extension,
    filterName,
    filterExtensions,
    modalTitle
}) {
    const ext = extension.startsWith(".") ? extension : `.${extension}`;

    // 1) Tauri native dialog
    if (window.__TAURI__?.dialog?.save) {
        try {
            const filePath = await window.__TAURI__.dialog.save({
                defaultPath: defaultFileName,
                filters: [{
                    name: filterName || description,
                    extensions: filterExtensions || [ext.replace(".", "")]
                }]
            });
            if (!filePath) return null; // user cancelled
            return { kind: "tauri", filePath };
        } catch (e) {
            console.warn("Tauri save dialog failed, falling back to web:", e);
        }
    }

    // 2) Chromium File System Access API (must run under user gesture)
    if (typeof window.showSaveFilePicker === "function") {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: defaultFileName,
                types: [{ description, accept }]
            });
            return { kind: "handle", fileHandle };
        } catch (err) {
            if (err && err.name === "AbortError") return null;
            // NotAllowedError after long work, unsupported options, insecure context, etc.
            console.warn("showSaveFilePicker failed, using download modal:", err);
        }
    }

    // 3) Firefox / Safari / fallback: custom name modal + <a download>
    window.hideLoading();
    const userName = await window.promptSaveAsName(
        defaultFileName,
        modalTitle || "💾 Save File As"
    );
    if (!userName) return null;
    return { kind: "download", fileName: ensureExtension(userName, ext) };
};

/**
 * Write a Blob to a previously acquired destination.
 */
window.writeSaveDestination = async function(dest, blob) {
    if (!dest) return false;

    if (dest.kind === "tauri") {
        const fsApi = window.__TAURI__.fs;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (typeof fsApi?.writeBinaryFile === "function") {
            await fsApi.writeBinaryFile(dest.filePath, bytes);
        } else if (typeof fsApi?.writeFile === "function") {
            await fsApi.writeFile(dest.filePath, bytes);
        } else {
            throw new Error("Tauri fs write API not available");
        }
        return true;
    }

    if (dest.kind === "handle") {
        const writable = await dest.fileHandle.createWritable();
        try {
            await writable.write(blob);
        } finally {
            await writable.close();
        }
        return true;
    }

    if (dest.kind === "download") {
        const link = document.createElement("a");
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = dest.fileName;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
        return true;
    }

    return false;
};

// ==========================================
// io.js: JSON SERIALIZATION & DESERIALIZATION
// ==========================================

window.pendingProjectData = null;

// === Serializer ===
window.exportProject = async function() {
    if (window.isAppBusy && window.isAppBusy()) {
        return window.customAlert(
            "Please wait for the current operation to finish before saving.",
            "⏳ Still working"
        );
    }
    const viewer = (APP.DOM && APP.DOM.viewer) || document.getElementById("viewer");
    const wrappers = viewer ? viewer.querySelectorAll(".pageWrapper") : document.querySelectorAll(".pageWrapper");
    if (wrappers.length === 0) return window.customAlert("No PDF pages found.");

    const baseName = stripPdfBaseName(window.currentPdfName);
    const defaultFileName = `${baseName}.gapdf`;

    // Acquire destination first (user gesture still valid)
    const dest = await window.acquireSaveDestination({
        defaultFileName,
        description: "GA PDF Project",
        accept: { "application/octet-stream": [".gapdf"] },
        extension: ".gapdf",
        filterName: "GA PDF Project",
        filterExtensions: ["gapdf"],
        modalTitle: "💾 Save Project As"
    });
    if (!dest) return;

    try {
        window.showLoading("Building project file...");
        await yieldToMain();

        const { PDFDocument } = window.PDFLib || PDFLib;
        const mergedPdf = await PDFDocument.create();
        const loadedSourceDocs = {};

        const schema = {
            version: "3.1",
            pdfName: defaultFileName,
            pages: [],
            // Rolling change insight (not a legal e-sign trail; see project-audit.js)
            audit: []
        };

        for (let i = 0; i < wrappers.length; i++) {
            if (i % 5 === 0) {
                window.showLoading(`Packing page ${i + 1} of ${wrappers.length}...`);
                await yieldToMain();
            }

            const wrapper = wrappers[i];
            const fingerprint = wrapper.dataset.pdfFingerprint;
            const origPageNum = parseInt(wrapper.dataset.pageId.split("_page_").pop(), 10) - 1;

            if (!loadedSourceDocs[fingerprint]) {
                const rawBytes = window.sourcePdfBuffers[fingerprint];
                if (rawBytes) {
                    try {
                        loadedSourceDocs[fingerprint] = typeof window.loadSourcePdfDocForExport === "function"
                            ? await window.loadSourcePdfDocForExport(rawBytes, fingerprint)
                            : await PDFDocument.load(rawBytes, { ignoreEncryption: true });
                    } catch (e) {
                        console.warn("Could not load source document:", e);
                    }
                }
            }

            try {
                if (loadedSourceDocs[fingerprint]) {
                    const [copiedPage] = await mergedPdf.copyPages(loadedSourceDocs[fingerprint], [origPageNum]);
                    mergedPdf.addPage(copiedPage);
                } else {
                    throw new Error("Missing source doc");
                }
            } catch (e) {
                console.warn(`Error copying page ${origPageNum}. Inserting blank fallback.`, e);
                mergedPdf.addPage([
                    parseFloat(wrapper.dataset.baseWidth) || 600,
                    parseFloat(wrapper.dataset.baseHeight) || 800
                ]);
            }

            const pageData = {
                pageIndex: i,
                pageName: wrapper.dataset.pageName,
                pageId: wrapper.dataset.pageId || null,
                originalPageNum: wrapper.dataset.originalPageNum
                    ? parseInt(wrapper.dataset.originalPageNum, 10)
                    : null,
                overlays: []
            };
            const overlays = wrapper.querySelectorAll(".overlayImg, .textOverlay, .shapeOverlay, .formFieldOverlay");

            overlays.forEach(overlay => {
                const x = parseFloat(overlay.style.left);
                const y = parseFloat(overlay.style.top);
                const w = overlay.style.width === "max-content" ? "max-content" : parseFloat(overlay.style.width);
                const h = overlay.style.height === "auto" ? "auto" : parseFloat(overlay.style.height);

                let objData = { x, y, w, h, id: overlay.id || crypto.randomUUID() };

                if (overlay.classList.contains("formFieldOverlay")) {
                    const snap = typeof window.serializeFormFieldElement === "function"
                        ? window.serializeFormFieldElement(overlay)
                        : null;
                    if (snap) {
                        objData = Object.assign(objData, snap);
                        // geometry already on snap; keep id from overlay when present
                        if (overlay.id) objData.id = overlay.id;
                    } else {
                        objData.type = "formField";
                        objData.fieldType = overlay.dataset.fieldType || "text";
                        objData.fieldName = overlay.dataset.fieldName || "";
                        objData.required = overlay.dataset.required === "1";
                        objData.multiline = overlay.dataset.multiline === "1";
                        objData.defaultValue = overlay.dataset.defaultValue || "";
                        objData.fontSize = parseFloat(overlay.dataset.fontSize) || 12;
                        if (overlay.dataset.nativeId) objData.nativeId = overlay.dataset.nativeId;
                        if (overlay.dataset.importedNative) objData.importedNative = "1";
                        if (objData.fieldType === "radio") {
                            objData.optionValue = overlay.dataset.optionValue || "";
                        }
                        if (objData.fieldType === "dropdown") {
                            try { objData.options = JSON.parse(overlay.dataset.options || "[]"); }
                            catch (_) { objData.options = []; }
                        }
                    }
                } else if (overlay.classList.contains("textOverlay")) {
                    objData.type = "text";
                    const textContent = overlay.querySelector(".textContent");
                    objData.content = textContent ? textContent.innerHTML : overlay.innerHTML;
                    objData.styles = {
                        fontFamily: overlay.style.fontFamily,
                        fontSize: parseFloat(overlay.style.fontSize),
                        color: overlay.style.color,
                        fontWeight: overlay.style.fontWeight,
                        lineHeight: overlay.style.lineHeight,
                        backgroundColor: overlay.style.backgroundColor,
                        border: overlay.style.border,
                        transform: overlay.style.transform,
                        minWidth: overlay.style.minWidth,
                        minHeight: overlay.style.minHeight,
                        boxSizing: overlay.style.boxSizing,
                        display: overlay.style.display,
                        paddingRight: overlay.style.paddingRight,
                        textAlign: textContent ? textContent.style.textAlign : overlay.style.textAlign,
                        textAlignLast: textContent ? textContent.style.textAlignLast : overlay.style.textAlignLast,
                        whiteSpace: textContent ? textContent.style.whiteSpace : overlay.style.whiteSpace,
                        overflowWrap: textContent ? textContent.style.overflowWrap : overlay.style.overflowWrap
                    };
                } else if (overlay.classList.contains("overlayImg")) {
                    objData.type = "image";
                    const img = overlay.querySelector("img");
                    if (img) objData.src = img.src;
                    if (overlay.style.transform) {
                        objData.styles = { transform: overlay.style.transform };
                    }
                } else if (overlay.classList.contains("shape-table")) {
                    objData.type = "table";
                    objData.dataset = { ...overlay.dataset };
                    if (overlay.style.transform) {
                        objData.styles = { transform: overlay.style.transform };
                    }
                } else if (overlay.classList.contains("shapeOverlay")) {
                    objData.type = "shape";
                    objData.shapeClass = overlay.className.includes("shape-circle") ? "circle"
                        : overlay.className.includes("shape-rect") ? "rect"
                        : "line";
                    objData.styles = {
                        backgroundColor: overlay.style.backgroundColor,
                        border: overlay.style.border,
                        borderRadius: overlay.style.borderRadius,
                        transform: overlay.style.transform,
                        transformOrigin: overlay.style.transformOrigin
                    };
                }
                pageData.overlays.push(objData);
            });

            // Always record the page so restore page-matching stays stable,
            // even when all overlays were deleted.
            schema.pages.push(pageData);
        }

        // Forms: copyPages alone does not produce a reloadable AcroForm — always re-embed
        // when designer shells (or native widgets) are present.
        const wrapperListProj = Array.from(wrappers);
        const viewerProj = viewer || (APP.DOM && APP.DOM.viewer) || document;
        if (typeof window.syncDesignerFormValuesFromNatives === "function") {
            try { window.syncDesignerFormValuesFromNatives(viewerProj); } catch (_) { /* ignore */ }
        }
        let formJobsProj = typeof window.collectDesignerFormFieldsFromWrappers === "function"
            ? window.collectDesignerFormFieldsFromWrappers(wrapperListProj)
            : [];
        let designerCountProj = formJobsProj.reduce((n, j) => n + (j.fields ? j.fields.length : 0), 0);
        if (designerCountProj === 0 && typeof window.collectNativeFormFieldsFromWrappers === "function") {
            formJobsProj = window.collectNativeFormFieldsFromWrappers(wrapperListProj) || [];
            designerCountProj = formJobsProj.reduce((n, j) => n + (j.fields ? j.fields.length : 0), 0);
        }

        const domShellsProj = viewerProj.querySelectorAll
            ? viewerProj.querySelectorAll(".formFieldOverlay").length
            : 0;
        console.log("[exportProject] form snapshot=", designerCountProj, "domShells=", domShellsProj);

        if (designerCountProj > 0) {
            schema.formFieldsManaged = true;
            window.showLoading(`Writing ${designerCountProj} form field(s) into project...`);
            await yieldToMain();

            if (window.embedAllFormFields) {
                let formFont = null;
                try {
                    const { StandardFonts } = window.PDFLib || PDFLib;
                    formFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
                } catch (_) { /* optional */ }
                const embedded = await window.embedAllFormFields(mergedPdf, wrapperListProj, formFont, formJobsProj);
                console.log("[exportProject] embedded widgets=", embedded);
                if (embedded === 0) {
                    console.error("[exportProject] DOM had", designerCountProj, "fields but embed wrote 0");
                }
            }
        } else if (domShellsProj > 0) {
            console.error("[exportProject] CRITICAL: dom shells but snapshot 0");
        }

        window.showLoading("Compressing project state...");
        await yieldToMain();

        if (typeof window.getProjectAuditForSave === "function") {
            schema.audit = await window.getProjectAuditForSave();
        }
        if (typeof window.logProjectAudit === "function") {
            window.logProjectAudit("SAVE_PROJECT", {
                pages: wrappers.length,
                auditEntries: Array.isArray(schema.audit) ? schema.audit.length : 0
            });
            // Include this save in the next open; re-snapshot after log
            if (typeof window.getProjectAuditForSave === "function") {
                schema.audit = await window.getProjectAuditForSave();
            }
        }

        const mergedBytes = await mergedPdf.save();
        const jsonStr = JSON.stringify(schema);
        const compressed = await window.compressData(jsonStr);
        const hash = await window.computeHash(compressed);
        const marker = "\n---GA-SAVE-STATE---";
        const delim = "---HASH-DELIM---";
        const payloadBlob = new Blob([marker, hash, delim, compressed]);
        const finalBlob = new Blob([mergedBytes, payloadBlob], { type: "application/octet-stream" });

        window.showLoading("Writing file...");
        await yieldToMain();
        await window.writeSaveDestination(dest, finalBlob);

        window.historyEngine.savePoint = window.historyEngine.undoStack.length;
    } catch (err) {
        console.error("exportProject failed:", err);
        window.hideLoading();
        await window.customAlert("An error occurred while saving the project file.");
        return;
    }

    window.hideLoading();
};

/**
 * Load a script once (works on file:// — script tags are not subject to wasm CORS).
 * Used to pull base64-embedded binaries without fetch/XHR.
 */
window.loadScriptOnce = function(src) {
    window._loadedScripts = window._loadedScripts || {};
    if (window._loadedScripts[src]) return window._loadedScripts[src];
    window._loadedScripts[src] = new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src="' + src + '"]');
        if (existing) {
            if (existing.dataset.loaded === "1") return resolve();
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Failed to load " + src)), { once: true });
            return;
        }
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => { s.dataset.loaded = "1"; resolve(); };
        s.onerror = () => reject(new Error("Failed to load " + src));
        document.head.appendChild(s);
    });
    return window._loadedScripts[src];
};

/**
 * Build a blob: URL for qpdf.wasm from the base64 embed (file:// safe).
 * Emscripten can fetch/instantiate blob URLs; raw file:// .wasm is CORS-blocked.
 */
window.resolveQpdfWasmUrl = function() {
    if (window._qpdfWasmBlobUrl) return window._qpdfWasmBlobUrl;

    if (typeof window.__QPDF_WASM_B64 === "string" && window.__QPDF_WASM_B64.length > 0) {
        const decode = window.b64ToUint8Array || function(b64) {
            const bin = atob(b64);
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        };
        const bytes = decode(window.__QPDF_WASM_B64);
        const blob = new Blob([bytes], { type: "application/wasm" });
        window._qpdfWasmBlobUrl = URL.createObjectURL(blob);
        return window._qpdfWasmBlobUrl;
    }

    const scriptEl = document.querySelector('script[src*="qpdf.js"]');
    const scriptSrc = scriptEl ? scriptEl.src : "";
    if (scriptSrc) {
        return scriptSrc.replace(/qpdf\.js(\?.*)?$/i, "qpdf.wasm$1");
    }
    return new URL("lib/qpdf/qpdf.wasm", window.location.href).href;
};

/**
 * Lazy-init QPDF (WASM). Content-preserving encryption — keeps AcroForm fields.
 */
window.getQpdfInstance = async function() {
    if (window._qpdfInstance) return window._qpdfInstance;

    const factory = window.QpdfModule || window.Module;
    if (typeof factory !== "function") {
        throw new Error("qpdf WASM module is not loaded.");
    }

    // file:// cannot fetch .wasm — pull the base64 embed via <script> first
    if (window.location.protocol === "file:" && !window.__QPDF_WASM_B64) {
        try {
            await window.loadScriptOnce("./lib/qpdf/qpdf.wasm.embed.js");
        } catch (e) {
            console.error(e);
            throw new Error(
                "PDF encryption needs lib/qpdf/qpdf.wasm.embed.js when opening via file:// " +
                "(browsers block loading .wasm from file URLs). Serve over http(s), use Tauri, " +
                "or restore the embed asset."
            );
        }
    }

    if (window.location.protocol === "file:" && !window.__QPDF_WASM_B64) {
        throw new Error(
            "PDF encryption embed loaded but window.__QPDF_WASM_B64 is empty. " +
            "Regenerate lib/qpdf/qpdf.wasm.embed.js from lib/qpdf/qpdf.wasm."
        );
    }

    const wasmUrl = window.resolveQpdfWasmUrl();

    window._qpdfInstance = await factory({
        locateFile: (file) => (String(file).endsWith(".wasm") ? wasmUrl : file),
        noInitialRun: true
    });
    return window._qpdfInstance;
};

/**
 * Decrypt password-protected PDF bytes with QPDF (client-side).
 * Used so export/project save can copyPages real content — pdf-lib's
 * ignoreEncryption loads structure but leaves page content blank.
 *
 * @param {Uint8Array|ArrayBuffer} pdfBytes
 * @param {string} userPassword
 * @returns {Promise<Uint8Array>}
 */
window.decryptPdfBytes = async function(pdfBytes, userPassword) {
    const password = String(userPassword || "");
    if (!password) throw new Error("Password is required for decryption.");

    const qpdf = await window.getQpdfInstance();
    const inPath = "/ga_decrypt_in.pdf";
    const outPath = "/ga_decrypt_out.pdf";
    const bytes = pdfBytes instanceof Uint8Array
        ? pdfBytes
        : new Uint8Array(pdfBytes instanceof ArrayBuffer ? pdfBytes : pdfBytes);

    try { qpdf.FS.unlink(inPath); } catch (_) { /* ok */ }
    try { qpdf.FS.unlink(outPath); } catch (_) { /* ok */ }

    qpdf.FS.writeFile(inPath, bytes);

    const args = [
        "--password=" + password,
        "--decrypt",
        inPath,
        outPath
    ];

    let code;
    try {
        code = qpdf.callMain(args);
    } catch (e) {
        console.error("qpdf decrypt threw", e);
        throw new Error("PDF decryption failed.");
    }

    if (code !== 0 && code !== undefined && code !== null && Number(code) !== 0) {
        throw new Error("PDF decryption failed (qpdf exit " + code + ").");
    }

    let out;
    try {
        out = qpdf.FS.readFile(outPath);
    } catch (e) {
        throw new Error("PDF decryption failed: no output file produced.");
    }

    try { qpdf.FS.unlink(inPath); } catch (_) { /* ok */ }
    try { qpdf.FS.unlink(outPath); } catch (_) { /* ok */ }

    return out instanceof Uint8Array ? out : new Uint8Array(out);
};

/**
 * Load source PDF bytes for page copy on export/project save.
 * Prefers cleartext; decrypts only with a password stored for THIS fingerprint
 * (never a sticky global password from another document).
 *
 * @param {ArrayBuffer|Uint8Array} rawBytes
 * @param {string} [fingerprint]
 * @returns {Promise<*>} pdf-lib PDFDocument
 */
window.loadSourcePdfDocForExport = async function(rawBytes, fingerprint) {
    const PDFLibNS = window.PDFLib || PDFLib;
    const { PDFDocument } = PDFLibNS;
    if (!rawBytes) throw new Error("Missing source PDF bytes");

    const toU8 = (b) => {
        if (b instanceof Uint8Array) return b;
        if (b instanceof ArrayBuffer) return new Uint8Array(b);
        if (b && b.buffer) return new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
        return new Uint8Array(b);
    };

    const tryLoad = async (bytes, opts) => PDFDocument.load(bytes, opts || {});

    // 1) Normal load (cleartext / already-decrypted buffers)
    try {
        return await tryLoad(rawBytes);
    } catch (e1) {
        console.log("[loadSourcePdfDocForExport] cleartext load failed:", e1 && e1.message);
    }

    // 2) Decrypt only if we know THIS fingerprint was unlocked with a password
    const pwMap = window._gaPdfPasswordByFingerprint || {};
    const pw = (fingerprint && pwMap[fingerprint]) || null;
    if (pw && typeof window.decryptPdfBytes === "function") {
        try {
            const dec = await window.decryptPdfBytes(toU8(rawBytes), pw);
            if (fingerprint && window.sourcePdfBuffers) {
                const ab = dec.buffer.slice(dec.byteOffset, dec.byteOffset + dec.byteLength);
                window.sourcePdfBuffers[fingerprint] = ab;
            }
            return await tryLoad(dec);
        } catch (e2) {
            console.warn("[loadSourcePdfDocForExport] decrypt failed", e2);
        }
    }

    // 3) Last resort — structure only (often blank page content if still encrypted)
    console.warn("[loadSourcePdfDocForExport] falling back to ignoreEncryption (pages may be blank)");
    return tryLoad(rawBytes, { ignoreEncryption: true });
};

/**
 * Password-protect finished PDF bytes using QPDF (client-side, offline).
 * Preserves structure including fillable AcroForm fields.
 *
 * @param {Uint8Array} pdfBytes  Unencrypted PDF
 * @param {string} userPassword
 * @returns {Promise<Uint8Array>}
 */
window.encryptPdfBytes = async function(pdfBytes, userPassword) {
    const password = String(userPassword || "");
    if (!password) throw new Error("Password is required for encryption.");

    const qpdf = await window.getQpdfInstance();
    const inPath = "/ga_encrypt_in.pdf";
    const outPath = "/ga_encrypt_out.pdf";
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

    try { qpdf.FS.unlink(inPath); } catch (_) { /* ok */ }
    try { qpdf.FS.unlink(outPath); } catch (_) { /* ok */ }

    qpdf.FS.writeFile(inPath, bytes);

    // AES-256; keep AcroForm fillable after open.
    // Use --modify=all (not annotate-only): some readers treat annotate as
    // "comments only" and refuse interactive form fill even when widgets exist.
    // See: qpdf --encrypt user owner keylen [restrictions] -- in out
    const args = [
        "--encrypt", password, password, "256",
        "--print=full",
        "--modify=all",
        "--extract=y",
        "--accessibility=y",
        "--",
        inPath,
        outPath
    ];

    let code;
    try {
        code = qpdf.callMain(args);
    } catch (e) {
        console.error("qpdf.callMain threw", e);
        throw new Error("PDF encryption failed. Try again or export without a password.");
    }

    if (code !== 0 && code !== undefined && code !== null) {
        // Some builds return undefined on success; non-zero is failure
        if (Number(code) !== 0) {
            throw new Error("PDF encryption failed (qpdf exit " + code + ").");
        }
    }

    let out;
    try {
        out = qpdf.FS.readFile(outPath);
    } catch (e) {
        throw new Error("PDF encryption failed: no output file produced.");
    }

    try { qpdf.FS.unlink(inPath); } catch (_) { /* ok */ }
    try { qpdf.FS.unlink(outPath); } catch (_) { /* ok */ }

    return out instanceof Uint8Array ? out : new Uint8Array(out);
};

/**
 * Ensure a page has an /Annots array pdf-lib can push widgets onto.
 * After stripping widgets we used to `node.delete(Annots)`, which leaves
 * normalizedEntries().Annots === undefined and makes addToPage throw:
 *   can't access property "push", this.normalizedEntries().Annots is undefined
 *
 * @param {*} pdfDoc
 * @param {*} page pdf-lib PDFPage
 * @returns {boolean}
 */
window.ensurePdfPageAnnotsArray = function(pdfDoc, page) {
    if (!pdfDoc || !page || !page.node) return false;
    const PDFLibNS = window.PDFLib || (typeof PDFLib !== "undefined" ? PDFLib : null);
    const PDFName = PDFLibNS && PDFLibNS.PDFName;
    const PDFArray = PDFLibNS && PDFLibNS.PDFArray;
    if (!PDFName || !pdfDoc.context) return false;

    const node = page.node;
    const key = PDFName.of("Annots");

    try {
        // Already a usable array?
        let annots = null;
        try {
            if (typeof node.Annots === "function") annots = node.Annots();
        } catch (_) { /* ignore */ }
        if (!annots && typeof node.lookupMaybe === "function" && PDFArray) {
            try { annots = node.lookupMaybe(key, PDFArray); } catch (_) { /* ignore */ }
        }
        if (annots && typeof annots.push === "function") return true;
        if (annots && typeof annots.size === "function") return true;
    } catch (_) { /* recreate below */ }

    try {
        const empty = pdfDoc.context.obj([]);
        if (typeof node.set === "function") {
            node.set(key, empty);
            return true;
        }
    } catch (e) {
        console.warn("[ensurePdfPageAnnotsArray]", e);
    }
    return false;
};

/**
 * Ensure every page in the document has a pushable /Annots array.
 * Call after strip, before any addToPage / addOptionToPage.
 */
window.ensureAllPdfPagesAnnotsArrays = function(pdfDoc) {
    if (!pdfDoc || typeof pdfDoc.getPages !== "function") return 0;
    let n = 0;
    try {
        pdfDoc.getPages().forEach((page) => {
            if (window.ensurePdfPageAnnotsArray(pdfDoc, page)) n++;
        });
    } catch (e) {
        console.warn("[ensureAllPdfPagesAnnotsArrays]", e);
    }
    return n;
};

/**
 * Drop pdf-lib's cached PDFForm so the next getForm() rebuilds against the
 * live catalog. Required only after /AcroForm was removed from the catalog.
 *
 * @param {*} pdfDoc pdf-lib PDFDocument
 */
window.invalidatePdfFormCache = function(pdfDoc) {
    if (!pdfDoc) return;
    try {
        // formCache is private in TS but present at runtime on pdf-lib builds we ship.
        if (pdfDoc.formCache && typeof pdfDoc.formCache.invalidate === "function") {
            pdfDoc.formCache.invalidate();
        }
    } catch (e) {
        console.warn("[invalidatePdfFormCache]", e);
    }
};

/** True if the document catalog currently has an /AcroForm entry. */
window.pdfDocHasCatalogAcroForm = function(pdfDoc) {
    if (!pdfDoc || !pdfDoc.catalog) return false;
    try {
        const PDFLibNS = window.PDFLib || (typeof PDFLib !== "undefined" ? PDFLib : null);
        const PDFName = PDFLibNS && PDFLibNS.PDFName;
        if (!PDFName) return false;
        const key = PDFName.of("AcroForm");
        if (typeof pdfDoc.catalog.has === "function" && pdfDoc.catalog.has(key)) return true;
        if (typeof pdfDoc.catalog.get === "function" && pdfDoc.catalog.get(key)) return true;
        if (typeof pdfDoc.catalog.lookup === "function" && pdfDoc.catalog.lookup(key)) return true;
        if (typeof pdfDoc.catalog.AcroForm === "function" && pdfDoc.catalog.AcroForm()) return true;
    } catch (_) { /* ignore */ }
    return false;
};

/**
 * Return a PDFForm that is attached to the catalog (safe for create* + save).
 * Fixes the orphan-form case: formCache still holds a PDFForm after /AcroForm
 * was deleted, so createTextField would write into a dict that never saves.
 *
 * @param {*} pdfDoc
 * @returns {*} PDFForm
 */
window.getLivePdfForm = function(pdfDoc) {
    if (!pdfDoc) return null;
    try {
        const cached = pdfDoc.formCache && typeof pdfDoc.formCache.getValue === "function"
            ? pdfDoc.formCache.getValue()
            : null;
        const catalogHas = window.pdfDocHasCatalogAcroForm(pdfDoc);
        // Orphan: cache points at a form but catalog no longer has AcroForm
        if (cached && !catalogHas) {
            window.invalidatePdfFormCache(pdfDoc);
        }
        // No form yet / after full strip — getForm creates a fresh catalog AcroForm
        return pdfDoc.getForm();
    } catch (e) {
        console.warn("[getLivePdfForm]", e);
        try {
            window.invalidatePdfFormCache(pdfDoc);
            return pdfDoc.getForm();
        } catch (e2) {
            console.warn("[getLivePdfForm] retry failed", e2);
            return null;
        }
    }
};

/**
 * Remove interactive form fields / widgets from a pdf-lib document.
 *
 * copyPages keeps page Widget annotations even when getForm() shows 0 fields.
 * form.removeField() alone is not enough.
 *
 * @param {*} pdfDoc pdf-lib PDFDocument
 * @param {{ prepareForReembed?: boolean }} [opts]
 *   prepareForReembed: true  → clear fields/widgets but KEEP a live catalog
 *   AcroForm so createTextField/etc. write into the document that will be saved.
 *   prepareForReembed: false → also drop /AcroForm (delete-all / gapdf strip-only).
 * @returns {{ fields: number, widgets: number }}
 */
window.stripAcroFormFieldsFromPdfDoc = function(pdfDoc, opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const prepareForReembed = !!options.prepareForReembed;
    const result = { fields: 0, widgets: 0 };
    if (!pdfDoc) return result;

    const PDFLibNS = window.PDFLib || (typeof PDFLib !== "undefined" ? PDFLib : null);
    const PDFName = PDFLibNS && PDFLibNS.PDFName;
    const PDFArray = PDFLibNS && PDFLibNS.PDFArray;
    const nameOf = (n) => (PDFName ? PDFName.of(n) : null);

    // === Form API ===
    let formRef = null;
    try {
        // Prefer live form; if catalog has no AcroForm yet, getForm creates one
        // (empty). That is fine — we will clear it and either keep or delete it.
        formRef = pdfDoc.getForm();
        const fields = formRef.getFields().slice();
        for (let i = 0; i < fields.length; i++) {
            try {
                formRef.removeField(fields[i]);
                result.fields++;
            } catch (e) {
                console.warn("[stripAcroForm] removeField failed", e);
            }
        }
        try {
            formRef.getFields().slice().forEach((f) => {
                try { formRef.removeField(f); result.fields++; } catch (_) { /* ignore */ }
            });
        } catch (_) { /* ignore */ }

        // Empty /Fields so leftover names cannot block re-create
        try {
            const acro = formRef.acroForm;
            if (acro && acro.dict && PDFName) {
                acro.dict.set(nameOf("Fields"), pdfDoc.context.obj([]));
                if (typeof acro.dict.delete === "function") {
                    try { acro.dict.delete(nameOf("XFA")); } catch (_) { /* ignore */ }
                }
            }
        } catch (e) {
            console.warn("[stripAcroForm] clear Fields failed", e);
        }
    } catch (e) {
        console.warn("[stripAcroForm] getForm failed", e);
    }

    // === Widget annotations ===
    try {
        const pages = pdfDoc.getPages();

        for (let p = 0; p < pages.length; p++) {
            const page = pages[p];
            const node = page.node;
            if (!node) continue;

            let annots = null;
            try {
                if (typeof node.Annots === "function") annots = node.Annots();
            } catch (_) { /* ignore */ }

            if (!annots && PDFName && typeof node.lookupMaybe === "function") {
                try {
                    annots = node.lookupMaybe(nameOf("Annots"), PDFArray);
                } catch (_) { /* ignore */ }
            }

            if (!annots) continue;

            const widgetRefs = [];
            const size = typeof annots.size === "function" ? annots.size() : 0;
            for (let i = 0; i < size; i++) {
                let ref;
                try { ref = annots.get(i); } catch (_) { continue; }
                if (!ref) continue;

                let dict = null;
                try {
                    dict = pdfDoc.context.lookup(ref);
                } catch (_) {
                    try { dict = ref; } catch (__) { /* ignore */ }
                }
                if (!dict || typeof dict.get !== "function") continue;

                let subtype = null;
                try {
                    subtype = dict.get(nameOf("Subtype"));
                } catch (_) { /* ignore */ }

                let subStr = "";
                try {
                    if (subtype && typeof subtype.toString === "function") subStr = subtype.toString();
                    else if (subtype && typeof subtype.encodedName === "string") subStr = subtype.encodedName;
                    else if (subtype != null) subStr = String(subtype);
                } catch (_) { subStr = ""; }

                if (/Widget/i.test(subStr)) {
                    widgetRefs.push(ref);
                }
            }

            for (let w = widgetRefs.length - 1; w >= 0; w--) {
                const ref = widgetRefs[w];
                try {
                    if (typeof node.removeAnnot === "function") {
                        node.removeAnnot(ref);
                        result.widgets++;
                    } else if (typeof annots.indexOf === "function" && typeof annots.remove === "function") {
                        const idx = annots.indexOf(ref);
                        if (idx !== undefined && idx !== -1 && idx >= 0) {
                            annots.remove(idx);
                            result.widgets++;
                        }
                    }
                } catch (e) {
                    console.warn("[stripAcroForm] removeAnnot failed", e);
                }
            }

            // Do NOT delete /Annots when empty. pdf-lib addToPage does
            //   this.normalizedEntries().Annots.push(...)
            // and throws if Annots is undefined after a full delete.
            // Leave an empty Annots array (or recreate one) so re-embed works.
            try {
                if (typeof window.ensurePdfPageAnnotsArray === "function") {
                    window.ensurePdfPageAnnotsArray(pdfDoc, page);
                }
            } catch (_) { /* ignore */ }
        }
    } catch (e) {
        console.warn("[stripAcroForm] page Annots pass failed", e);
    }

    // === Catalog cleanup ===
    if (prepareForReembed) {
        // KEEP catalog /AcroForm and formCache so subsequent create* writes
        // into a form that save() will actually serialize.
        // Ensure AcroForm exists (getForm creates it if strip pass1 never ran).
        try {
            if (!window.pdfDocHasCatalogAcroForm(pdfDoc)) {
                window.invalidatePdfFormCache(pdfDoc);
                pdfDoc.getForm();
            }
        } catch (e) {
            console.warn("[stripAcroForm] ensure AcroForm for re-embed", e);
        }
    } else {
        // Full wipe: drop /AcroForm and drop stale form cache (project delete-all).
        try {
            if (PDFName && pdfDoc.catalog && typeof pdfDoc.catalog.delete === "function") {
                try { pdfDoc.catalog.delete(nameOf("AcroForm")); } catch (_) { /* ignore */ }
            }
        } catch (e) {
            console.warn("[stripAcroForm] catalog cleanup", e);
        }
        window.invalidatePdfFormCache(pdfDoc);
    }

    console.log(
        "[stripAcroForm] removed fields=", result.fields,
        "widgets=", result.widgets,
        "prepareForReembed=", prepareForReembed
    );
    return result.fields + result.widgets;
};

// === Export to PDF ===
// exportScaleOrOpts: number (legacy) or { exportScale, password }
window.exportPdf = async function(exportScaleOrOpts = 2) {
    if (window.isAppBusy && window.isAppBusy()) {
        return window.customAlert(
            "Please wait for the current operation to finish before exporting.",
            "⏳ Still working"
        );
    }
    const opts = (typeof exportScaleOrOpts === "object" && exportScaleOrOpts !== null)
        ? exportScaleOrOpts
        : { exportScale: exportScaleOrOpts };
    const exportScale = parseFloat(opts.exportScale) || 2;
    const exportPassword = opts.password ? String(opts.password) : "";

    const viewerEl = (APP.DOM && APP.DOM.viewer) || document.getElementById("viewer");
    const wrappers = viewerEl ? viewerEl.querySelectorAll(".pageWrapper") : document.querySelectorAll(".pageWrapper");
    if (wrappers.length === 0) return window.customAlert("No PDF pages found.");

    const hasAnyDecorative = viewerEl
        ? viewerEl.querySelector(".textOverlay, .shapeOverlay, .overlayImg")
        : document.querySelector(".textOverlay, .shapeOverlay, .overlayImg");

    if (hasAnyDecorative && !window.html2canvas) {
        return window.customAlert("Error: html2canvas is not loaded. Please check your index.html scripts.");
    }

    if (exportPassword && typeof window.QpdfModule !== "function" && typeof window.Module !== "function" && !window._qpdfInstance) {
        return window.customAlert(
            "Password protection is unavailable: the encryption module (qpdf) did not load. Export without a password, or contact IT."
        );
    }

    const baseName = stripPdfBaseName(window.currentPdfName);
    const defaultFileName = `${baseName}_Final.pdf`;

    // CRITICAL: open save picker / name modal BEFORE long async work.
    const dest = await window.acquireSaveDestination({
        defaultFileName,
        description: "PDF Document",
        accept: { "application/pdf": [".pdf"] },
        extension: ".pdf",
        filterName: "PDF Document",
        filterExtensions: ["pdf"],
        modalTitle: "💾 Save PDF As"
    });
    if (!dest) return;

    // Avoid burning Form-mode dimming (opacity) into flattened annotations
    const runExport = async () => {
        window.showLoading("Initializing PDF export...");
        await yieldToMain();

        // Always build with main PDFLib so AcroForm fields match the known-good path.
        // Password protection is a post-step via PDFLibEncrypt (see encryptPdfBytes).
        const PDFLibNS = window.PDFLib || PDFLib;
        const { PDFDocument, StandardFonts } = PDFLibNS;
        const mergedPdf = await PDFDocument.create();
        const loadedSourceDocs = {};
        let formFont = null;
        try {
            formFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
        } catch (e) {
            console.warn("Could not embed Helvetica for form appearances:", e);
        }

        if (document.activeElement) document.activeElement.blur();
        if (window.setActiveOverlay) window.setActiveOverlay(null);

        let totalFormFields = 0;

        for (let i = 0; i < wrappers.length; i++) {
            const wrapper = wrappers[i];
            const container = wrapper.querySelector(".pageContainer");
            const fingerprint = wrapper.dataset.pdfFingerprint;
            const origPageNum = parseInt(wrapper.dataset.pageId.split("_page_").pop(), 10) - 1;

            const decorative = container
                ? container.querySelectorAll(".textOverlay, .shapeOverlay, .overlayImg")
                : [];
            const formFields = container
                ? container.querySelectorAll(".formFieldOverlay")
                : [];
            const hasDecorative = decorative.length > 0;
            const hasForms = formFields.length > 0;

            window.showLoading(
                hasDecorative
                    ? `Flattening page ${i + 1} of ${wrappers.length}...`
                    : hasForms
                        ? `Adding form fields (page ${i + 1} of ${wrappers.length})...`
                        : `Copying page ${i + 1} of ${wrappers.length}...`
            );
            await yieldToMain();

            if (!loadedSourceDocs[fingerprint]) {
                const rawBytes = window.sourcePdfBuffers?.[fingerprint];
                if (rawBytes) {
                    try {
                        loadedSourceDocs[fingerprint] = typeof window.loadSourcePdfDocForExport === "function"
                            ? await window.loadSourcePdfDocForExport(rawBytes, fingerprint)
                            : await PDFDocument.load(rawBytes, { ignoreEncryption: true });
                    } catch (e) {
                        console.warn("Could not load source doc:", e);
                    }
                }
            }

            let activePage;
            try {
                if (loadedSourceDocs[fingerprint]) {
                    const [copiedPage] = await mergedPdf.copyPages(loadedSourceDocs[fingerprint], [origPageNum]);
                    activePage = mergedPdf.addPage(copiedPage);
                } else {
                    throw new Error("Missing doc");
                }
            } catch (e) {
                console.warn(`Error copying page for export (fingerprint=${fingerprint}):`, e);
                activePage = mergedPdf.addPage([
                    parseFloat(wrapper.dataset.baseWidth) || 600,
                    parseFloat(wrapper.dataset.baseHeight) || 800
                ]);
            }

            if (!container) continue;

            // 1) Rasterize decorative overlays only (never burn form designer chrome into the PDF)
            if (hasDecorative) {
                const { width: pdfW, height: pdfH } = activePage.getSize();
                const pdfCanvas = container.querySelector("canvas");
                if (pdfCanvas) pdfCanvas.style.visibility = "hidden";

                // Hide form field widgets so they are not flattened as purple boxes
                formFields.forEach(f => { f.style.visibility = "hidden"; });

                const handles = container.querySelectorAll(
                    ".textControls, .textDragHandle, .rotateHandle, .resizeHandle, .deleteHandle"
                );
                handles.forEach(h => { h.style.display = "none"; });

                const originalOutlines = [];
                const originalBlobSrcs = new Map();

                try {
                    for (const o of decorative) {
                        originalOutlines.push(o.style.outline);
                        o.style.outline = "none";
                        o.classList.remove("overlay-active");

                        if (o.classList.contains("overlayImg")) {
                            const img = o.querySelector("img");
                            if (img && img.src.startsWith("blob:")) {
                                originalBlobSrcs.set(img, img.src);
                                try {
                                    const blob = await fetch(img.src).then(r => r.blob());
                                    const base64 = await new Promise((res, rej) => {
                                        const reader = new FileReader();
                                        reader.onloadend = () => res(reader.result);
                                        reader.onerror = rej;
                                        reader.readAsDataURL(blob);
                                    });
                                    img.src = base64;
                                } catch (e) {
                                    console.warn("Failed to convert blob for snapshot", e);
                                }
                            }
                        }
                    }

                    const overlayCanvas = await window.html2canvas(container, {
                        scale: exportScale,
                        backgroundColor: null,
                        useCORS: true,
                        logging: false
                    });

                    try {
                        const pngBytes = await canvasToPngBytes(overlayCanvas);
                        const embeddedImg = await mergedPdf.embedPng(pngBytes);
                        activePage.drawImage(embeddedImg, {
                            x: 0,
                            y: 0,
                            width: pdfW,
                            height: pdfH
                        });
                    } catch (err) {
                        console.warn("Failed to embed layer on page", i, err);
                    }
                } finally {
                    if (pdfCanvas) pdfCanvas.style.visibility = "";
                    formFields.forEach(f => { f.style.visibility = ""; });
                    handles.forEach(h => { h.style.display = ""; });
                    decorative.forEach((o, idx) => {
                        o.style.outline = originalOutlines[idx] || "";
                        if (o.classList.contains("overlayImg")) {
                            const img = o.querySelector("img");
                            if (img && originalBlobSrcs.has(img)) {
                                img.src = originalBlobSrcs.get(img);
                            }
                        }
                    });
                }
            }

        }

        // 2) Form fields — CRITICAL:
        // pdf-lib copyPages leaves page Widget annots but getForm() is empty and
        // save/reload loses fillable fields. Always strip + re-embed from DOM shells.
        const wrapperList = Array.from(wrappers);
        const viewerForForms = viewerEl || document;

        const domShellCount = viewerForForms.querySelectorAll
            ? viewerForForms.querySelectorAll(".formFieldOverlay").length
            : 0;

        if (typeof window.syncDesignerFormValuesFromNatives === "function") {
            try { window.syncDesignerFormValuesFromNatives(viewerForForms); } catch (e) {
                console.warn("[exportPdf] syncDesignerFormValuesFromNatives", e);
            }
        }

        let formJobs = typeof window.collectDesignerFormFieldsFromWrappers === "function"
            ? window.collectDesignerFormFieldsFromWrappers(wrapperList)
            : [];
        let designerCount = formJobs.reduce((n, j) => n + (j.fields ? j.fields.length : 0), 0);

        if (designerCount === 0 && typeof window.collectNativeFormFieldsFromWrappers === "function") {
            formJobs = window.collectNativeFormFieldsFromWrappers(wrapperList) || [];
            designerCount = formJobs.reduce((n, j) => n + (j.fields ? j.fields.length : 0), 0);
            if (designerCount > 0) {
                console.log("[exportPdf] native widget snapshot:", designerCount);
            }
        }

        console.log(
            "[exportPdf] form snapshot=", designerCount,
            "domShells=", domShellCount,
            "pages=", wrapperList.length
        );

        if (designerCount > 0 && window.embedAllFormFields) {
            window.showLoading(`Writing ${designerCount} form field(s)...`);
            await yieldToMain();
            totalFormFields = await window.embedAllFormFields(mergedPdf, wrapperList, formFont, formJobs);
            console.log("[exportPdf] widgets written:", totalFormFields);
        } else if (domShellCount > 0) {
            console.error(
                "[exportPdf] CRITICAL: DOM has", domShellCount,
                "formFieldOverlay shell(s) but snapshot count is 0 — collection failed"
            );
        } else {
            console.warn(
                "[exportPdf] no form shells to re-embed; copyPages AcroForm alone is NOT reliable"
            );
        }

        window.showLoading("Finalizing PDF...");
        await yieldToMain();

        let mergedBytes = await mergedPdf.save({
            updateFieldAppearances: true
        });

        // Verify the bytes we are about to write actually contain form fields
        let verifiedFields = -1;
        if (designerCount > 0 || totalFormFields > 0) {
            try {
                const checkDoc = await PDFDocument.load(mergedBytes);
                verifiedFields = checkDoc.getForm().getFields().length;
                console.log("[exportPdf] verify reload getForm().getFields()=", verifiedFields);
            } catch (ve) {
                console.warn("[exportPdf] verify reload failed", ve);
            }
        }

        let wasEncrypted = false;
        if (exportPassword) {
            window.showLoading("Encrypting PDF (keeping form fields)...");
            await yieldToMain();
            mergedBytes = await window.encryptPdfBytes(mergedBytes, exportPassword);
            wasEncrypted = true;
        }

        const finalBlob = new Blob([mergedBytes], { type: "application/pdf" });

        window.showLoading("Writing file...");
        await yieldToMain();
        await window.writeSaveDestination(dest, finalBlob);

        const embedFailed = designerCount > 0 && (totalFormFields === 0 || verifiedFields === 0);
        const shouldAlert = totalFormFields > 0 || wasEncrypted || embedFailed || domShellCount > 0;
        if (shouldAlert) {
            setTimeout(() => {
                let msg = "";
                if (embedFailed) {
                    msg = "Form fields could not be written into the PDF (wrote " +
                        totalFormFields + ", verified " + verifiedFields + ").\n\n" +
                        "Open the browser console (F12) and look for [embedAllFormFields] / [exportPdf] logs.";
                } else if (totalFormFields > 0) {
                    msg = `Saved with ${totalFormFields} fillable form widget(s).\n\n` +
                        `Open the PDF in a PDF reader to fill fields, then save a copy.`;
                } else if (domShellCount > 0 && designerCount === 0) {
                    msg = "Form shells were visible in the editor but none were collected for export.\n\n" +
                        "Open F12 console for [exportPdf] CRITICAL logs.";
                }
                if (wasEncrypted) {
                    if (msg) msg += "\n\n";
                    msg += "This file is password-protected. A password is required to open it. " +
                        "The password is not stored by GA PDF Editor and cannot be recovered if forgotten.";
                }
                window.customAlert(
                    msg || "PDF saved.",
                    embedFailed ? "⚠ Export problem" : (totalFormFields > 0 || wasEncrypted ? "✅ PDF ready" : "⚠ PDF saved")
                );
            }, 200);
        }
    };

    try {
        if (window.withCaptureSafeAppearance) {
            await window.withCaptureSafeAppearance(runExport);
        } else {
            await runExport();
        }
    } catch (err) {
        console.error("exportPdf failed:", err);
        window.hideLoading();
        await window.customAlert("An error occurred while exporting the PDF.");
        return;
    }

    window.hideLoading();
};

/**
 * Resolve a schema page entry to a live .pageWrapper (multi-strategy).
 * Avoids false "page missing" when pageId drifted or pageIndex is string/out of sync.
 */
window.resolveProjectPageWrapper = function(pageData, wrappersArr, scopeRoot) {
    if (!pageData || !wrappersArr || !wrappersArr.length) return null;
    const root = scopeRoot || document;

    // 1) pageIndex (0-based; accept numeric strings)
    const idx = pageData.pageIndex;
    if (idx !== undefined && idx !== null && idx !== "") {
        const i = parseInt(idx, 10);
        if (!Number.isNaN(i) && i >= 0 && i < wrappersArr.length) {
            return wrappersArr[i];
        }
    }

    // 2) exact pageId
    if (pageData.pageId) {
        const hit = wrappersArr.find((w) => w.dataset && w.dataset.pageId === String(pageData.pageId));
        if (hit) return hit;
        try {
            const q = root.querySelector(`.pageWrapper[data-page-id="${CSS.escape ? CSS.escape(String(pageData.pageId)) : String(pageData.pageId).replace(/"/g, '\\"')}"]`);
            if (q && wrappersArr.includes(q)) return q;
        } catch (_) { /* ignore */ }
    }

    // 3) original page number
    const orig = pageData.originalPageNum != null
        ? parseInt(pageData.originalPageNum, 10)
        : (pageData.pageId && /_page_(\d+)$/.test(String(pageData.pageId))
            ? parseInt(RegExp.$1, 10)
            : NaN);
    if (!Number.isNaN(orig)) {
        const hit = wrappersArr.find((w) => parseInt(w.dataset.originalPageNum, 10) === orig);
        if (hit) return hit;
    }

    // 4) single-page document: always map to the only wrapper
    if (wrappersArr.length === 1) return wrappersArr[0];

    return null;
};

// === Deserializer ===
window.applyProjectData = function(schema, rootViewer) {
    let totalApplied = 0; let missingPages = 0;
    
    const viewerEl = rootViewer
        || (APP.DOM && APP.DOM.viewer)
        || document.getElementById("viewer");
    const allWrappers = Array.from(
        viewerEl
            ? viewerEl.querySelectorAll(".pageWrapper")
            : document.querySelectorAll(".pageWrapper")
    );

    if (typeof window.loadProjectAudit === "function") {
        window.loadProjectAudit(schema);
    }

    // Project saved after form import/delete — mark managed so further exports strip natives
    if (schema && schema.formFieldsManaged && typeof window.markFormFieldsManaged === "function") {
        window.markFormFieldsManaged(viewerEl || undefined);
    }

    const pages = Array.isArray(schema && schema.pages) ? schema.pages : [];

    pages.forEach((pageData) => {
        if (!pageData) return;

        const targetWrapper = window.resolveProjectPageWrapper(pageData, allWrappers, viewerEl || document);

        // Empty page records with no overlays — never treat as "missing"
        const overlayCount = Array.isArray(pageData.overlays) ? pageData.overlays.length : 0;
        if (!targetWrapper) {
            if (overlayCount > 0) missingPages++;
            return;
        }

        const container = targetWrapper.querySelector(".pageContainer");
        if (!container) {
            if (overlayCount > 0) missingPages++;
            return;
        }

        // Restore optional page labels
        if (pageData.pageName) targetWrapper.dataset.pageName = pageData.pageName;
        if (pageData.hoverTitle) targetWrapper.dataset.hoverTitle = pageData.hoverTitle;

        (pageData.overlays || []).forEach(obj => {
            if (!obj) return;

            // Skip only if this id already exists in THIS viewer (not another tab).
            // document.getElementById caused intermittent multi-tab / stale-DOM skips.
            if (obj.id) {
                const esc = (window.CSS && CSS.escape)
                    ? CSS.escape(String(obj.id))
                    : String(obj.id).replace(/(["\\])/g, "\\$1");
                let existsHere = false;
                try {
                    existsHere = !!(viewerEl
                        ? viewerEl.querySelector("#" + esc)
                        : document.getElementById(obj.id));
                } catch (_) {
                    existsHere = !!(viewerEl
                        ? viewerEl.querySelector(`[id="${String(obj.id).replace(/"/g, '\\"')}"]`)
                        : document.getElementById(obj.id));
                }
                if (existsHere) {
                    totalApplied++;
                    return;
                }
            }

            const el = document.createElement("div");
            el.style.left = obj.x + "px"; el.style.top = obj.y + "px";
            el.style.width = obj.w === "max-content" ? "max-content" : obj.w + "px";
            el.style.height = obj.h === "auto" ? "auto" : obj.h + "px";
            el.id = obj.id;

            if (obj.type === "formField") {
                if (window.restoreFormFieldOverlay) {
                    window.restoreFormFieldOverlay(container, obj);
                    totalApplied++;
                }
                return;
            }
            else if (obj.type === "text") {
                el.className = "textOverlay";
                el.style.fontFamily = obj.styles.fontFamily;
                el.style.fontSize = obj.styles.fontSize + "px"; 
                el.style.color = obj.styles.color; 
                el.style.fontWeight = obj.styles.fontWeight; 
                el.style.lineHeight = obj.styles.lineHeight;
                el.style.backgroundColor = obj.styles.backgroundColor || "transparent"; 
                el.style.border = obj.styles.border || "none";

                // restore rotation
                if (obj.styles.transform) el.style.transform = obj.styles.transform;
                if (window.syncOverlayChromeRotation) window.syncOverlayChromeRotation(el);

                if (obj.styles.minWidth) el.style.minWidth = obj.styles.minWidth;
                if (obj.styles.minHeight) el.style.minHeight = obj.styles.minHeight;
                if (obj.styles.boxSizing) el.style.boxSizing = obj.styles.boxSizing;
                if (obj.styles.display) el.style.display = obj.styles.display;
                if (obj.styles.paddingRight) el.style.paddingRight = obj.styles.paddingRight;

                const textContent = document.createElement("div"); 
                textContent.className = "textContent"; 
                textContent.contentEditable = "true";
                textContent.innerHTML = window.sanitizeHTML(obj.content); 
                textContent.style.width = "100%"; 
                textContent.style.outline = "none"; 
                
                textContent.style.textAlign = obj.styles.textAlign || "left";
                if (obj.styles.textAlignLast) textContent.style.textAlignLast = obj.styles.textAlignLast;
                if (obj.styles.whiteSpace) textContent.style.whiteSpace = obj.styles.whiteSpace;
                if (obj.styles.overflowWrap) textContent.style.overflowWrap = obj.styles.overflowWrap;
                
                const controls = document.createElement("div"); 
                controls.className = "textControls"; 
                controls.addEventListener("mousedown", e => e.stopPropagation());
                
                const toolbarObj = window.createRichTextToolbar(textContent, el); 
                controls.appendChild(toolbarObj.element);
                toolbarObj.sync(obj.styles.fontFamily, obj.styles.fontSize, obj.styles.color, obj.styles.fontWeight, obj.styles.lineHeight);

                const dragHandle = document.createElement("div"); 
                dragHandle.className = "textDragHandle"; 
                dragHandle.innerHTML = "⠿";
                
                // rotate handle
                const rotateHandle = document.createElement("div"); 
                rotateHandle.className = "rotateHandle"; 
                rotateHandle.innerHTML = "&#8635;"; 
                rotateHandle.style.cursor = "grab";
                
                const resizeHandle = document.createElement("div"); 
                resizeHandle.className = "resizeHandle";
                
                const deleteHandle = window.createDeleteHandle(el);
                
                // append rotate handle
                el.append(controls, dragHandle, rotateHandle, deleteHandle, textContent, resizeHandle);
                window.makeDraggable(el, resizeHandle, dragHandle);
            } 
            else if (obj.type === "image") {
                el.className = "overlayImg";
                const img = document.createElement("img"); img.src = obj.src; img.style.width = "100%"; img.style.height = "100%"; img.style.pointerEvents = "none";
                
                // restore rotation
                if (obj.styles && obj.styles.transform) el.style.transform = obj.styles.transform;
                if (window.syncOverlayChromeRotation) window.syncOverlayChromeRotation(el);

                const dragHandle = document.createElement("div"); dragHandle.className = "textDragHandle"; dragHandle.innerHTML = "⠿";
                
                // rotate handle
                const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
                
                const resizeHandle = document.createElement("div"); resizeHandle.className = "resizeHandle"; const deleteHandle = window.createDeleteHandle(el);
                
                // append rotate handle
                el.append(img, dragHandle, rotateHandle, resizeHandle, deleteHandle); window.makeDraggable(el, resizeHandle, dragHandle);
            } 
            else if (obj.type === "table") {
                el.className = "shapeOverlay shape-table";
                Object.assign(el.dataset, obj.dataset);
                window.renderTableGrid(el);
                window.buildTableControls(el);
                
                if (obj.styles && obj.styles.transform) el.style.transform = obj.styles.transform;
                if (window.syncOverlayChromeRotation) window.syncOverlayChromeRotation(el);

                const dragHandle = document.createElement("div"); dragHandle.className = "textDragHandle"; dragHandle.innerHTML = "⠿";
                
                // rotate handle
                const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
                
                const deleteHandle = window.createDeleteHandle(el);
                
                // append rotate handle
                el.append(dragHandle, rotateHandle, deleteHandle); window.makeDraggable(el, null, dragHandle);
            }
            else if (obj.type === "shape") {
                const shapeKind = obj.shapeClass || "rect";
                el.className = `shapeOverlay shape-${shapeKind}`;
                el.style.backgroundColor = obj.styles.backgroundColor; el.style.border = obj.styles.border; el.style.borderRadius = obj.styles.borderRadius;
                if (shapeKind === "circle") el.style.borderRadius = el.style.borderRadius || "50%";
                if (obj.styles.transform) el.style.transform = obj.styles.transform;
                if (obj.styles.transformOrigin) el.style.transformOrigin = obj.styles.transformOrigin;
                if (window.syncOverlayChromeRotation) window.syncOverlayChromeRotation(el);
                window.buildShapeControls(el, shapeKind);
                
                const dragHandle = document.createElement("div"); dragHandle.className = "textDragHandle"; dragHandle.innerHTML = "⠿";
                
                // rotate handle
                const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
                
                const resizeHandle = document.createElement("div"); resizeHandle.className = "resizeHandle"; const deleteHandle = window.createDeleteHandle(el);
                
                // append rotate handle
                el.append(dragHandle, rotateHandle, resizeHandle, deleteHandle); window.makeDraggable(el, resizeHandle, dragHandle);
            }

            container.appendChild(el); totalApplied++;
        });
    });

    if (totalApplied > 0 && window.GaProcessor) {
        // Snapshot all applied overlay nodes as a compound CREATE tape
        const steps = [];
        schema.pages.forEach((p) => {
            (p.overlays || []).forEach((o) => {
                const target = o.id ? document.getElementById(o.id) : null;
                if (target && target.isConnected) {
                    steps.push(window.GaProcessor.build.createNode(target, "Restore overlay"));
                }
            });
        });
        if (steps.length) {
            window.GaProcessor.commit(
                window.GaProcessor.build.compound(steps, "Loaded Save State")
            );
        }
    }

    // Post-restore: hide native AcroForm widgets that have designer twins
    // (otherwise original PDF positions reappear next to moved shells)
    if (typeof window.scheduleSuppressNativesForDesignerTwins === "function") {
        window.scheduleSuppressNativesForDesignerTwins(viewerEl || undefined);
    } else if (typeof window.suppressNativesForDesignerTwins === "function") {
        window.suppressNativesForDesignerTwins(viewerEl || undefined);
    }

    // Only warn when overlays were expected but their host pages are truly absent
    if (missingPages > 0 && totalApplied === 0 && allWrappers.length === 0) {
        window.customAlert(
            `Could not restore project overlays — no pages are loaded in the viewer.`,
            "⚠️ Restore incomplete"
        );
    } else if (missingPages > 0 && totalApplied > 0) {
        window.customAlert(
            `Loaded ${totalApplied} edit(s), but ${missingPages} page(s) from the save file could not be matched to the current document.`,
            "⚠️ Partial restore"
        );
    } else if (missingPages > 0 && totalApplied === 0 && allWrappers.length > 0) {
        // Pages are on screen; schema page keys just didn't match — quiet skip (no scary false alarm)
        console.info(
            "[applyProjectData] page key mismatch but viewer has",
            allWrappers.length,
            "page(s); restored",
            totalApplied,
            "overlay(s). missingPageRecords=",
            missingPages
        );
    }

    if (typeof window.syncPageThumbnails === "function") window.syncPageThumbnails();
    window.historyEngine.savePoint = window.historyEngine.undoStack.length;
};

const projectInput = document.getElementById("projectInput");
const pendingModal = document.getElementById("pendingProjectModal");
const fileMenuSelect = document.getElementById("fileMenuSelect");

fileMenuSelect.addEventListener("change", async (e) => {
    const val = e.target.value;
    
    if (val === "open") {
        // Prefer showOpenFilePicker so we get FileSystemFileHandles for session restore
        if (typeof window.showOpenFilePicker === "function" && window.isSecureContext) {
            try {
                const handles = await window.showOpenFilePicker({
                    multiple: true,
                    types: [{
                        description: "PDF / GA Project",
                        accept: {
                            "application/pdf": [".pdf"],
                            "application/octet-stream": [".gapdf"]
                        }
                    }]
                });
                const items = [];
                for (const handle of handles) {
                    try {
                        const file = await handle.getFile();
                        items.push({ file, handle });
                    } catch (err) {
                        console.warn("open picker getFile failed", err);
                    }
                }
                if (items.length) {
                    // Always go through processPdfFiles so Append vs New Tab is offered
                    // when the active document already has pages (and multi-file choices).
                    await window.processPdfFiles(items.map((i) => i.file), false, {
                        handles: items.map((i) => i.handle)
                    });
                    e.target.value = "default";
                    return;
                }
            } catch (err) {
                if (err && err.name === "AbortError") {
                    e.target.value = "default";
                    return;
                }
                console.warn("showOpenFilePicker failed, falling back to <input>", err);
            }
        }
        document.getElementById("fileInput").click();
    } else if (val === "save_project") {
        window.exportProject(); 
    } else if (val === "save_pdf") {
        // confirm modal before export
        document.getElementById("exportQualityModal").style.display = "flex";
    } else if (val === "load") {
        projectInput.click();
    } else if (val === "print") {
        window.printBtn();
    } else if (val === "close") {
        if (window.GaWorkspace && typeof window.GaWorkspace.closeActiveDocument === "function") {
            await window.GaWorkspace.closeActiveDocument();
        } else if (APP.DOM && APP.DOM.viewer) {
            // Classic single-doc: clear canvas
            const dirty = window.historyEngine
                && (historyEngine.undoStack.length || 0) !== (historyEngine.savePoint || 0);
            if (dirty && typeof window.customConfirm === "function") {
                const ok = await window.customConfirm(
                    "Close this document? Unsaved changes will be lost.",
                    "⚠️ Close"
                );
                if (!ok) {
                    e.target.value = "default";
                    return;
                }
            }
            APP.DOM.viewer.innerHTML = "";
            window.currentPdfName = "Untitled";
            if (window.historyEngine) {
                historyEngine.undoStack = [];
                historyEngine.redoStack = [];
                historyEngine.savePoint = 0;
            }
            if (typeof window.updateHistoryUI === "function") window.updateHistoryUI();
            if (window.GaWorkspace && typeof window.GaWorkspace.appTitleWithVersion === "function") {
                document.title = window.GaWorkspace.appTitleWithVersion();
            } else {
                const base = (window.gaConfig && window.gaConfig("appTitle", "GA PDF Editor")) || "GA PDF Editor";
                const raw = String((window.gaConfig && window.gaConfig("version", "")) || "");
                const m = raw.match(/^(\d+(?:\.\d+)*)/);
                document.title = m ? `${base} ${m[1]}` : base;
            }
        }
    } else if (val === "close_all") {
        if (window.GaWorkspace && typeof window.GaWorkspace.closeAllDocuments === "function") {
            await window.GaWorkspace.closeAllDocuments();
        } else if (window.GaWorkspace && typeof window.GaWorkspace.closeActiveDocument === "function") {
            await window.GaWorkspace.closeActiveDocument();
        }
    }
    
    e.target.value = "default";
});

// launchQueue consumer lives in workspace.js (keeps FileSystemFileHandle + multi-tab).
// combine-mode query is handled there / via processPdfFiles forceAppend.


document.getElementById("pendingProjectCancelBtn").addEventListener("click", () => { window.pendingProjectData = null; pendingModal.style.display = "none"; });
document.getElementById("pendingProjectOpenBtn").addEventListener("click", () => { document.getElementById("fileInput").click(); });
// Password fields show/hide on export modal
(function wireExportPasswordUi() {
    const enable = document.getElementById("exportPasswordEnable");
    const fields = document.getElementById("exportPasswordFields");
    if (!enable || !fields) return;
    enable.addEventListener("change", () => {
        fields.style.display = enable.checked ? "block" : "none";
        if (enable.checked) {
            const inp = document.getElementById("exportPasswordInput");
            if (inp) setTimeout(() => inp.focus(), 0);
        } else {
            const a = document.getElementById("exportPasswordInput");
            const b = document.getElementById("exportPasswordConfirm");
            if (a) a.value = "";
            if (b) b.value = "";
        }
    });
})();

document.getElementById("exportQualityCancelBtn").addEventListener("click", () => {
    document.getElementById("exportQualityModal").style.display = "none";
    const enable = document.getElementById("exportPasswordEnable");
    const a = document.getElementById("exportPasswordInput");
    const b = document.getElementById("exportPasswordConfirm");
    if (enable) enable.checked = false;
    if (a) a.value = "";
    if (b) b.value = "";
    const fields = document.getElementById("exportPasswordFields");
    if (fields) fields.style.display = "none";
});

document.getElementById("exportQualityConfirmBtn").addEventListener("click", () => {
    const selectedScale = parseFloat(document.getElementById("exportQualitySelect").value) || 2;
    const enablePw = document.getElementById("exportPasswordEnable");
    const pwInput = document.getElementById("exportPasswordInput");
    const pwConfirm = document.getElementById("exportPasswordConfirm");

    let password = "";
    if (enablePw && enablePw.checked) {
        const p1 = (pwInput && pwInput.value) || "";
        const p2 = (pwConfirm && pwConfirm.value) || "";
        if (!p1) {
            window.customAlert("Enter a password, or uncheck password protection.");
            if (pwInput) pwInput.focus();
            return;
        }
        if (p1.length < 4) {
            window.customAlert("Use a password of at least 4 characters.");
            if (pwInput) pwInput.focus();
            return;
        }
        if (p1 !== p2) {
            window.customAlert("Passwords do not match.");
            if (pwConfirm) pwConfirm.focus();
            return;
        }
        password = p1;
    }

    document.getElementById("exportQualityModal").style.display = "none";
    // Clear password fields from the modal immediately (not stored elsewhere)
    if (pwInput) pwInput.value = "";
    if (pwConfirm) pwConfirm.value = "";
    if (enablePw) enablePw.checked = false;
    const fields = document.getElementById("exportPasswordFields");
    if (fields) fields.style.display = "none";

    // Fire immediately so showSaveFilePicker still has user activation
    window.exportPdf({ exportScale: selectedScale, password });
});
