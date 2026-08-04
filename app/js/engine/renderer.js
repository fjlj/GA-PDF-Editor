// ==========================================
// renderer.js: CORE PDF & CANVAS RENDERING
// ==========================================

window.sortTextLayerDOM = function(layer) {
    const spans = Array.from(layer.querySelectorAll("span"));
    const spanData = spans.map(span => {
        const rect = span.getBoundingClientRect();
        // word center Y for line grouping
        return { el: span, y: rect.top, x: rect.left, centerY: rect.top + (rect.height / 2) };
    });

    spanData.sort((a, b) => {
        // sort by center; 12px slop for uneven OCR lines
        if (Math.abs(a.centerY - b.centerY) < 12) return a.x - b.x;
        return a.centerY - b.centerY;
    });
    spanData.forEach(data => layer.appendChild(data.el));
};

window.renderPage = async function(pdf, pageNum) {
    const page = await pdf.getPage(pageNum);
    const viewport2x = page.getViewport({ scale: 2 });
    const viewport1x = page.getViewport({ scale: 1 }); 
    const baseWidth = viewport1x.width;
    const baseHeight = viewport1x.height;

    // Canvas — do not burn widget appearances into pixels (interactive AnnotationLayer handles forms)
    const canvas = document.createElement("canvas");
    canvas.className = "pageCanvas" + (APP.isPixelated ? " render-pixelated" : "");
    canvas.width = viewport2x.width; canvas.height = viewport2x.height;
    canvas.style.width = "100%"; canvas.style.height = "100%";
    const ctx = canvas.getContext("2d");
    const annMode = (pdfjsLib.AnnotationMode && pdfjsLib.AnnotationMode.DISABLE != null)
        ? pdfjsLib.AnnotationMode.DISABLE
        : 0;
    await page.render({
        canvasContext: ctx,
        viewport: viewport2x,
        intent: "display",
        annotationMode: annMode
    }).promise;

    // Text Layer
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.setProperty('--scale-factor', "1");
    textLayerDiv.style.width = baseWidth + "px"; textLayerDiv.style.height = baseHeight + "px";

    // Containers
    const container = document.createElement("div");
    container.className = "pageContainer";
    container.style.width = baseWidth + "px"; container.style.height = baseHeight + "px";
    container.style.transform = `scale(${window.currentZoom})`;
    container.append(canvas, textLayerDiv); 

    const wrapper = document.createElement("div");
    wrapper.className = "pageWrapper";
    if (window.GaProcessor) window.GaProcessor.ensureId(wrapper, "page");
	wrapper.dataset.pdfFingerprint = pdf.fingerprints[0];
	console.log(wrapper.dataset.pdfFingerprint);
	wrapper.dataset.originalPageNum = pageNum;
    wrapper.dataset.pageId = `${pdf.fingerprints[0]}_page_${pageNum}`;
    wrapper.dataset.baseWidth = baseWidth; wrapper.dataset.baseHeight = baseHeight;
    if (window.GaProcessor && APP.DOM && APP.DOM.viewer) {
        window.GaProcessor.ensureId(APP.DOM.viewer, "viewer");
    }
    wrapper.style.width = (baseWidth * window.currentZoom) + "px";
    wrapper.style.height = (baseHeight * window.currentZoom) + "px";
    wrapper.appendChild(container);
    APP.DOM.viewer.appendChild(wrapper);

    // Native PDF.js Rendering
    try {
        if (pdfjsLib.TextLayer) {
            const textLayer = new pdfjsLib.TextLayer({
                textContentSource: page.streamTextContent(),
                container: textLayerDiv,
                viewport: viewport1x
            });
            await textLayer.render();
            window.sortTextLayerDOM(textLayerDiv);
        } else {
            const renderTask = pdfjsLib.renderTextLayer({
                textContentSource: page.streamTextContent(),
                container: textLayerDiv,
                viewport: viewport1x,
                textDivs: []
            });
            if (renderTask.promise) {
                renderTask.promise.then(() => window.sortTextLayerDOM(textLayerDiv));
            } else {
                setTimeout(() => window.sortTextLayerDOM(textLayerDiv), 500);
            }
        }
    } catch (e) {
        console.warn("Text layer rendering failed:", e);
    }

    // Interactive AcroForm / links (Editor: fill; Form: dimmed via CSS)
    try {
        if (typeof window.renderPageAnnotationLayer === "function") {
            await window.renderPageAnnotationLayer(pdf, page, pageNum, container, viewport1x);
        }
    } catch (e) {
        console.warn("Annotation layer failed:", e);
    }

    wrapper.appendChild(container);
    APP.DOM.viewer.appendChild(wrapper);

    // return page wrapper
    return wrapper;
};

