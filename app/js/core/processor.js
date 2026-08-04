/**
 * processor.js — Instruction processor (command / opcode dispatcher).
 *
 * UI peripherals format macro-event Instructions and commit them here.
 * History stores the instruction tape (not DOM closures); undo = invert + execute.
 *
 * Instruction shape:
 * {
 *   opcode: string,
 *   targetId?: string,
 *   payload?: object,
 *   name?: string,       // human label for history UI
 *   applied?: boolean,   // true = DOM already mutated; only record for history
 *   meta?: object
 * }
 */
(function (global) {
    "use strict";

    /** @type {Map<string, function(object, {applied?: boolean}): void>} */
    const handlers = new Map();

    // -------------------------------------------------------------------------
    // Identity helpers
    // -------------------------------------------------------------------------

    function uid(prefix) {
        const p = prefix || "ga";
        if (global.crypto && typeof global.crypto.randomUUID === "function") {
            return p + "-" + global.crypto.randomUUID();
        }
        return p + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
    }

    /**
     * Ensure a DOM node has a stable id for instruction targeting.
     * @param {Element|null|undefined} el
     * @param {string} [prefix]
     * @returns {string|null}
     */
    function ensureId(el, prefix) {
        if (!el || el.nodeType !== 1) return null;
        if (!el.id) el.id = uid(prefix || "node");
        return el.id;
    }

    function byId(id) {
        if (!id) return null;
        try {
            return document.getElementById(id);
        } catch (_) {
            return null;
        }
    }

    /**
     * Snapshot a node for CREATE/DELETE invertibility.
     * @param {Element} el
     */
    function snapshotNode(el) {
        if (!el) return null;
        const parent = el.parentElement;
        const next = el.nextElementSibling;
        ensureId(el, "ov");
        if (parent) ensureId(parent, "pg");
        if (next) ensureId(next, "sib");
        return {
            targetId: el.id,
            parentId: parent ? parent.id : null,
            nextSiblingId: next ? next.id : null,
            html: el.outerHTML
        };
    }

    /**
     * Capture transform-related inline styles (+ optional parent).
     * @param {Element} el
     */
    function snapshotTransform(el) {
        if (!el) return null;
        ensureId(el, "ov");
        const parent = el.parentElement;
        if (parent) ensureId(parent, "pg");
        return {
            left: el.style.left || "",
            top: el.style.top || "",
            width: el.style.width || "",
            height: el.style.height || "",
            transform: el.style.transform || "",
            parentId: parent ? parent.id : null
        };
    }

    function applyTransformSnapshot(el, snap) {
        if (!el || !snap) return;
        if (snap.left != null) el.style.left = snap.left;
        if (snap.top != null) el.style.top = snap.top;
        if (snap.width != null) el.style.width = snap.width;
        if (snap.height != null) el.style.height = snap.height;
        if (snap.transform != null) el.style.transform = snap.transform;
        if (typeof global.syncOverlayChromeRotation === "function") {
            global.syncOverlayChromeRotation(el);
        }
        if (snap.parentId) {
            const parent = byId(snap.parentId);
            if (parent && el.parentElement !== parent) parent.appendChild(el);
        }
    }

    // -------------------------------------------------------------------------
    // Inverse map (time-travel)
    // -------------------------------------------------------------------------

    const INVERSE_OPCODE = {
        CREATE_NODE: "DELETE_NODE",
        DELETE_NODE: "CREATE_NODE",
        COMMIT_TRANSFORM: "COMMIT_TRANSFORM",
        COMMIT_TRANSFORMS: "COMMIT_TRANSFORMS",
        SET_STYLE: "SET_STYLE",
        SET_INNER_HTML: "SET_INNER_HTML",
        SET_TEXT_STATE: "SET_TEXT_STATE",
        REORDER_CHILD: "REORDER_CHILD",
        SET_ZINDEX: "SET_ZINDEX",
        SET_DATASET: "SET_DATASET",
        COMPOUND: "COMPOUND"
    };

    /**
     * Produce the inverse instruction (does not mutate input).
     * @param {object} inst
     * @returns {object|null}
     */
    function invertInstruction(inst) {
        if (!inst || !inst.opcode) return null;
        const op = inst.opcode;
        const invOp = INVERSE_OPCODE[op] || op;
        const base = {
            opcode: invOp,
            targetId: inst.targetId,
            name: inst.name ? "Undo: " + inst.name : invOp,
            meta: inst.meta ? Object.assign({}, inst.meta) : undefined,
            applied: false
        };

        switch (op) {
            case "CREATE_NODE":
                return Object.assign({}, base, {
                    opcode: "DELETE_NODE",
                    payload: Object.assign({}, inst.payload || {}, {
                        targetId: inst.targetId || (inst.payload && inst.payload.targetId)
                    })
                });

            case "DELETE_NODE":
                return Object.assign({}, base, {
                    opcode: "CREATE_NODE",
                    targetId: inst.targetId || (inst.payload && inst.payload.targetId),
                    payload: Object.assign({}, inst.payload || {})
                });

            case "COMMIT_TRANSFORM": {
                const p = inst.payload || {};
                return Object.assign({}, base, {
                    payload: {
                        before: p.after,
                        after: p.before
                    }
                });
            }

            case "COMMIT_TRANSFORMS": {
                const items = (inst.payload && inst.payload.items) || [];
                return Object.assign({}, base, {
                    payload: {
                        items: items.map((it) => ({
                            targetId: it.targetId,
                            before: it.after,
                            after: it.before
                        }))
                    }
                });
            }

            case "SET_STYLE": {
                const p = inst.payload || {};
                return Object.assign({}, base, {
                    payload: { before: p.after, after: p.before, prop: p.prop }
                });
            }

            case "SET_INNER_HTML": {
                const p = inst.payload || {};
                return Object.assign({}, base, {
                    payload: { before: p.after, after: p.before }
                });
            }

            case "SET_TEXT_STATE": {
                const p = inst.payload || {};
                return Object.assign({}, base, {
                    payload: {
                        before: p.after,
                        after: p.before,
                        textContentId: p.textContentId
                    }
                });
            }

            case "REORDER_CHILD": {
                const p = inst.payload || {};
                return Object.assign({}, base, {
                    payload: {
                        parentId: p.parentId,
                        beforeNextSiblingId: p.afterNextSiblingId,
                        afterNextSiblingId: p.beforeNextSiblingId
                    }
                });
            }

            case "COMPOUND": {
                const steps = (inst.payload && inst.payload.steps) || [];
                // Undo compound in reverse order with each step inverted
                const invSteps = steps
                    .slice()
                    .reverse()
                    .map((s) => invertInstruction(s))
                    .filter(Boolean);
                return Object.assign({}, base, {
                    payload: { steps: invSteps }
                });
            }

            case "SET_ZINDEX": {
                const p = inst.payload || {};
                return Object.assign({}, base, {
                    payload: { before: p.after, after: p.before, items: p.items
                        ? p.items.map((it) => ({ targetId: it.targetId, before: it.after, after: it.before }))
                        : undefined }
                });
            }

            case "SET_DATASET": {
                const p = inst.payload || {};
                return Object.assign({}, base, {
                    payload: { before: p.after, after: p.before, mode: p.mode || "patch" }
                });
            }

            default:
                console.warn("[processor] no inverse for opcode", op);
                return null;
        }
    }

    // -------------------------------------------------------------------------
    // Opcode handlers
    // -------------------------------------------------------------------------

    function insertFromSnapshot(snap) {
        if (!snap || !snap.html || !snap.parentId) return null;
        const parent = byId(snap.parentId);
        if (!parent) {
            console.warn("[processor] CREATE_NODE missing parent", snap.parentId);
            return null;
        }
        const tpl = document.createElement("div");
        tpl.innerHTML = snap.html.trim();
        const node = tpl.firstElementChild;
        if (!node) return null;
        // Preserve id from snapshot
        if (snap.targetId) node.id = snap.targetId;
        const next = snap.nextSiblingId ? byId(snap.nextSiblingId) : null;
        if (next && next.parentElement === parent) parent.insertBefore(node, next);
        else parent.appendChild(node);

        // Re-bind drag handles if present
        if (typeof global.makeDraggable === "function") {
            const resize = node.querySelector(".resizeHandle");
            const drag = node.querySelector(".textDragHandle");
            try {
                global.makeDraggable(node, resize, drag || null);
            } catch (_) { /* ignore */ }
        }
        if (node.classList && node.classList.contains("formFieldOverlay")
            && typeof global.onFormFieldRestored === "function") {
            try { global.onFormFieldRestored(node); } catch (_) { /* ignore */ }
        }
        return node;
    }

    handlers.set("CREATE_NODE", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const snap = Object.assign({}, inst.payload || {}, {
            targetId: inst.targetId || (inst.payload && inst.payload.targetId)
        });
        // If already in DOM (race), skip
        if (snap.targetId && byId(snap.targetId)) return;
        insertFromSnapshot(snap);
    });

    handlers.set("DELETE_NODE", function (inst, ctx) {
        const id = inst.targetId || (inst.payload && inst.payload.targetId);
        const el = byId(id);
        // When applied:true the node may already be gone — still try payload snapshot for form cleanup
        if (el && el.classList && el.classList.contains("formFieldOverlay")
            && typeof global.onFormFieldRemoved === "function") {
            try { global.onFormFieldRemoved(el); } catch (_) { /* ignore */ }
        } else if (ctx && ctx.applied && inst.payload && inst.payload.html
            && typeof global.onFormFieldRemoved === "function") {
            // Element already removed; synthesize minimal twin for native cleanup
            try {
                const fake = document.createElement("div");
                fake.className = "formFieldOverlay";
                if (inst.payload.html) {
                    const tmp = document.createElement("div");
                    tmp.innerHTML = inst.payload.html;
                    const src = tmp.firstElementChild;
                    if (src && src.dataset) {
                        if (src.dataset.nativeId) fake.dataset.nativeId = src.dataset.nativeId;
                        if (src.dataset.fieldName) fake.dataset.fieldName = src.dataset.fieldName;
                        if (src.dataset.pdfFingerprint) fake.dataset.pdfFingerprint = src.dataset.pdfFingerprint;
                        if (src.dataset.importedNative) fake.dataset.importedNative = src.dataset.importedNative;
                    }
                }
                if (fake.dataset.nativeId || fake.dataset.fieldName) {
                    global.onFormFieldRemoved(fake);
                }
            } catch (_) { /* ignore */ }
        }
        if (ctx && ctx.applied) return;
        if (el) el.remove();
    });

    handlers.set("COMMIT_TRANSFORM", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const el = byId(inst.targetId);
        if (!el) return;
        const p = inst.payload || {};
        applyTransformSnapshot(el, p.after);
        if (el.classList && el.classList.contains("formFieldOverlay")
            && typeof global.syncNativeWidgetGeometryFromDesigner === "function") {
            global.syncNativeWidgetGeometryFromDesigner(el);
        }
    });

    handlers.set("COMMIT_TRANSFORMS", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const items = (inst.payload && inst.payload.items) || [];
        items.forEach((it) => {
            const el = byId(it.targetId);
            if (!el) return;
            applyTransformSnapshot(el, it.after);
            if (el.classList && el.classList.contains("formFieldOverlay")
                && typeof global.syncNativeWidgetGeometryFromDesigner === "function") {
                global.syncNativeWidgetGeometryFromDesigner(el);
            }
        });
    });

    handlers.set("SET_STYLE", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const el = byId(inst.targetId);
        if (!el) return;
        const p = inst.payload || {};
        if (p.prop === "cssText" || p.prop == null) {
            el.style.cssText = p.after != null ? p.after : "";
        } else {
            el.style[p.prop] = p.after != null ? p.after : "";
        }
    });

    handlers.set("SET_INNER_HTML", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const el = byId(inst.targetId);
        if (!el) return;
        const p = inst.payload || {};
        el.innerHTML = p.after != null ? p.after : "";
    });

    handlers.set("SET_TEXT_STATE", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const overlay = byId(inst.targetId);
        if (!overlay) return;
        const p = inst.payload || {};
        const state = p.after || {};
        if (state.overlayCss != null) overlay.style.cssText = state.overlayCss;
        let textNode = p.textContentId ? byId(p.textContentId) : null;
        if (!textNode) textNode = overlay.querySelector(".textContent");
        if (textNode) {
            if (state.html != null) textNode.innerHTML = state.html;
            if (state.textCss != null) textNode.style.cssText = state.textCss;
        }
    });

    handlers.set("REORDER_CHILD", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const el = byId(inst.targetId);
        const p = inst.payload || {};
        const parent = byId(p.parentId) || (el && el.parentElement);
        if (!el || !parent) return;
        const nextId = p.afterNextSiblingId;
        if (nextId === null || nextId === undefined) {
            parent.appendChild(el);
        } else if (nextId === "__FIRST__") {
            parent.insertBefore(el, parent.firstElementChild);
        } else {
            const next = byId(nextId);
            if (next && next.parentElement === parent) parent.insertBefore(el, next);
            else parent.appendChild(el);
        }
    });

    handlers.set("COMPOUND", function (inst, ctx) {
        // Compound steps always re-execute (applied flag is for outer record only)
        const steps = (inst.payload && inst.payload.steps) || [];
        steps.forEach((step) => {
            execute(step, { applied: false, silent: true });
        });
    });

    handlers.set("SET_ZINDEX", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const p = inst.payload || {};
        if (p.items && p.items.length) {
            p.items.forEach((it) => {
                const el = byId(it.targetId);
                if (el) el.style.zIndex = it.after != null ? it.after : "";
            });
            return;
        }
        const el = byId(inst.targetId);
        if (el) el.style.zIndex = p.after != null ? p.after : "";
    });

    handlers.set("SET_DATASET", function (inst, ctx) {
        if (ctx && ctx.applied) return;
        const el = byId(inst.targetId);
        if (!el) return;
        const p = inst.payload || {};
        const data = p.after || {};
        if (p.mode === "replace") {
            Object.keys(el.dataset).forEach((k) => {
                delete el.dataset[k];
            });
        }
        Object.keys(data).forEach((k) => {
            if (data[k] == null || data[k] === "") delete el.dataset[k];
            else el.dataset[k] = data[k];
        });
        if (typeof global.renderTableGrid === "function" && el.classList.contains("shape-table")) {
            try { global.renderTableGrid(el); } catch (_) { /* ignore */ }
        }
        if (typeof global.syncPageThumbnails === "function" && el.classList.contains("pageWrapper")) {
            try { global.syncPageThumbnails(); } catch (_) { /* ignore */ }
        }
    });

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Execute an instruction (route to handler). Does not touch history.
     * @param {object} inst
     * @param {{ applied?: boolean, silent?: boolean }} [ctx]
     */
    function execute(inst, ctx) {
        if (!inst || !inst.opcode) {
            console.warn("[processor] invalid instruction", inst);
            return false;
        }
        const fn = handlers.get(inst.opcode);
        if (!fn) {
            console.warn("[processor] unknown opcode", inst.opcode);
            return false;
        }
        try {
            fn(inst, ctx || {});
            if (!ctx || !ctx.silent) {
                global.dispatchEvent(new CustomEvent("ga-instruction", {
                    detail: { instruction: inst, ctx: ctx || {} }
                }));
            }
            return true;
        } catch (err) {
            console.error("[processor] execute failed", inst.opcode, err);
            return false;
        }
    }

    /**
     * Commit a macro instruction: optionally execute, then record on history tape.
     * Pass applied:true when the UI already mutated the DOM (mouseup, etc.).
     * @param {object} inst
     * @returns {object} normalized instruction
     */
    function commit(inst) {
        if (!inst || !inst.opcode) {
            console.warn("[processor] commit: bad instruction", inst);
            return null;
        }
        const normalized = Object.assign({}, inst);
        if (!normalized.name) normalized.name = labelFor(normalized);

        // Ensure target identity where possible
        if (!normalized.targetId && normalized.payload && normalized.payload.targetId) {
            normalized.targetId = normalized.payload.targetId;
        }

        if (!normalized.applied) {
            execute(normalized, { applied: false });
        }

        // Always clear applied before storing so redo re-executes
        const forHistory = Object.assign({}, normalized, { applied: false });

        if (global.historyEngine && typeof global.historyEngine.record === "function") {
            global.historyEngine.record(forHistory);
        } else if (global.historyEngine && typeof global.historyEngine.push === "function") {
            // Fallback during partial load order
            global.historyEngine.push(forHistory);
        }

        return forHistory;
    }

    function labelFor(inst) {
        const map = {
            CREATE_NODE: "Create",
            DELETE_NODE: "Delete",
            COMMIT_TRANSFORM: "Transform",
            COMMIT_TRANSFORMS: "Transform group",
            SET_STYLE: "Style",
            SET_INNER_HTML: "Edit content",
            SET_TEXT_STATE: "Text edit",
            REORDER_CHILD: "Reorder",
            COMPOUND: "Compound"
        };
        return map[inst.opcode] || inst.opcode;
    }

    function register(opcode, handler) {
        handlers.set(opcode, handler);
    }

    /**
     * Convenience builders used by UI peripherals.
     */
    const build = {
        createNode(el, name) {
            const snap = snapshotNode(el);
            return {
                opcode: "CREATE_NODE",
                targetId: snap.targetId,
                payload: snap,
                name: name || "Create",
                applied: true
            };
        },
        deleteNode(el, name) {
            const snap = snapshotNode(el);
            return {
                opcode: "DELETE_NODE",
                targetId: snap.targetId,
                payload: snap,
                name: name || "Delete",
                applied: true
            };
        },
        transform(el, beforeSnap, afterSnap, name) {
            ensureId(el, "ov");
            return {
                opcode: "COMMIT_TRANSFORM",
                targetId: el.id,
                payload: { before: beforeSnap, after: afterSnap },
                name: name || "Transform",
                applied: true
            };
        },
        transforms(items, name) {
            // items: [{ el, before, after }]
            return {
                opcode: "COMMIT_TRANSFORMS",
                targetId: items[0] && items[0].el ? ensureId(items[0].el, "ov") : null,
                payload: {
                    items: items.map((it) => ({
                        targetId: ensureId(it.el, "ov"),
                        before: it.before,
                        after: it.after
                    }))
                },
                name: name || "Transform group",
                applied: true
            };
        },
        style(el, beforeCss, afterCss, name) {
            ensureId(el, "ov");
            return {
                opcode: "SET_STYLE",
                targetId: el.id,
                payload: { prop: "cssText", before: beforeCss, after: afterCss },
                name: name || "Style",
                applied: true
            };
        },
        textState(overlay, before, after, name) {
            ensureId(overlay, "ov");
            const tc = overlay.querySelector(".textContent");
            if (tc) ensureId(tc, "txt");
            return {
                opcode: "SET_TEXT_STATE",
                targetId: overlay.id,
                payload: {
                    before,
                    after,
                    textContentId: tc ? tc.id : null
                },
                name: name || "Text edit",
                applied: true
            };
        },
        reorder(el, parent, beforeNextId, afterNextId, name) {
            ensureId(el, "ov");
            ensureId(parent, "pg");
            return {
                opcode: "REORDER_CHILD",
                targetId: el.id,
                payload: {
                    parentId: parent.id,
                    beforeNextSiblingId: beforeNextId,
                    afterNextSiblingId: afterNextId
                },
                name: name || "Reorder",
                applied: true
            };
        },
        compound(steps, name) {
            return {
                opcode: "COMPOUND",
                payload: { steps },
                name: name || "Compound",
                applied: true
            };
        },
        zIndex(el, beforeZ, afterZ, name) {
            ensureId(el, "ov");
            return {
                opcode: "SET_ZINDEX",
                targetId: el.id,
                payload: { before: String(beforeZ), after: String(afterZ) },
                name: name || "Layer order",
                applied: true
            };
        },
        zIndexGroup(items, name) {
            // items: [{ el, before, after }]
            return {
                opcode: "SET_ZINDEX",
                targetId: items[0] ? ensureId(items[0].el, "ov") : null,
                payload: {
                    items: items.map((it) => ({
                        targetId: ensureId(it.el, "ov"),
                        before: String(it.before),
                        after: String(it.after)
                    }))
                },
                name: name || "Group layer order",
                applied: true
            };
        },
        dataset(el, beforeObj, afterObj, name, mode) {
            ensureId(el, "ov");
            return {
                opcode: "SET_DATASET",
                targetId: el.id,
                payload: {
                    before: beforeObj,
                    after: afterObj,
                    mode: mode || "patch"
                },
                name: name || "Edit data",
                applied: true
            };
        }
    };

    global.GaProcessor = {
        commit,
        execute,
        invert: invertInstruction,
        register,
        ensureId,
        byId,
        snapshotNode,
        snapshotTransform,
        applyTransformSnapshot,
        build,
        opcodes: Object.keys(INVERSE_OPCODE)
    };

    // Short alias used by UI code
    global.dispatchInstruction = function (inst) {
        return commit(inst);
    };
})(typeof window !== "undefined" ? window : globalThis);
