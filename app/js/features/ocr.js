// ==========================================
// ocr.js: TESSERACT TEXT EXTRACTION
// ==========================================

/** Decode base64 → Uint8Array (for file:// embeds). */
window.b64ToUint8Array = function(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

/** Decode base64 → UTF-8 text (worker / core JS sources). */
window.b64ToUtf8 = function(b64) {
    return new TextDecoder("utf-8").decode(window.b64ToUint8Array(b64));
};

/**
 * On file:// Firefox (and some others) refuse:
 *   new Worker("file:///…/tes.worker.min.js")
 * and also refuse blob workers that importScripts("file:///…").
 *
 * Fix: load worker + core *source* via <script> embeds (allowed), then
 * run a single blob: worker that already contains the core. That avoids:
 *  - Worker(file://…) security error
 *  - importScripts(file://…) from a blob worker
 *  - corePath not ending in "js" (Tesseract only treats paths ending in "js"
 *    as full script URLs; blob:uuid does not, so it would append /tesseract-core-…)
 *
 * Core already has WASM inlined as base64 → no separate .wasm fetch.
 */
window.resolveOcrWorkerOptions = async function() {
    const defaults = {
        workerPath: "./lib/tesseract/tes.worker.min.js",
        corePath: "./lib/tesseract/tesseract-core-simd-lstm.wasm.js",
        langPath: "./lib/tesseract/",
        workerBlobURL: true
    };

    if (window.location.protocol !== "file:") return defaults;

    const load = window.loadScriptOnce;
    if (typeof load !== "function") {
        throw new Error("loadScriptOnce missing — io.js must load before ocr.js");
    }

    await load("./lib/tesseract/tes.worker.embed.js");
    await load("./lib/tesseract/tesseract-core.embed.js");
    // traineddata embed also needed; resolveOcrLangArg may load it too (loadScriptOnce dedupes)
    await load("./lib/tesseract/eng.traineddata.embed.js");

    if (!window.__TESS_WORKER_B64 || !window.__TESS_CORE_B64) {
        throw new Error(
            "OCR file:// embeds missing (tes.worker.embed.js / tesseract-core.embed.js). " +
            "Serve over http(s) or restore the embed assets."
        );
    }

    // One blob: core first (defines global TesseractCore), then worker.
    // When the worker handles "load", TesseractCore is already present → skips importScripts.
    if (!window._tessCombinedWorkerBlobUrl) {
        const coreSrc = window.b64ToUtf8(window.__TESS_CORE_B64);
        const workerSrc = window.b64ToUtf8(window.__TESS_WORKER_B64);
        const combined =
            coreSrc +
            "\n;\n// === Tesseract worker ===\n" +
            workerSrc;
        window._tessCombinedWorkerBlobUrl = URL.createObjectURL(
            new Blob([combined], { type: "application/javascript" })
        );
    }

    return {
        // Full combined source in blob — do NOT wrap with importScripts(file)
        workerPath: window._tessCombinedWorkerBlobUrl,
        // Unused if core pre-inlined; still must look like a .js path for Tesseract's resolver
        corePath: "./lib/tesseract/tesseract-core-simd-lstm.wasm.js",
        langPath: "./lib/tesseract/",
        workerBlobURL: false
    };
};

/**
 * Seed Tesseract's IndexedDB language cache (idb-keyval defaults:
 * DB "keyval-store", store "keyval", key "./eng.traineddata").
 *
 * Why not postMessage { code, data }?
 *  - Bare object → worker throws "x.map is not a function" (needs string or array)
 *  - Array of { code, data } → loadLanguage works, but postMessage structured-clone
 *    strips methods; initialize does String(l.data) and expects language *name*
 *    (upstream uses l.data instead of l.code) → broken Init string
 *
 * Cache seed + plain "eng" string: loadLanguage hits IDB, no file:// fetch.
 */
window.seedTessLangCache = function(code, bytes) {
    const key = "./" + code + ".traineddata";
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB unavailable (needed for file:// OCR language cache)"));
            return;
        }

        const openAndPut = (db) => {
            try {
                const tx = db.transaction("keyval", "readwrite");
                tx.objectStore("keyval").put(data, key);
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); reject(tx.error || new Error("IDB put failed")); };
            } catch (e) {
                try { db.close(); } catch (_) { /* ok */ }
                reject(e);
            }
        };

        const req = indexedDB.open("keyval-store", 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("keyval")) {
                db.createObjectStore("keyval");
            }
        };
        req.onerror = () => reject(req.error || new Error("IDB open failed"));
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("keyval")) {
                const nextVer = (db.version || 1) + 1;
                db.close();
                const req2 = indexedDB.open("keyval-store", nextVer);
                req2.onupgradeneeded = () => {
                    if (!req2.result.objectStoreNames.contains("keyval")) {
                        req2.result.createObjectStore("keyval");
                    }
                };
                req2.onerror = () => reject(req2.error || new Error("IDB re-open failed"));
                req2.onsuccess = () => openAndPut(req2.result);
                return;
            }
            openAndPut(db);
        };
    });
};

