// ==========================================
// native-forms.js: Interactive AcroForm (PDF.js) + optional import to Form designer
// ==========================================

/** Minimal link service so AnnotationLayer can render without the full viewer. */
window.createPdfLinkService = function() {
    return {
        externalLinkTarget: 2, // blank
        externalLinkRel: "noopener noreferrer nofollow",
        externalLinkEnabled: true,
        pagesCount: 0,
        page: 1,
        rotation: 0,
        goToDestination() { return Promise.resolve(); },
        goToPage() {},
        addLinkAttributes(link, url, newWindow = false) {
            if (!link || !url) return;
            link.href = url;
            link.rel = "noopener noreferrer nofollow";
            link.target = newWindow === false ? "" : "_blank";
        },
        getDestinationHash() { return "#"; },
        getAnchorUrl(hash) { return hash || "#"; },
        setHash() {},
        executeNamedAction() {},
        executeSetOCGState() {},
        cachePageRef() {},
        isPageVisible() { return true; },
        isPageCached() { return true; },
        navigateTo() {},
        eventBus: null
    };
};

window._pdfLinkService = window._pdfLinkService || null;
window.getPdfLinkService = function() {
    if (!window._pdfLinkService) window._pdfLinkService = window.createPdfLinkService();
    return window._pdfLinkService;
};

/**
 * PDF.js reuses the same DOM id/name scheme for every document (pdfjs_internal_id_*).
 * With multi-tab, that collides across open PDFs and breaks radios/labels/focus.
 * Prefix every id/name inside this layer with a fingerprint-safe token.
 */
window.uniquifyAnnotationLayerDom = function(layerDiv, fingerprint) {
    if (!layerDiv) return "";
    const raw = String(fingerprint || "doc");
    const prefix = "d" + raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 28) + "_";
    layerDiv.dataset.idPrefix = prefix;
    layerDiv.dataset.pdfFingerprint = raw;

    layerDiv.querySelectorAll("[id]").forEach((el) => {
        const oldId = el.id;
        if (!oldId || oldId.startsWith(prefix)) return;
        el.id = prefix + oldId;
    });
    layerDiv.querySelectorAll("label[for]").forEach((lab) => {
        const f = lab.getAttribute("for");
        if (f && !f.startsWith(prefix)) lab.setAttribute("for", prefix + f);
    });
    layerDiv.querySelectorAll("[name]").forEach((el) => {
        const n = el.getAttribute("name");
        if (n && !n.startsWith(prefix)) el.setAttribute("name", prefix + n);
    });
    layerDiv.querySelectorAll("[aria-controls]").forEach((el) => {
        const c = el.getAttribute("aria-controls");
        if (c && !c.startsWith(prefix)) el.setAttribute("aria-controls", prefix + c);
    });
    return prefix;
};

/**
 * Render interactive form widgets (and other annotations) for a page.
 * Canvas should use annotationMode DISABLE so widgets are not double-painted.
 */
window.renderPageAnnotationLayer = async function(pdf, page, pageNum, container, viewport1x) {
    if (!pdfjsLib || !pdfjsLib.AnnotationLayer) {
        console.warn("AnnotationLayer not available in this PDF.js build");
        return null;
    }

    let annotations;
    try {
        annotations = await page.getAnnotations({ intent: "display" });
    } catch (e) {
        console.warn("getAnnotations failed:", e);
        return null;
    }
    if (!annotations || annotations.length === 0) return null;

    // Only bother if there is at least one interactive widget (or link)
    const hasUseful = annotations.some(a => {
        const t = a.annotationType;
        const AT = pdfjsLib.AnnotationType || {};
        return t === AT.WIDGET || t === 20 || t === AT.LINK || t === 2
            || a.subtype === "Widget" || a.subtype === "Link";
    });
    if (!hasUseful) return null;

    const fingerprint = (pdf.fingerprints && pdf.fingerprints[0]) || "doc";
    const layerDiv = document.createElement("div");
    layerDiv.className = "annotationLayer";
    layerDiv.dataset.pageNum = String(pageNum);
    layerDiv.dataset.pdfFingerprint = String(fingerprint);
    // PDF.js positions widgets with % + calc(var(--scale-factor) * pageWidth) — must be set
    layerDiv.style.setProperty("--scale-factor", "1");
    container.style.setProperty("--scale-factor", "1");

    container.appendChild(layerDiv);

    try {
        const vp = (viewport1x && typeof viewport1x.clone === "function")
            ? viewport1x.clone({ dontFlip: false })
            : viewport1x;
        const l10nStub = {
            get: async (k) => k,
            translate: async (el) => el
        };
        const annotationLayer = new pdfjsLib.AnnotationLayer({
            div: layerDiv,
            page,
            viewport: vp,
            accessibilityManager: null,
            annotationCanvasMap: null,
            l10n: l10nStub
        });

        // Use same viewport instance for layout + render
        await annotationLayer.render({
            annotations,
            viewport: vp,
            linkService: window.getPdfLinkService(),
            downloadManager: null,
            annotationStorage: pdf.annotationStorage,
            renderForms: true,
            enableScripting: false,
            hasJSActions: false,
            fieldObjects: null
        });

        // Multi-tab: make widget id/name unique in the whole HTML document
        window.uniquifyAnnotationLayerDom(layerDiv, fingerprint);

        // Tag sections with field names / ids for import hide + delete cleanup
        window.tagNativeAnnotationSections(layerDiv, annotations, fingerprint);
    } catch (e) {
        console.warn("AnnotationLayer.render failed:", e);
        try { layerDiv.remove(); } catch (_) {}
        return null;
    }

    return layerDiv;
};