/** Drop source PDF bytes that no open tab still references (multi-tab safe). */
window.gcSourcePdfBuffers = function() {
    window.sourcePdfBuffers = window.sourcePdfBuffers || {};
    const used = new Set();
    document.querySelectorAll(".pageWrapper[data-pdf-fingerprint]").forEach((w) => {
        if (w.dataset.pdfFingerprint) used.add(w.dataset.pdfFingerprint);
    });
    Object.keys(window.sourcePdfBuffers).forEach((key) => {
        if (!used.has(key)) delete window.sourcePdfBuffers[key];
    });
};

window.renderPDF = async function(arrayBuffer, append = false) {
    if (!append) {
        APP.DOM.viewer.innerHTML = "";
        window.historyEngine.undoStack = [];
        window.historyEngine.redoStack = [];
        window.historyEngine.savePoint = 0; 
        window.updateHistoryUI();
        // Do NOT wipe sourcePdfBuffers globally — other tabs still need their bytes.
        // Orphaned entries are removed after pages are (re)built.
        if (typeof window.clearProjectAudit === "function") {
            window.clearProjectAudit();
        }
    }
	window.sourcePdfBuffers = window.sourcePdfBuffers || {};

    // Keep the exact input for session restore. For .gapdf this MUST include the
    // ---GA-SAVE-STATE--- trailer; caching only the stripped PDF half loses form
    // designer schema on hard refresh (shells live in the trailer, not only AcroForm).
    let sessionCacheBytes = null;
    try {
        if (arrayBuffer instanceof ArrayBuffer) {
            sessionCacheBytes = arrayBuffer.slice(0);
        } else if (arrayBuffer && arrayBuffer.buffer) {
            sessionCacheBytes = arrayBuffer.buffer.slice(
                arrayBuffer.byteOffset || 0,
                (arrayBuffer.byteOffset || 0) + arrayBuffer.byteLength
            );
        }
    } catch (_) {
        sessionCacheBytes = null;
    }

    let schemaToLoad = null;

    try {
        // scan raw bytes (no string decode)
        const bytes = new Uint8Array(arrayBuffer);
        const markerBytes = new TextEncoder().encode("\n---GA-SAVE-STATE---");
        
        let markerIndex = -1;
        // Search backwards from the end of the file (since our data is at the very bottom)
        for (let i = bytes.length - markerBytes.length; i >= 0; i--) {
            let match = true;
            for (let j = 0; j < markerBytes.length; j++) {
                if (bytes[i + j] !== markerBytes[j]) {
                    match = false; break;
                }
            }
            if (match) { markerIndex = i; break; }
        }

        if (markerIndex !== -1) {
			// Extract the JSON payload payload sitting after the marker
			const payloadBytes = bytes.slice(markerIndex + markerBytes.length);
			const delimBytes = new TextEncoder().encode("---HASH-DELIM---");
			let delimIndex = -1;
			for(let i = 0; i < payloadBytes.length - delimBytes.length; i++) {
				if(payloadBytes.slice(i, i + delimBytes.length).every((v, j) => v === delimBytes[j])) {
					delimIndex = i; break;
				}
			}
			
			const jsonStr = await (async () => {
				if (delimIndex !== -1) {
					const savedHash = new TextDecoder().decode(payloadBytes.slice(0, delimIndex));
					const compressedData = payloadBytes.slice(delimIndex + delimBytes.length);

					// Validate
					const actualHash = await window.computeHash(compressedData);
					if (actualHash !== savedHash) {
						window.customAlert("Project file integrity check failed. The file may be corrupted or tampered with.", "❌ Security Warning");
						return null; // Return null to indicate failure
					}
					const rval = await window.decompressData(compressedData);
					return rval;
				} else {
					window.customAlert("Project file was saved without an Integrity checksum, Edits have been loaded but cannot be verified as genuine.", "❌ Security Warning");
					return new TextDecoder('utf-8').decode(payloadBytes);
				}
			})();
			if (jsonStr === null) return;
			
            schemaToLoad = JSON.parse(jsonStr);
            // CLEANLY slice the arrayBuffer exactly where the marker starts
            arrayBuffer = arrayBuffer.slice(0, markerIndex);
        }
    } catch (e) { 
        console.warn("No appended state found or parse error:", e); 
    }
    
    if (!pdfjsLib) { window.customAlert("PDF.js failed to load!", "❌ Engine Error"); return; }
	const newWrappers = [];

	const safeCleanBytes = arrayBuffer.slice(0);

    try {
        const loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
            enableXfa: true,
            cMapUrl: './lib/pdfjs/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: './lib/pdfjs/standard_fonts/',
        });

        // Only decrypt THIS load if PDF.js actually asked for a password.
        // A sticky password from a previous encrypted file must never run
        // qpdf --decrypt on a cleartext PDF (that corrupts source buffers → blank
        // pages / missing forms on every subsequent save).
        let passwordUsedThisLoad = null;
        loadingTask.onPassword = (updatePassword, reason) => {
            const PR = pdfjsLib.PasswordResponses || { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };
            const incorrect = reason === PR.INCORRECT_PASSWORD || reason === 2;
            const msg = incorrect
                ? "That password was incorrect. Enter the password again to open this PDF."
                : "This PDF is password-protected. Enter the password to open it.";

            const promptFn = typeof window.customPasswordPrompt === "function"
                ? window.customPasswordPrompt
                : async (m) => {
                    const p = window.prompt(m);
                    return p === null ? null : p;
                };

            Promise.resolve(promptFn(msg, "🔒 Password required", { incorrect }))
                .then((pw) => {
                    if (pw === null || pw === undefined) {
                        updatePassword(new Error("Password entry cancelled."));
                    } else {
                        passwordUsedThisLoad = String(pw);
                        window._gaLastPdfPassword = passwordUsedThisLoad;
                        updatePassword(passwordUsedThisLoad);
                    }
                })
                .catch((e) => {
                    updatePassword(e instanceof Error ? e : new Error(String(e)));
                });
        };

        const pdf = await loadingTask.promise;
        const fpKey = pdf.fingerprints[0];

        // Cleartext by default. Decrypt ONLY when this document required a password.
		window.sourcePdfBuffers[fpKey] = safeCleanBytes;
        if (passwordUsedThisLoad) {
            window._gaPdfPasswordByFingerprint = window._gaPdfPasswordByFingerprint || {};
            window._gaPdfPasswordByFingerprint[fpKey] = passwordUsedThisLoad;
            if (typeof window.decryptPdfBytes === "function") {
                try {
                    const dec = await window.decryptPdfBytes(safeCleanBytes, passwordUsedThisLoad);
                    const ab = dec.buffer.slice(dec.byteOffset, dec.byteOffset + dec.byteLength);
                    window.sourcePdfBuffers[fpKey] = ab;
                    console.log("[renderPDF] decrypted source buffer for export (", ab.byteLength, "bytes)");
                } catch (decErr) {
                    console.warn("[renderPDF] decrypt for export buffer failed; export may be blank", decErr);
                }
            }
        } else if (window._gaPdfPasswordByFingerprint) {
            // Drop stale password for this fingerprint if reopened without encryption
            try { delete window._gaPdfPasswordByFingerprint[fpKey]; } catch (_) { /* ignore */ }
        }
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const wrapper = await window.renderPage(pdf, i);
            newWrappers.push(wrapper);
        }
        
        window.syncPageThumbnails();
        if (typeof window.gcSourcePdfBuffers === "function") window.gcSourcePdfBuffers();

        // Session: cache full input (incl. .gapdf trailer) so hard refresh reloads form schema
        if (!append && window.GaWorkspace && typeof window.GaWorkspace.rememberDocBytes === "function") {
            try {
                window.GaWorkspace.rememberDocBytes(sessionCacheBytes || safeCleanBytes);
            } catch (e) {
                console.warn("rememberDocBytes", e);
            }
        }

        // Capture the viewer that owns this render BEFORE any tab switch can race
        const importRoot = (APP.DOM && APP.DOM.viewer) || null;

        // Pages + annotation layers are already fully awaited above — apply immediately.
        // A fire-and-forget setTimeout(100) raced with tab switch / hard-refresh restore
        // and intermittently left form shells (or natives) missing.
		if (schemaToLoad) {
            try {
                if (importRoot) {
                    importRoot._gaProjectSchema = schemaToLoad;
                    const expectedForms = (Array.isArray(schemaToLoad.pages) ? schemaToLoad.pages : [])
                        .reduce((n, p) => n + ((p.overlays || []).filter((o) => o && o.type === "formField").length), 0);
                    if (expectedForms > 0) {
                        importRoot.dataset.expectedFormFields = String(expectedForms);
                    }
                    if (schemaToLoad.formFieldsManaged) {
                        importRoot.dataset.formFieldsManaged = "1";
                    }
                }
                window.applyProjectData(schemaToLoad);
                const got = importRoot
                    ? importRoot.querySelectorAll(".formFieldOverlay").length
                    : document.querySelectorAll(".formFieldOverlay").length;
                console.log(
                    "[renderPDF] project applied; form shells=", got,
                    "expected=", importRoot && importRoot.dataset.expectedFormFields
                );
            } catch (e) {
                console.warn("[renderPDF] applyProjectData failed", e);
            }
            if (typeof window.scheduleSuppressNativesForDesignerTwins === "function") {
                window.scheduleSuppressNativesForDesignerTwins(importRoot || undefined);
            }
            if (typeof window.scheduleEnsureFormsReady === "function") {
                window.scheduleEnsureFormsReady(importRoot, { schema: schemaToLoad, pdf });
            }
		} else if (!append && typeof window.maybeOfferNativeFormImport === "function") {
            // Await + explicit root: multi-tab restore must not import into the wrong pane
            try {
                const n = await window.maybeOfferNativeFormImport(pdf, { root: importRoot });
                if (importRoot && n > 0) {
                    importRoot.dataset.expectedFormFields = String(n);
                }
                console.log("[renderPDF] native form import count=", n);
                if (typeof window.scheduleSuppressNativesForDesignerTwins === "function") {
                    window.scheduleSuppressNativesForDesignerTwins(importRoot || undefined);
                }
                if (typeof window.scheduleEnsureFormsReady === "function") {
                    window.scheduleEnsureFormsReady(importRoot, { pdf });
                }
            } catch (e) {
                console.warn("maybeOfferNativeFormImport", e);
                if (typeof window.scheduleEnsureFormsReady === "function") {
                    window.scheduleEnsureFormsReady(importRoot, { pdf });
                }
            }
        }
        return newWrappers;
    } catch (err) {
        console.error("PDF Parsing Error:", err);
        const name = err && err.name;
        const msg = (err && err.message) ? String(err.message) : "";
        if (name === "PasswordException" || /password/i.test(msg) || /cancelled/i.test(msg)) {
            if (/cancelled/i.test(msg)) {
                // Quiet cancel — user backed out of password dialog
                return;
            }
            await window.customAlert(
                "Could not unlock this PDF. The password may be wrong, or the file uses an unsupported encryption scheme.",
                "🔒 Password required"
            );
            return;
        }
        await window.customAlert(
            "This PDF could not be opened. It may be damaged or use an unsupported format. " +
            "If it is encrypted with a special DRM scheme, try flattening via Print to PDF first.",
            "❌ Open failed"
        );
    }
};