window.resolveOcrLangArg = async function() {
    if (window.location.protocol !== "file:") return "eng";

    if (!window.__ENG_TRAINEDDATA_GZ_B64 && typeof window.loadScriptOnce === "function") {
        try {
            await window.loadScriptOnce("./lib/tesseract/eng.traineddata.embed.js");
        } catch (err) {
            console.warn("OCR language embed missing; OCR may fail on file://", err);
            return "eng";
        }
    }

    if (typeof window.__ENG_TRAINEDDATA_GZ_B64 === "string" && window.__ENG_TRAINEDDATA_GZ_B64.length > 0) {
        try {
            const bytes = window.b64ToUint8Array(window.__ENG_TRAINEDDATA_GZ_B64);
            await window.seedTessLangCache("eng", bytes);
            console.log("OCR: seeded eng.traineddata into IndexedDB for file:// mode");
        } catch (err) {
            console.error("OCR: failed to seed language cache", err);
            throw new Error(
                "Could not cache OCR language data for file:// (" + (err && err.message ? err.message : err) + "). " +
                "IndexedDB is required for offline OCR, or open the app over http(s)."
            );
        }
    }
    // Plain string — worker loadLanguage reads IDB cache, initialize gets "eng"
    return "eng";
};

/** Restore OCR button dual labels (full / short for responsive header). */
window.resetOcrButtonLabel = function(btn) {
    if (!btn) return;
    btn.innerHTML = '<span class="label-full">Scan OCR</span><span class="label-short" aria-hidden="true">OCR</span>';
};