/** AnnotationPrefix used by PDF.js for element ids */
window.pdfAnnotationDomId = function(nativeId) {
    const prefix = (pdfjsLib && pdfjsLib.AnnotationPrefix) || "pdfjs_internal_id_";
    return prefix + String(nativeId);
};

/**
 * Mark annotation sections so we can hide them after import / on designer delete.
 * @param {HTMLElement} layerDiv
 * @param {Array} annotations
 * @param {string} [fingerprint] PDF fingerprint for multi-tab scoping
 */
window.tagNativeAnnotationSections = function(layerDiv, annotations, fingerprint) {
    if (!layerDiv || !annotations) return;
    const esc = (window.CSS && CSS.escape) ? CSS.escape.bind(CSS)
        : (s => String(s).replace(/([^a-zA-Z0-9_-])/g, "\\$1"));
    const prefix = layerDiv.dataset.idPrefix || "";
    const fp = fingerprint != null ? String(fingerprint) : (layerDiv.dataset.pdfFingerprint || "");
    annotations.forEach(ann => {
        if (!ann || ann.id == null) return;
        const bareId = window.pdfAnnotationDomId(ann.id);
        const scopedId = prefix ? prefix + bareId : bareId;
        let node = null;
        try {
            node = layerDiv.querySelector("#" + esc(scopedId))
                || layerDiv.querySelector("#" + esc(bareId));
        } catch (_) { /* invalid selector */ }
        // Never fall back to document.getElementById — multi-tab id collisions
        if (!node && ann.fieldName) {
            const nm = String(ann.fieldName);
            const byName = layerDiv.querySelector(`[name="${esc(prefix + nm)}"]`)
                || layerDiv.querySelector(`[name="${esc(nm)}"]`);
            if (byName) node = byName;
        }
        if (!node) return;
        const section = node.closest("section") || node;
        section.dataset.nativeId = String(ann.id);
        if (fp) section.dataset.pdfFingerprint = fp;
        if (ann.fieldName) section.dataset.fieldName = String(ann.fieldName);
        section.classList.add("native-widget");
    });
};

/**
 * Hide or show a native AnnotationLayer widget by PDF.js annotation id.
 * @param {string|number} nativeId
 * @param {boolean} visible
 * @param {{ fingerprint?: string, root?: ParentNode, fieldName?: string }} [opts]
 */