document.getElementById("ocrBtn").addEventListener("click", async (e) => {
    // Active tab only — never scan every open document
    const viewer = (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || (window.APP && APP.DOM && APP.DOM.viewer)
        || document.querySelector("#workspaceRoot .doc-viewer.is-active-doc")
        || document.getElementById("viewer")
        || document;
    const pages = viewer.querySelectorAll
        ? viewer.querySelectorAll(".pageContainer")
        : document.querySelectorAll(".pageContainer");
    if (pages.length === 0) return window.customAlert("Please open a PDF first!");

    const forceScan = e.shiftKey; 
    const btn = document.getElementById("ocrBtn"); 
    btn.textContent = "Initializing…"; 
    btn.style.background = "#fd7e14"; 
    btn.disabled = true;

    try {
        // page index for OCR status logger
        let currentPageNum = 1; 

        if (window.location.protocol === "file:") {
            btn.textContent = "Loading…";
        }

        const [langArg, pathOpts] = await Promise.all([
            window.resolveOcrLangArg(),
            window.resolveOcrWorkerOptions()
        ]);

        // Initialize the local worker exactly ONCE before the loop
        const worker = await Tesseract.createWorker(langArg, 1, {
            ...pathOpts,
            logger: m => {
                // Keep status short so the header stays compact on narrow screens
                if (m.status === 'recognizing text') btn.textContent = `P${currentPageNum} ${Math.round(m.progress * 100)}%`;
                else if (m.status === 'loading tesseract core' || m.status === 'initializing api' || m.status === 'loading language traineddata') btn.textContent = "Loading…";
            }
        });

        for (let i = 0; i < pages.length; i++) {
            const container = pages[i]; const canvas = container.querySelector(".pageCanvas"); const textLayer = container.querySelector(".textLayer");
            if (!canvas || !textLayer) continue;

            if (!forceScan && textLayer.innerText.replace(/\s/g, '').length > 50) { 
                console.log(`Page ${i + 1} already has readable text. Skipping.`); 
                continue; 
            }
            textLayer.innerHTML = "";

            // status: which page is scanning
            currentPageNum = i + 1; 
            btn.textContent = `Page ${currentPageNum}…`;

            // Feed the canvas directly to our pre-warmed local worker
            const result = await worker.recognize(canvas);

            result.data.lines.forEach(line => {
                if (!line.text.trim()) return;
                let currentChunkWords = [];

                const createSpanFromChunk = (words) => {
                    if (words.length === 0) return;
                    const renderScale = 2;
                    const x0 = Math.min(...words.map(w => w.bbox.x0)) / renderScale; 
                    const y0 = Math.min(...words.map(w => w.bbox.y0)) / renderScale;
                    const x1 = Math.max(...words.map(w => w.bbox.x1)) / renderScale; 
                    const y1 = Math.max(...words.map(w => w.bbox.y1)) / renderScale;

                    const width = x1 - x0; 
                    const height = y1 - y0;
                    const textStr = words.map(w => w.text).join(' ');
                    const charCount = textStr.length;

                    // drop absurd aspect-ratio boxes
                    if (height > 50 && charCount < 15) return; 
                    if (charCount > 0 && (width / charCount) > 40) return; 

                    // drop huge empty banner-like detections
                    // Tables have massive horizontal gaps. We only nuke if it's EXTREME 
                    // (e.g., > 400px wide, and less than 15% of it is actual text)
                    const actualWordsWidth = words.reduce((sum, w) => sum + (w.bbox.x1 - w.bbox.x0), 0) / renderScale;
                    
                    if (width > 400 && (actualWordsWidth / width) < 0.15) {
                        console.log("OCR: dropped banner-like detection:", textStr);
                        return;
                    }

                    let calculatedFontSize = height; 
                    if (charCount > 3) {
                        const avgCharWidth = width / charCount;
                        const widthBasedFontSize = avgCharWidth / 0.55; 
                        calculatedFontSize = (height * 0.2) + (widthBasedFontSize * 0.8);
                    }

                    // do not let font size blow past box height
                    // Never let the font size be insanely larger than the physical bounding box height
                    calculatedFontSize = Math.min(calculatedFontSize, height * 1.2);

                    const finalFontSize = Math.max(8, Math.round(calculatedFontSize));

                    const span = document.createElement("span"); 
                    span.textContent = textStr; 
                    
                    // Keep the physical height perfectly tight to the text
                    span.style.height = finalFontSize + "px";
                    span.style.top = (y0 + ((height - finalFontSize) / 2)) + "px"; 
                    span.style.left = x0 + "px"; 
                    
                    span.style.width = (width + 2) + "px"; 
                    span.style.fontSize = finalFontSize + "px"; 
                    span.style.lineHeight = "1"; 
                    span.style.fontFamily = "sans-serif"; 

                    span.style.textAlign = "justify";
                    span.style.textAlignLast = "justify";
                    span.style.display = "inline-block"; 
                    span.style.whiteSpace = "nowrap"; 
                    span.style.overflow = "hidden"; 
                    span.style.position = "absolute"; 
                    span.style.color = "transparent";
                    
                    textLayer.appendChild(span);
                };

                line.words.forEach((word, index) => {
                    currentChunkWords.push(word); const t = word.text;
                    const endsWithSeparator = /[-—–:|]$/.test(t); const isStandaloneSeparator = /^[-—–:|]$/.test(t);
                    const isListMarker = index === 0 && /^(\d+\.|[a-zA-Z]\.|\([a-zA-Z0-9]\)|•|\*)$/.test(t);
                    if (endsWithSeparator || isStandaloneSeparator || isListMarker) { createSpanFromChunk(currentChunkWords); currentChunkWords = []; }
                });
                if (currentChunkWords.length > 0) createSpanFromChunk(currentChunkWords);
            });
            window.sortTextLayerDOM(textLayer);
            console.log(`Page ${i + 1} OCR Complete.`);
        }
        
        // kill worker, free RAM
        await worker.terminate();

        btn.textContent = "Done!";
        btn.style.background = "#28a745";
        setTimeout(() => {
            window.resetOcrButtonLabel(btn);
            btn.style.background = "#6f42c1";
            btn.disabled = false;
        }, 3000);
    } catch (err) {
        console.error("OCR Failed:", err);
        const msg = (err && (err.message || String(err))) || "unknown error";
        const hint = window.location.protocol === "file:"
            ? " Offline OCR needs the embed files under lib/ (*.embed.js). If this persists, open via a local http server."
            : "";
        window.customAlert("OCR Engine encountered an error: " + msg + hint);
        window.resetOcrButtonLabel(btn);
        btn.style.background = "#6f42c1";
        btn.disabled = false;
    }
});