window.setNativeAnnotationVisible = function(nativeId, visible, opts = {}) {
    if (nativeId == null || nativeId === "") return 0;
    const id = String(nativeId);
    const esc = (window.CSS && CSS.escape)
        ? (s) => CSS.escape(String(s))
        : (s) => String(s).replace(/(["\\])/g, "\\$1");
    const root = opts.root || document;
    const found = new Set();

    const collect = (sel) => {
        try {
            root.querySelectorAll(sel).forEach((node) => {
                const section = node.closest("section") || node;
                if (section) found.add(section);
            });
        } catch (_) { /* invalid selector */ }
    };

    // Primary: tagged native id
    if (opts.fingerprint) {
        collect(`.annotationLayer section[data-native-id="${esc(id)}"][data-pdf-fingerprint="${esc(String(opts.fingerprint))}"]`);
    }
    collect(`.annotationLayer section[data-native-id="${esc(id)}"]`);

    // Fallback: field name on section or control (tagging may have missed id)
    if (opts.fieldName) {
        const fn = String(opts.fieldName);
        collect(`.annotationLayer section[data-field-name="${esc(fn)}"]`);
        collect(`.annotationLayer [name="${esc(fn)}"]`);
        // After uniquify, names are prefixed — match suffix via filter
        root.querySelectorAll(".annotationLayer [name]").forEach((ctrl) => {
            const n = ctrl.getAttribute("name") || "";
            if (n === fn || n.endsWith("_" + fn) || n.endsWith(fn)) {
                const section = ctrl.closest("section");
                if (section) found.add(section);
            }
        });
    }

    found.forEach((section) => {
        if (!visible) {
            section.style.setProperty("display", "none", "important");
            section.style.setProperty("visibility", "hidden", "important");
            section.style.setProperty("pointer-events", "none", "important");
            section.dataset.hiddenByDesigner = "1";
            section.classList.add("native-widget");
            // Disable controls so they can't steal focus even if display is overridden
            section.querySelectorAll("input, select, textarea, button, a").forEach((ctrl) => {
                ctrl.setAttribute("disabled", "disabled");
                ctrl.setAttribute("tabindex", "-1");
                ctrl.style.setProperty("pointer-events", "none", "important");
            });
        } else {
            section.style.removeProperty("display");
            section.style.removeProperty("visibility");
            section.style.removeProperty("pointer-events");
            delete section.dataset.hiddenByDesigner;
            section.querySelectorAll("input, select, textarea, button, a").forEach((ctrl) => {
                ctrl.removeAttribute("disabled");
                ctrl.removeAttribute("tabindex");
                ctrl.style.removeProperty("pointer-events");
            });
        }
    });
    return found.size;
};

/**
 * Keep hidden native widget geometry in sync when a designer shell is moved/resized
 * (so export / any future un-hide stays aligned). Safe no-op if no twin.
 */
window.syncNativeWidgetGeometryFromDesigner = function(el) {
    if (!el || !el.dataset || !el.dataset.nativeId) return;
    const id = String(el.dataset.nativeId);
    const fp = el.dataset.pdfFingerprint || "";
    const esc = window.cssEscape || ((s) => String(s).replace(/"/g, '\\"'));
    const root = el.closest(".doc-viewer")
        || el.closest(".pageWrapper")
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || document;
    let sel = `.annotationLayer section[data-native-id="${esc(id)}"]`;
    if (fp) sel += `[data-pdf-fingerprint="${esc(fp)}"]`;
    const section = root.querySelector(sel);
    if (!section) return;

    // Designer uses px left/top/width/height in pageContainer space (same as AnnotationLayer).
    const left = el.style.left;
    const top = el.style.top;
    const width = el.style.width;
    const height = el.style.height;
    if (left) section.style.left = left;
    if (top) section.style.top = top;
    if (width) {
        section.style.width = width;
        section.style.right = "auto";
    }
    if (height) {
        section.style.height = height;
        section.style.bottom = "auto";
    }
};

function fingerprintForFormOverlay(el) {
    if (!el) return undefined;
    if (el.dataset.pdfFingerprint) return el.dataset.pdfFingerprint;
    const page = el.closest(".pageWrapper");
    return page && page.dataset.pdfFingerprint ? page.dataset.pdfFingerprint : undefined;
}

function formManagedHost(root) {
    const scope = root
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || (window.APP && APP.DOM && APP.DOM.viewer)
        || document.body;
    if (!scope) return document.body;
    if (scope.classList && scope.classList.contains("doc-viewer")) return scope;
    if (scope.closest) {
        const v = scope.closest(".doc-viewer");
        if (v) return v;
    }
    return scope;
}

/**
 * Mark this document/tab as having an app-managed form layer.
 * Export will strip original AcroForms and only re-embed remaining designer fields.
 */
window.markFormFieldsManaged = function(root) {
    const host = formManagedHost(root);
    // Per-viewer only. A global sticky flag made every later PDF→PDF export think
    // forms were "managed" and strip AcroForms even with no designer shells.
    if (host && host.dataset) host.dataset.formFieldsManaged = "1";
};

/**
 * True if we should strip original AcroForms on PDF export
 * (designer twins, suppressed natives, or explicit form edits/deletes).
 */
window.isFormFieldsManaged = function(root) {
    const scope = root
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || (window.APP && APP.DOM && APP.DOM.viewer)
        || document;
    const host = formManagedHost(scope);
    if (host && host.dataset && host.dataset.formFieldsManaged === "1") return true;
    // Scope checks to this viewer — never a process-wide flag
    if (scope.querySelector && scope.querySelector(".formFieldOverlay")) return true;
    if (scope.querySelector && scope.querySelector(".annotationLayer [data-hidden-by-designer='1']")) return true;
    if (scope.querySelector && scope.querySelector(".annotationLayer [data-form-removed='1']")) return true;
    return false;
};

/**
 * Permanently remove a native AnnotationLayer section for a designer twin
 * (delete form field = gone from view AND from future export).
 */
window.permanentlyRemoveNativeForDesigner = function(el) {
    if (!el || !el.dataset) return 0;
    const nativeId = el.dataset.nativeId;
    const fieldName = el.dataset.fieldName;
    const root = el.closest(".doc-viewer")
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || document;
    window.markFormFieldsManaged(root);

    // Prefer structured hide/remove via existing matcher
    if (nativeId && typeof window.setNativeAnnotationVisible === "function") {
        window.setNativeAnnotationVisible(nativeId, false, {
            fingerprint: fingerprintForFormOverlay(el),
            fieldName: fieldName || undefined,
            root
        });
    }

    // Then actually detach matching sections from the DOM so they cannot reappear
    let removed = 0;
    const esc = (window.CSS && CSS.escape)
        ? (s) => CSS.escape(String(s))
        : (s) => String(s).replace(/(["\\])/g, "\\$1");
    const victims = new Set();

    if (nativeId) {
        try {
            root.querySelectorAll(`.annotationLayer section[data-native-id="${esc(nativeId)}"]`)
                .forEach((s) => victims.add(s));
        } catch (_) { /* ignore */ }
    }
    if (fieldName) {
        try {
            root.querySelectorAll(`.annotationLayer section[data-field-name="${esc(fieldName)}"]`)
                .forEach((s) => victims.add(s));
            root.querySelectorAll(`.annotationLayer [name]`).forEach((ctrl) => {
                const n = ctrl.getAttribute("name") || "";
                if (n === fieldName || n.endsWith("_" + fieldName) || n.endsWith(fieldName)) {
                    const s = ctrl.closest("section");
                    if (s) victims.add(s);
                }
            });
        } catch (_) { /* ignore */ }
    }

    victims.forEach((section) => {
        section.dataset.formRemoved = "1";
        section.dataset.hiddenByDesigner = "1";
        try {
            section.remove();
            removed++;
        } catch (_) {
            section.style.setProperty("display", "none", "important");
        }
    });
    return removed;
};

/**
 * Ensure designer twins carry page fingerprint (needed for scoped native hide).
 * @param {ParentNode} [root]
 */
window.stampFormFieldFingerprints = function(root) {
    const scope = root || document;
    scope.querySelectorAll(".formFieldOverlay").forEach((el) => {
        if (el.dataset.pdfFingerprint) return;
        const page = el.closest(".pageWrapper");
        if (page && page.dataset.pdfFingerprint) {
            el.dataset.pdfFingerprint = page.dataset.pdfFingerprint;
        }
    });
};

/**
 * Hide every native AnnotationLayer widget that has a designer twin
 * (.formFieldOverlay with data-native-id). Safe to call multiple times.
 * @param {ParentNode} [root] limit to one tab's viewer
 * @returns {number} how many hide calls reported matches (best-effort)
 */
/**
 * Hide every AnnotationLayer Widget section under root (Form-managed docs:
 * designer shells are the interactive layer; natives are display-only ghosts).
 */
window.hideAllNativeFormWidgets = function(root) {
    const scope = root
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || (window.APP && APP.DOM && APP.DOM.viewer)
        || document;
    let n = 0;
    try {
        scope.querySelectorAll(
            ".annotationLayer section.textWidgetAnnotation, " +
            ".annotationLayer section.buttonWidgetAnnotation, " +
            ".annotationLayer section.choiceWidgetAnnotation, " +
            ".annotationLayer section.signatureWidgetAnnotation, " +
            ".annotationLayer section[data-annotation-id], " +
            ".annotationLayer .native-widget"
        ).forEach((section) => {
            // Prefer section containers; skip pure links
            if (section.classList && section.classList.contains("linkAnnotation")) return;
            section.style.setProperty("display", "none", "important");
            section.style.setProperty("visibility", "hidden", "important");
            section.style.setProperty("pointer-events", "none", "important");
            section.dataset.hiddenByDesigner = "1";
            section.classList.add("native-widget");
            section.querySelectorAll("input, select, textarea, button").forEach((ctrl) => {
                ctrl.setAttribute("disabled", "disabled");
                ctrl.setAttribute("tabindex", "-1");
                ctrl.style.setProperty("pointer-events", "none", "important");
            });
            n++;
        });
    } catch (e) {
        console.warn("[hideAllNativeFormWidgets]", e);
    }
    return n;
};

window.suppressNativesForDesignerTwins = function(root) {
    const scope = root
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || (window.APP && APP.DOM && APP.DOM.viewer)
        || document;

    if (typeof window.stampFormFieldFingerprints === "function") {
        window.stampFormFieldFingerprints(scope);
    }

    let hits = 0;
    const twins = scope.querySelectorAll(
        ".formFieldOverlay[data-native-id], .formFieldOverlay[data-imported-native='1'], .formFieldOverlay"
    );
    if (twins.length) window.markFormFieldsManaged(scope);

    twins.forEach((el) => {
        const n = window.setNativeAnnotationVisible(el.dataset.nativeId || "", false, {
            fingerprint: fingerprintForFormOverlay(el),
            fieldName: el.dataset.fieldName || undefined,
            root: scope
        });
        hits += (typeof n === "number" ? n : 0);
        // Keep twin geometry aligned while hidden (export / future unhide)
        if (typeof window.syncNativeWidgetGeometryFromDesigner === "function") {
            window.syncNativeWidgetGeometryFromDesigner(el);
        }
    });

    // Managed docs with designer shells: hide ANY remaining native widgets
    // (re-embedded project PDFs get new annotation ids that won't match data-native-id).
    const managed = typeof window.isFormFieldsManaged === "function"
        ? window.isFormFieldsManaged(scope)
        : !!(scope.dataset && scope.dataset.formFieldsManaged === "1");
    if (managed && twins.length && typeof window.hideAllNativeFormWidgets === "function") {
        hits += window.hideAllNativeFormWidgets(scope);
    }

    return hits;
};

/** Alias used at import time */
window.syncNativeWidgetsHiddenForImports = function(root) {
    return window.suppressNativesForDesignerTwins(root);
};

/**
 * Post-restore / post-apply hide pass: immediate + rAF + delayed (annotation tags may lag).
 * @param {ParentNode} [root]
 */
window.scheduleSuppressNativesForDesignerTwins = function(root) {
    const run = () => {
        try {
            window.suppressNativesForDesignerTwins(root);
        } catch (e) {
            console.warn("suppressNativesForDesignerTwins", e);
        }
    };
    run();
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(run));
    }
    setTimeout(run, 50);
    setTimeout(run, 200);
    setTimeout(run, 500);
};

window.onFormFieldRemoved = function(el) {
    if (!el || !el.classList.contains("formFieldOverlay")) return;
    // Designer deleted → permanently drop native twin (view + export)
    if (typeof window.permanentlyRemoveNativeForDesigner === "function") {
        window.permanentlyRemoveNativeForDesigner(el);
    } else if (el.dataset.nativeId) {
        window.setNativeAnnotationVisible(el.dataset.nativeId, false, {
            fingerprint: fingerprintForFormOverlay(el),
            fieldName: el.dataset.fieldName
        });
        window.markFormFieldsManaged(el);
    } else {
        window.markFormFieldsManaged(el);
    }
};

window.onFormFieldRestored = function(el) {
    if (!el || !el.classList.contains("formFieldOverlay")) return;
    // Undo of designer delete: keep native suppressed; designer shell is source of truth
    window.markFormFieldsManaged(el);
    if (el.dataset.nativeId) {
        window.setNativeAnnotationVisible(el.dataset.nativeId, false, {
            fingerprint: fingerprintForFormOverlay(el),
            fieldName: el.dataset.fieldName
        });
    }
};

/** Body class for pointer tool (fill only when Editor + select) */
window.syncToolBodyClass = function() {
    const mode = APP.currentMode || "select";
    document.body.classList.toggle("tool-select", mode === "select");
    document.body.classList.toggle("tool-nonselect", mode !== "select");
};

/**
 * Map a PDF.js widget annotation → our form designer type, or null if unsupported.
 */
window.mapNativeWidgetToDesignerType = function(ann) {
    if (!ann) return null;
    const AT = (pdfjsLib && pdfjsLib.AnnotationType) || {};
    const isWidget = ann.annotationType === AT.WIDGET || ann.annotationType === 20
        || ann.subtype === "Widget";
    if (!isWidget) return null;

    // Skip read-only if we want? Still import so layout can be adjusted — include them.
    const ft = String(ann.fieldType || "").toUpperCase();

    if (ft === "TX") return "text";
    if (ft === "SIG") return "signature";
    if (ft === "CH") return "dropdown";
    if (ft === "BTN") {
        if (ann.pushButton) return null; // not a fillable data field
        if (ann.radioButton) return "radio";
        if (ann.checkBox) return "checkbox";
        // default button → treat as checkbox when exportValue present
        if (ann.exportValue != null || ann.buttonValue != null) return "checkbox";
        return null;
    }
    // Some builds omit fieldType but set flags
    if (ann.radioButton) return "radio";
    if (ann.checkBox) return "checkbox";
    if (ann.multiLine != null || ann.maxLen != null) return "text";
    return null;
};

/**
 * PDF user-space rect → CSS top-left box on the 1× viewport.
 */
window.pdfRectToCssBox = function(rect, viewport) {
    if (!rect || rect.length < 4 || !viewport) return null;
    let viewRect;
    try {
        if (typeof viewport.convertToViewportRectangle === "function") {
            viewRect = viewport.convertToViewportRectangle(rect);
        } else if (pdfjsLib.Util && pdfjsLib.Util.normalizeRect) {
            // Fallback: manual Y-flip using viewport height
            const [, , ,] = pdfjsLib.Util.normalizeRect(rect);
            const x1 = rect[0], y1 = rect[1], x2 = rect[2], y2 = rect[3];
            viewRect = [
                x1 * viewport.scale,
                viewport.height - y2 * viewport.scale,
                x2 * viewport.scale,
                viewport.height - y1 * viewport.scale
            ];
        } else {
            return null;
        }
    } catch (e) {
        console.warn("pdfRectToCssBox failed", e);
        return null;
    }
    const left = Math.min(viewRect[0], viewRect[2]);
    const top = Math.min(viewRect[1], viewRect[3]);
    const width = Math.abs(viewRect[0] - viewRect[2]);
    const height = Math.abs(viewRect[1] - viewRect[3]);
    if (!(width > 1) || !(height > 1)) return null;
    return { x: left, y: top, w: width, h: height };
};

/**
 * Collect importable widgets from an open PDFDocumentProxy.
 * @returns {Promise<Array<{pageNum, type, fieldName, ...}>>}
 */
window.collectImportableNativeFields = async function(pdf) {
    const out = [];
    if (!pdf) return out;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        let page;
        try {
            page = await pdf.getPage(pageNum);
        } catch (_) { continue; }

        let annotations;
        try {
            annotations = await page.getAnnotations({ intent: "display" });
        } catch (_) { continue; }

        const viewport = page.getViewport({ scale: 1 });

        for (const ann of annotations) {
            const type = window.mapNativeWidgetToDesignerType(ann);
            if (!type) continue;

            const box = window.pdfRectToCssBox(ann.rect, viewport);
            if (!box) continue;

            const fieldName = (ann.fieldName && String(ann.fieldName).trim())
                || ("field_" + (ann.id || out.length + 1));

            let options = null;
            if (type === "dropdown" && Array.isArray(ann.options) && ann.options.length) {
                options = ann.options.map(o => {
                    if (o == null) return "";
                    if (typeof o === "string") return o;
                    return o.displayValue != null ? String(o.displayValue)
                        : (o.exportValue != null ? String(o.exportValue) : String(o));
                }).filter(Boolean);
                if (!options.length) options = null;
            }

            let optionValue = null;
            if (type === "radio") {
                optionValue = ann.buttonValue != null ? String(ann.buttonValue)
                    : (ann.exportValue != null ? String(ann.exportValue) : null);
            }

            let defaultValue = "";
            if (ann.fieldValue != null && ann.fieldValue !== "") {
                if (Array.isArray(ann.fieldValue)) defaultValue = String(ann.fieldValue[0] ?? "");
                else defaultValue = String(ann.fieldValue);
            } else if (ann.defaultFieldValue != null) {
                defaultValue = String(ann.defaultFieldValue);
            }

            // Checkbox/radio "on" defaults
            if ((type === "checkbox" || type === "radio") && defaultValue) {
                // keep export value as default marker "1" when checked
                const onVal = ann.exportValue != null ? String(ann.exportValue) : "Yes";
                if (defaultValue === onVal || defaultValue === "Yes" || defaultValue === "On") {
                    defaultValue = type === "radio" ? "1" : "1";
                } else if (defaultValue === "Off" || defaultValue === "No") {
                    defaultValue = "";
                }
            }

            out.push({
                pageNum,
                type,
                fieldName,
                x: box.x,
                y: box.y,
                w: box.w,
                h: box.h,
                multiline: !!(ann.multiLine || (ann.fieldFlags & 0x1000)),
                required: !!(ann.required || (ann.fieldFlags & 0x2)),
                defaultValue,
                fontSize: (ann.fontSize && ann.fontSize > 0) ? Math.round(ann.fontSize) : 12,
                options,
                optionValue,
                readOnly: !!ann.readOnly,
                nativeId: ann.id != null ? String(ann.id) : null
            });
        }
    }
    return out;
};

/**
 * Place collected fields as designer overlays (Form workspace).
 * Does not remove native AnnotationLayer — workspace CSS separates fill vs design.
 * @param {Array} fields
 * @param {{ root?: ParentNode }} [opts] force a specific tab viewer (multi-tab safe)
 */
window.importNativeFieldsAsOverlays = function(fields, opts = {}) {
    if (!Array.isArray(fields) || !fields.length) return 0;
    if (typeof window.createFormFieldOverlay !== "function") return 0;

    // Prefer explicit root (captured at render time) so multi-tab restore cannot mis-target
    const viewer = opts.root
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || (window.APP && APP.DOM && APP.DOM.viewer)
        || document.getElementById("viewer")
        || document;
    const scopeRoot = viewer;

    let count = 0;
    const usedNames = new Set(
        Array.from(scopeRoot.querySelectorAll(".formFieldOverlay")).map(el => el.dataset.fieldName)
    );

    for (const f of fields) {
        let wrapper = scopeRoot.querySelector(
            `.pageWrapper[data-original-page-num="${f.pageNum}"]`
        );
        if (!wrapper && f.pageNum != null) {
            wrapper = scopeRoot.querySelector(`.pageWrapper[data-page-id$="_page_${f.pageNum}"]`);
        }
        // Prefer originalPageNum match within same document — also try pageId suffix
        let container = null;
        if (wrapper) {
            container = wrapper.querySelector(".pageContainer");
        }
        if (!container) {
            // Fallback: Nth page wrapper inside active viewer only
            const all = scopeRoot.querySelectorAll(".pageWrapper");
            const w = all[f.pageNum - 1];
            container = w && w.querySelector(".pageContainer");
        }
        if (!container) continue;

        let name = window.sanitizeFormFieldName
            ? window.sanitizeFormFieldName(f.fieldName)
            : String(f.fieldName || "field").replace(/\s+/g, "_");

        // Radios share names; other types must be unique among non-radio overlays (this tab)
        if (f.type !== "radio") {
            let base = name;
            let n = 2;
            while (
                usedNames.has(name) ||
                scopeRoot.querySelector(`.formFieldOverlay[data-field-name="${window.cssEscape(name)}"]`)
            ) {
                name = base + "_" + (n++);
            }
        }
        usedNames.add(name);

        const el = window.createFormFieldOverlay(container, {
            type: f.type,
            fieldName: name,
            x: f.x,
            y: f.y,
            w: f.w,
            h: f.h,
            required: f.required,
            multiline: f.multiline,
            defaultValue: f.defaultValue,
            fontSize: f.fontSize,
            options: f.options,
            optionValue: f.optionValue,
            pushHistory: false,
            activate: false,
            nativeId: f.nativeId
        });
        // Scope native hide/show to this PDF when multi-tab
        const pageFp = container.closest(".pageWrapper");
        if (el && pageFp && pageFp.dataset.pdfFingerprint) {
            el.dataset.pdfFingerprint = pageFp.dataset.pdfFingerprint;
        }
        if (el) {
            el.dataset.importedNative = "1";
            if (f.nativeId) {
                el.dataset.nativeId = String(f.nativeId);
                // Hide native twin: designer fill surface is Editor UI; Form mode edits geometry.
                // Scoped by fingerprint so multi-tab docs with same field ids stay isolated.
                window.setNativeAnnotationVisible(f.nativeId, false, {
                    fingerprint: el.dataset.pdfFingerprint || undefined,
                    root: scopeRoot
                });
            }
            count++;
        }
    }

    if (count > 0 && typeof window.clearActiveOverlay === "function") {
        window.clearActiveOverlay(true);
    }
    return count;
};

/**
 * After a PDF loads, clone supported native fields into designer overlays.
 * Editor fill = designer .form-field-fill; Form mode = designer chrome.
 * Matching native AnnotationLayer widgets are hidden so they don't block hits
 * or show stale geometry under the shells.
 * @param {PDFDocumentProxy} pdf
 * @param {{ force?: boolean, root?: ParentNode }} [opts]
 *   root — the .doc-viewer that was active when this PDF was rendered (required for multi-tab).
 */
window.maybeOfferNativeFormImport = async function(pdf, opts = {}) {
    if (!pdf) return 0;

    const auto = window.gaConfig
        ? window.gaConfig("autoImportNativeForms", true)
        : true;
    if (!auto && !opts.force) return 0;

    const viewer = opts.root
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || (window.APP && APP.DOM && APP.DOM.viewer)
        || document;
    const fp = (pdf.fingerprints && pdf.fingerprints[0]) ? String(pdf.fingerprints[0]) : "";
    const esc = window.cssEscape || ((s) => String(s).replace(/"/g, '\\"'));

    // Per-viewer: skip only if THIS tab already has imported twins for this PDF
    if (!opts.force && fp) {
        const already = viewer.querySelector(
            `.formFieldOverlay[data-imported-native="1"][data-pdf-fingerprint="${esc(fp)}"]`
        );
        if (already) return 0;
    } else if (!opts.force && viewer.querySelector?.(".formFieldOverlay[data-imported-native='1']")) {
        return 0;
    }

    let fields;
    try {
        fields = await window.collectImportableNativeFields(pdf);
    } catch (e) {
        console.warn("collectImportableNativeFields failed", e);
        return 0;
    }
    if (!fields.length) return 0;

    const n = window.importNativeFieldsAsOverlays(fields, { root: viewer });
    if (n > 0) {
        if (viewer && viewer.dataset) viewer.dataset.formsImported = fp || "1";
        console.log("GA: auto-imported " + n + " fillable field(s) for Form workspace (natives kept for Editor fill)");
        if (typeof window.logProjectAudit === "function") {
            window.logProjectAudit("FIELD_IMPORTED", { count: n });
        }
    }
    return n;
};

/**
 * If a restored/switched tab has native AcroForms but no designer twins, re-import.
 * Safe to call on every tab activation.
 *
 * IMPORTANT: do NOT gate on annotation-layer DOM classes — those paint async and
 * caused hard-refresh races where import was skipped forever.
 */
window.ensureNativeFormImportForViewer = async function(viewer) {
    if (!viewer) return 0;
    const auto = window.gaConfig ? window.gaConfig("autoImportNativeForms", true) : true;
    if (!auto) return 0;

    const page = viewer.querySelector(".pageWrapper[data-pdf-fingerprint]");
    if (!page) return 0;
    const fp = page.dataset.pdfFingerprint;
    if (!fp) return 0;

    const esc = window.cssEscape || ((s) => String(s).replace(/"/g, '\\"'));
    // Already have designer shells for this doc
    if (viewer.querySelector(`.formFieldOverlay[data-imported-native="1"][data-pdf-fingerprint="${esc(fp)}"]`)) {
        return 0;
    }
    if (viewer.querySelector(`.formFieldOverlay[data-pdf-fingerprint="${esc(fp)}"]`)) {
        return 0;
    }
    // Project restore already placed shells (may lack imported-native flag)
    if (viewer.dataset.formFieldsManaged === "1" && viewer.querySelector(".formFieldOverlay")) {
        return 0;
    }
    if (viewer.querySelectorAll(".formFieldOverlay").length > 0
        && parseInt(viewer.dataset.expectedFormFields || "0", 10) > 0) {
        return 0;
    }

    const buf = window.sourcePdfBuffers && window.sourcePdfBuffers[fp];
    if (!buf || !window.pdfjsLib) return 0;

    try {
        const loadingTask = pdfjsLib.getDocument({
            data: buf.slice ? buf.slice(0) : buf,
            cMapUrl: "./lib/pdfjs/cmaps/",
            cMapPacked: true,
            standardFontDataUrl: "./lib/pdfjs/standard_fonts/"
        });
        // Encrypted exports: source bytes need the user password again for this re-parse.
        // Prefer the password captured when the user unlocked this fingerprint.
        loadingTask.onPassword = (updatePassword, reason) => {
            const map = window._gaPdfPasswordByFingerprint || {};
            const cached = map[fp] || window._gaLastPdfPassword || null;
            if (cached) {
                updatePassword(String(cached));
                return;
            }
            const PR = pdfjsLib.PasswordResponses || { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 };
            const incorrect = reason === PR.INCORRECT_PASSWORD || reason === 2;
            const promptFn = typeof window.customPasswordPrompt === "function"
                ? window.customPasswordPrompt
                : async (m) => {
                    const p = window.prompt(m);
                    return p === null ? null : p;
                };
            Promise.resolve(promptFn(
                incorrect
                    ? "That password was incorrect. Enter the password again."
                    : "This PDF is password-protected. Enter the password to load form fields.",
                "🔒 Password required",
                { incorrect }
            )).then((pw) => {
                if (pw === null || pw === undefined) {
                    updatePassword(new Error("Password entry cancelled."));
                } else {
                    window._gaLastPdfPassword = String(pw);
                    window._gaPdfPasswordByFingerprint = window._gaPdfPasswordByFingerprint || {};
                    window._gaPdfPasswordByFingerprint[fp] = String(pw);
                    updatePassword(String(pw));
                }
            }).catch((e) => {
                updatePassword(e instanceof Error ? e : new Error(String(e)));
            });
        };
        const pdf = await loadingTask.promise;
        return await window.maybeOfferNativeFormImport(pdf, { root: viewer, force: true });
    } catch (e) {
        console.warn("ensureNativeFormImportForViewer failed", e);
        return 0;
    }
};

/**
 * Repair missing form shells after open/refresh.
 * - Re-apply project schema form fields if count is short
 * - Else import natives from PDF bytes (no DOM annotation gate)
 * - Suppress natives once designers exist
 */
window.ensureFormsReadyForViewer = async function(viewer, opts = {}) {
    if (!viewer || !viewer.isConnected) return 0;
    const schema = opts.schema || viewer._gaProjectSchema || null;
    let expected = parseInt(viewer.dataset.expectedFormFields || "0", 10);
    if (!expected && schema && Array.isArray(schema.pages)) {
        expected = schema.pages.reduce(
            (n, p) => n + ((p.overlays || []).filter((o) => o && o.type === "formField").length),
            0
        );
        if (expected > 0) viewer.dataset.expectedFormFields = String(expected);
    }

    let have = viewer.querySelectorAll(".formFieldOverlay").length;

    // Project path: re-apply if shells are short
    if (schema && expected > 0 && have < expected && typeof window.applyProjectData === "function") {
        try {
            console.log("[ensureFormsReady] re-applying project data; have=", have, "expected=", expected);
            window.applyProjectData(schema);
            have = viewer.querySelectorAll(".formFieldOverlay").length;
        } catch (e) {
            console.warn("[ensureFormsReady] re-apply failed", e);
        }
    }

    // PDF path: import designer twins from AcroForm when none (or still short).
    // Also run when we have a schema but re-apply still left us empty (corrupt/partial
    // overlay HTML) — natives in the PDF half may still be recoverable.
    if (have === 0 || (expected > 0 && have < expected)) {
        try {
            const n = await window.ensureNativeFormImportForViewer(viewer);
            if (n > 0) {
                have = viewer.querySelectorAll(".formFieldOverlay").length;
                if (!viewer.dataset.expectedFormFields) {
                    viewer.dataset.expectedFormFields = String(have);
                }
            }
        } catch (e) {
            console.warn("[ensureFormsReady] native import", e);
        }
    }

    have = viewer.querySelectorAll(".formFieldOverlay").length;
    if (have > 0 && typeof window.scheduleSuppressNativesForDesignerTwins === "function") {
        window.scheduleSuppressNativesForDesignerTwins(viewer);
    }

    if (expected > 0 && have < expected) {
        console.warn("[ensureFormsReady] still short: have=", have, "expected=", expected);
    } else if (have > 0) {
        console.log("[ensureFormsReady] ok form shells=", have);
    }
    return have;
};

/**
 * Run ensureFormsReady a few times — covers annotation lag and tab-restore races.
 */
window.scheduleEnsureFormsReady = function(viewer, opts = {}) {
    if (!viewer) return;
    const delays = [0, 120, 400, 1000, 2500];
    delays.forEach((ms) => {
        setTimeout(() => {
            try {
                if (!viewer.isConnected) return;
                Promise.resolve(window.ensureFormsReadyForViewer(viewer, opts)).catch((e) => {
                    console.warn("[scheduleEnsureFormsReady]", e);
                });
            } catch (e) {
                console.warn("[scheduleEnsureFormsReady]", e);
            }
        }, ms);
    });
};
