// ==========================================
// form-fields.js: FILLABLE ACROFORM DESIGNER
// ==========================================
// Design-time DOM widgets. On Save PDF, written as real PDF form fields
// via pdf-lib so Adobe / Edge / etc. can fill and save a copy.

window.FORM_FIELD_MODES = new Set([
    "form_text",
    "form_checkbox",
    "form_radio",
    "form_dropdown",
    "form_signature"
]);

window.isFormFieldMode = function(mode) {
    return window.FORM_FIELD_MODES.has(mode || APP.currentMode);
};

window.formFieldTypeFromMode = function(mode) {
    switch (mode) {
        case "form_checkbox": return "checkbox";
        case "form_radio": return "radio";
        case "form_dropdown": return "dropdown";
        case "form_signature": return "signature";
        default: return "text";
    }
};

window.nextFormFieldSerial = window.nextFormFieldSerial || 1;

window.cssEscape = function(value) {
    if (window.CSS && typeof CSS.escape === "function") return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
};

window.generateFormFieldName = function(type) {
    const prefix =
        type === "checkbox" ? "chk" :
        type === "radio" ? "radio" :
        type === "dropdown" ? "dd" :
        type === "signature" ? "sig" :
        "txt";
    let name;
    do {
        name = `${prefix}_${window.nextFormFieldSerial++}`;
    } while (document.querySelector(`.formFieldOverlay[data-field-name="${window.cssEscape(name)}"]`));
    return name;
};

window.generateRadioOptionValue = function(groupName) {
    const existing = Array.from(
        document.querySelectorAll(`.formFieldOverlay[data-field-type="radio"][data-field-name="${window.cssEscape(groupName)}"]`)
    ).map(el => el.dataset.optionValue);
    let i = 1;
    let val;
    do {
        val = `opt_${i++}`;
    } while (existing.includes(val));
    return val;
};

/**
 * PDF field names for export. Flat (no dots) so pdf-lib never throws on
 * hierarchical / empty name parts. Keep readable unique tokens.
 */
window.sanitizeFormFieldName = function(raw) {
    let cleaned = String(raw || "")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^A-Za-z0-9._-]/g, "")
        .replace(/\.+/g, "_")          // no hierarchical names
        .replace(/_+/g, "_")
        .replace(/^[_-]+|[_-]+$/g, "");
    if (!cleaned) cleaned = window.generateFormFieldName("text");
    // pdf-lib rejects empty segments; also avoid leading digits-only weirdness
    if (!/^[A-Za-z]/.test(cleaned)) cleaned = "f_" + cleaned;
    return cleaned;
};

window.getFormFieldOverlays = function(root) {
    const scope = root || document;
    return scope.querySelectorAll(".formFieldOverlay");
};

window.defaultFormFieldSize = function(type) {
    if (type === "checkbox" || type === "radio") return { w: 22, h: 22 };
    if (type === "signature") return { w: 200, h: 56 };
    return { w: 180, h: 28 };
};

/**
 * Build Editor-mode fill controls (input/select/checkbox) for a designer field.
 * Visible only in workspace-editor + tool-select (see CSS).
 */
window.buildFormFieldFillSurface = function(el) {
    const type = el.dataset.fieldType || "text";
    const fill = document.createElement("div");
    fill.className = "form-field-fill";
    fill.addEventListener("mousedown", e => e.stopPropagation());
    fill.addEventListener("pointerdown", e => e.stopPropagation());

    const name = el.dataset.fieldName || "field";
    const fontSize = Math.max(8, parseFloat(el.dataset.fontSize) || 12);
    const def = el.dataset.defaultValue || "";

    if (type === "checkbox") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "form-field-fill-control";
        input.checked = def === "1" || def === "true" || def === "Yes";
        input.addEventListener("change", () => {
            el.dataset.defaultValue = input.checked ? "1" : "";
            if (typeof window.logProjectAudit === "function") {
                window.logProjectAudit("FIELD_FILLED", {
                    fieldName: el.dataset.fieldName,
                    fieldType: "checkbox",
                    value: input.checked ? "1" : ""
                });
            }
        });
        fill.appendChild(input);
    } else if (type === "radio") {
        const input = document.createElement("input");
        input.type = "radio";
        input.className = "form-field-fill-control";
        // Scope radio group names per document tab (multi-tab safe)
        const docScope = (el.closest(".doc-viewer") && el.closest(".doc-viewer").dataset.docId)
            || (el.closest(".pageWrapper") && el.closest(".pageWrapper").dataset.pdfFingerprint)
            || "doc";
        input.name = "fill_" + String(docScope).replace(/\W+/g, "_") + "_" + name;
        input.value = el.dataset.optionValue || "opt";
        input.checked = def === "1" || def === input.value;
        input.addEventListener("change", () => {
            if (!input.checked) return;
            // Clear siblings in group
            const radioRoot = el.closest(".doc-viewer")
                || el.closest(".pageWrapper")
                || document;
            radioRoot.querySelectorAll(
                `.formFieldOverlay[data-field-type="radio"][data-field-name="${window.cssEscape(name)}"]`
            ).forEach(sib => {
                sib.dataset.defaultValue = sib === el ? "1" : "";
                const r = sib.querySelector(".form-field-fill-control");
                if (r && r !== input) r.checked = false;
            });
            el.dataset.defaultValue = "1";
            if (typeof window.logProjectAudit === "function") {
                window.logProjectAudit("FIELD_FILLED", {
                    fieldName: el.dataset.fieldName,
                    fieldType: "radio",
                    optionValue: el.dataset.optionValue
                });
            }
        });
        fill.appendChild(input);
    } else if (type === "dropdown") {
        const sel = document.createElement("select");
        sel.className = "form-field-fill-control";
        sel.style.fontSize = fontSize + "px";
        let opts = [];
        try { opts = JSON.parse(el.dataset.options || "[]"); } catch (_) { opts = []; }
        if (!opts.length) opts = ["Option 1", "Option 2"];
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "—";
        sel.appendChild(blank);
        opts.forEach(o => {
            const op = document.createElement("option");
            op.value = o;
            op.textContent = o;
            if (String(o) === def) op.selected = true;
            sel.appendChild(op);
        });
        sel.addEventListener("change", () => {
            el.dataset.defaultValue = sel.value;
            if (typeof window.logProjectAudit === "function") {
                window.logProjectAudit("FIELD_FILLED", {
                    fieldName: el.dataset.fieldName,
                    fieldType: "dropdown",
                    value: sel.value
                });
            }
        });
        fill.appendChild(sel);
    } else if (type === "signature") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "form-field-fill-control form-field-fill-sig";
        btn.textContent = def ? "Signed" : "Click to sign…";
        btn.addEventListener("click", () => {
            if (typeof window.openSignatureForFormField === "function") {
                window.openSignatureForFormField(el, btn);
            } else {
                const sigName = window.prompt("Type name for signature (or leave blank to clear):", def || "");
                if (sigName === null) return;
                el.dataset.defaultValue = sigName;
                btn.textContent = sigName ? "Signed" : "Click to sign…";
                if (typeof window.logProjectAudit === "function") {
                    window.logProjectAudit("FIELD_FILLED", {
                        fieldName: el.dataset.fieldName,
                        fieldType: "signature",
                        value: sigName ? "(signed)" : ""
                    });
                }
            }
        });
        fill.appendChild(btn);
    } else {
        const multi = el.dataset.multiline === "1";
        const input = document.createElement(multi ? "textarea" : "input");
        if (!multi) input.type = "text";
        input.className = "form-field-fill-control";
        input.value = def;
        input.style.fontSize = fontSize + "px";
        if (multi) {
            input.rows = 2;
        }
        // Commit on blur (not every keystroke) so the rolling log stays useful
        input.addEventListener("blur", () => {
            const prev = el.dataset.defaultValue || "";
            el.dataset.defaultValue = input.value;
            if (prev !== input.value && typeof window.logProjectAudit === "function") {
                window.logProjectAudit("FIELD_FILLED", {
                    fieldName: el.dataset.fieldName,
                    fieldType: multi ? "text_multiline" : "text",
                    value: input.value
                });
            }
        });
        fill.appendChild(input);
    }
    return fill;
};

/**
 * Create a designer widget for a fillable field.
 * Form mode = design chrome; Editor + Pointer = fill surface.
 */
window.createFormFieldOverlay = function(container, opts = {}) {
    const type = opts.type || "text";
    const defaults = window.defaultFormFieldSize(type);
    const x = opts.x ?? 40;
    const y = opts.y ?? 40;
    const w = opts.w ?? defaults.w;
    const h = opts.h ?? defaults.h;

    const el = document.createElement("div");
    el.className = `formFieldOverlay form-field-${type}` + (opts.activate === false ? "" : " overlay-active");
    el.id = opts.id || crypto.randomUUID();
    el.dataset.fieldType = type;
    el.dataset.fieldName = opts.fieldName || window.generateFormFieldName(type);
    el.dataset.required = opts.required ? "1" : "0";
    el.dataset.multiline = opts.multiline ? "1" : "0";
    el.dataset.defaultValue = opts.defaultValue != null ? String(opts.defaultValue) : "";
    el.dataset.fontSize = String(opts.fontSize || 12);
    if (opts.nativeId) el.dataset.nativeId = String(opts.nativeId);

    if (type === "dropdown") {
        const options = Array.isArray(opts.options) && opts.options.length
            ? opts.options
            : ["Option 1", "Option 2", "Option 3"];
        el.dataset.options = JSON.stringify(options);
    }

    if (type === "radio") {
        el.dataset.optionValue = opts.optionValue
            || window.generateRadioOptionValue(el.dataset.fieldName);
        // defaultValue "1" means this radio is the group's default selection
    }

    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.width = w + "px";
    el.style.height = h + "px";

    const body = document.createElement("div");
    body.className = "form-field-body";
    body.setAttribute("aria-hidden", "true");

    const badge = document.createElement("span");
    badge.className = "form-field-badge";
    badge.textContent =
        type === "checkbox" ? "☑" :
        type === "radio" ? "◉" :
        type === "dropdown" ? "▾" :
        type === "signature" ? "✍" :
        "T";

    const label = document.createElement("span");
    label.className = "form-field-label";
    label.textContent = type === "radio"
        ? `${el.dataset.fieldName} · ${el.dataset.optionValue}`
        : el.dataset.fieldName;

    if (type === "checkbox") {
        body.innerHTML = `<span class="form-field-check-box"></span>`;
        body.appendChild(badge);
    } else if (type === "radio") {
        body.innerHTML = `<span class="form-field-radio-dot"></span>`;
        body.appendChild(badge);
        const radioHint = document.createElement("span");
        radioHint.className = "form-field-hint";
        radioHint.style.display = "none"; // keep dataset-driven label on controls
        body.appendChild(label);
    } else if (type === "dropdown") {
        body.append(badge, label);
        const chev = document.createElement("span");
        chev.className = "form-field-chevron";
        chev.textContent = "▼";
        body.appendChild(chev);
    } else if (type === "signature") {
        body.append(badge, label);
        const hint = document.createElement("span");
        hint.className = "form-field-hint";
        hint.textContent = "Click to sign (in PDF reader)";
        body.appendChild(hint);
    } else {
        body.append(badge, label);
        const hint = document.createElement("span");
        hint.className = "form-field-hint";
        hint.textContent = el.dataset.defaultValue
            ? el.dataset.defaultValue
            : (el.dataset.multiline === "1" ? "Multiline text field" : "Text field");
        body.appendChild(hint);
    }

    const fill = window.buildFormFieldFillSurface(el);

    const controls = window.buildFormFieldControls(el);
    const dragHandle = document.createElement("div");
    dragHandle.className = "textDragHandle";
    dragHandle.innerHTML = "⠿";
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "resizeHandle";
    const deleteHandle = window.createDeleteHandle(el);

    el.append(fill, body, controls, dragHandle, resizeHandle, deleteHandle);
    container.appendChild(el);

    window.makeDraggable(el, resizeHandle, dragHandle);
    if (opts.activate !== false) {
        window.setActiveOverlay(el);
    }

    if (opts.pushHistory !== false && window.GaProcessor) {
        window.GaProcessor.commit(
            window.GaProcessor.build.createNode(el, `Add form field (${type})`)
        );
    }

    return el;
};

window.refreshFormFieldLabel = function(el) {
    const label = el.querySelector(".form-field-label");
    if (!label) return;
    if (el.dataset.fieldType === "radio") {
        label.textContent = `${el.dataset.fieldName} · ${el.dataset.optionValue || ""}`;
    } else {
        label.textContent = el.dataset.fieldName || "";
    }
};

window.buildFormFieldControls = function(el) {
    const controls = document.createElement("div");
    controls.className = "textControls form-field-controls";
    controls.addEventListener("mousedown", e => e.stopPropagation());

    const type = el.dataset.fieldType || "text";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "form-field-name-input";
    nameInput.title = type === "radio"
        ? "Radio group name (shared by buttons in the same group)"
        : "PDF field name (unique)";
    nameInput.placeholder = type === "radio" ? "group_name" : "field_name";
    nameInput.value = el.dataset.fieldName || "";
    nameInput.style.width = type === "radio" ? "100px" : "110px";

    nameInput.addEventListener("change", () => {
        const next = window.sanitizeFormFieldName(nameInput.value);

        if (type !== "radio") {
            const clash = document.querySelector(
                `.formFieldOverlay[data-field-name="${window.cssEscape(next)}"]:not([id="${window.cssEscape(el.id)}"])`
            );
            // Allow multiple radios to share a name; other types must be unique
            if (clash && clash.dataset.fieldType !== "radio") {
                window.customAlert(`Field name "${next}" is already used. Pick another.`);
                nameInput.value = el.dataset.fieldName;
                return;
            }
            // Also block non-radio colliding with an existing radio group name used only by radios? OK either way.
            if (clash && clash.dataset.fieldType === "radio" && type !== "radio") {
                window.customAlert(`"${next}" is a radio group name. Pick another field name.`);
                nameInput.value = el.dataset.fieldName;
                return;
            }
        }

        el.dataset.fieldName = next;
        nameInput.value = next;
        window.refreshFormFieldLabel(el);
    });

    controls.appendChild(nameInput);

    // Box size (W×H) — all field types; corner resize handle also works
    const wLabel = document.createElement("span");
    wLabel.className = "form-field-size-label";
    wLabel.textContent = "W";
    const wInput = document.createElement("input");
    wInput.type = "number";
    wInput.className = "form-field-size-input";
    // Allow tiny widgets (radios/checks often need ~8–12px on dense forms)
    wInput.min = "1";
    wInput.max = "2000";
    wInput.step = "1";
    wInput.title = "Field width (px)";
    wInput.value = String(Math.round(parseFloat(el.style.width) || 100));

    const hLabel = document.createElement("span");
    hLabel.className = "form-field-size-label";
    hLabel.textContent = "H";
    const hInput = document.createElement("input");
    hInput.type = "number";
    hInput.className = "form-field-size-input";
    hInput.min = "1";
    hInput.max = "2000";
    hInput.step = "1";
    hInput.title = "Field height (px)";
    hInput.value = String(Math.round(parseFloat(el.style.height) || 28));

    const applyBoxSize = () => {
        let w = Math.max(1, parseFloat(wInput.value) || 1);
        let h = Math.max(1, parseFloat(hInput.value) || 1);
        if (type === "checkbox" || type === "radio") {
            // Keep square; use the value the user just changed if possible
            const side = document.activeElement === hInput ? h : w;
            w = Math.max(1, side);
            h = w;
        }
        el.style.minWidth = "0";
        el.style.minHeight = "0";
        el.style.width = w + "px";
        el.style.height = h + "px";
        wInput.value = String(Math.round(w));
        hInput.value = String(Math.round(h));
        if (typeof window.syncNativeWidgetGeometryFromDesigner === "function") {
            window.syncNativeWidgetGeometryFromDesigner(el);
        }
    };
    wInput.addEventListener("change", applyBoxSize);
    hInput.addEventListener("change", applyBoxSize);

    // Keep W/H inputs in sync when user drags the corner resize handle
    const ro = new ResizeObserver(() => {
        if (document.activeElement === wInput || document.activeElement === hInput) return;
        wInput.value = String(Math.round(parseFloat(el.style.width) || el.offsetWidth || 0));
        hInput.value = String(Math.round(parseFloat(el.style.height) || el.offsetHeight || 0));
    });
    try { ro.observe(el); } catch (_) { /* ignore */ }

    controls.append(wLabel, wInput, hLabel, hInput);

    if (type === "text") {
        const fontSizeInput = document.createElement("input");
        fontSizeInput.type = "number";
        fontSizeInput.min = "6";
        fontSizeInput.max = "72";
        fontSizeInput.value = el.dataset.fontSize || "12";
        fontSizeInput.title = "Font size in the PDF";
        fontSizeInput.className = "form-field-size-input";
        fontSizeInput.addEventListener("change", () => {
            el.dataset.fontSize = String(Math.max(6, parseInt(fontSizeInput.value, 10) || 12));
            fontSizeInput.value = el.dataset.fontSize;
        });
        const fsLabel = document.createElement("span");
        fsLabel.className = "form-field-size-label";
        fsLabel.textContent = "Aa";
        fsLabel.title = "Font size";

        const multiLabel = document.createElement("label");
        multiLabel.className = "form-field-check-label";
        multiLabel.title = "Multiline text";
        multiLabel.innerHTML = `<input type="checkbox" ${el.dataset.multiline === "1" ? "checked" : ""}> Multi`;
        multiLabel.querySelector("input").addEventListener("change", (e) => {
            el.dataset.multiline = e.target.checked ? "1" : "0";
            const hint = el.querySelector(".form-field-hint");
            if (hint && !el.dataset.defaultValue) {
                hint.textContent = e.target.checked ? "Multiline text field" : "Text field";
            }
        });

        const defInput = document.createElement("input");
        defInput.type = "text";
        defInput.placeholder = "Default value";
        defInput.title = "Optional default text when opened";
        defInput.value = el.dataset.defaultValue || "";
        defInput.style.width = "100px";
        defInput.addEventListener("change", () => {
            el.dataset.defaultValue = defInput.value;
            const hint = el.querySelector(".form-field-hint");
            if (hint) {
                hint.textContent = defInput.value
                    || (el.dataset.multiline === "1" ? "Multiline text field" : "Text field");
            }
        });

        controls.append(fsLabel, fontSizeInput, multiLabel, defInput);
    }

    if (type === "dropdown") {
        const optBtn = document.createElement("button");
        optBtn.type = "button";
        optBtn.className = "form-field-opts-btn";
        optBtn.textContent = "Options…";
        optBtn.title = "Edit dropdown choices";
        optBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            let options = [];
            try { options = JSON.parse(el.dataset.options || "[]"); } catch (_) { options = []; }

            const next = await window.promptFormOptionsList(options, {
                title: "📋 Dropdown options",
                help: "Each row is one choice shown in the PDF dropdown. Press Enter to add another row.",
                minItems: 1
            });
            if (!next) return;
            el.dataset.options = JSON.stringify(next);
        });
        controls.appendChild(optBtn);
    }

    if (type === "checkbox") {
        const defLabel = document.createElement("label");
        defLabel.className = "form-field-check-label";
        defLabel.innerHTML = `<input type="checkbox" ${el.dataset.defaultValue === "1" ? "checked" : ""}> Default on`;
        defLabel.querySelector("input").addEventListener("change", (e) => {
            el.dataset.defaultValue = e.target.checked ? "1" : "0";
        });
        controls.appendChild(defLabel);
    }

    if (type === "radio") {
        const optInput = document.createElement("input");
        optInput.type = "text";
        optInput.title = "Export value for this button (unique within the group)";
        optInput.placeholder = "option value";
        optInput.value = el.dataset.optionValue || "";
        optInput.style.width = "90px";
        optInput.addEventListener("change", () => {
            const v = window.sanitizeFormFieldName(optInput.value) || window.generateRadioOptionValue(el.dataset.fieldName);
            // uniqueness within group
            const clash = Array.from(
                document.querySelectorAll(
                    `.formFieldOverlay[data-field-type="radio"][data-field-name="${window.cssEscape(el.dataset.fieldName)}"]`
                )
            ).find(other => other !== el && other.dataset.optionValue === v);
            if (clash) {
                window.customAlert(`Option value "${v}" is already used in this radio group.`);
                optInput.value = el.dataset.optionValue;
                return;
            }
            el.dataset.optionValue = v;
            optInput.value = v;
            window.refreshFormFieldLabel(el);
        });

        const defLabel = document.createElement("label");
        defLabel.className = "form-field-check-label";
        defLabel.title = "Selected by default when the PDF is opened";
        defLabel.innerHTML = `<input type="checkbox" ${el.dataset.defaultValue === "1" ? "checked" : ""}> Default`;
        defLabel.querySelector("input").addEventListener("change", (e) => {
            const on = e.target.checked;
            if (on) {
                // Only one default per group
                document.querySelectorAll(
                    `.formFieldOverlay[data-field-type="radio"][data-field-name="${window.cssEscape(el.dataset.fieldName)}"]`
                ).forEach(other => {
                    other.dataset.defaultValue = other === el ? "1" : "0";
                    const cb = other.querySelector(".form-field-controls .form-field-check-label input");
                    if (cb && other !== el) cb.checked = false;
                });
            }
            el.dataset.defaultValue = on ? "1" : "0";
        });

        controls.append(optInput, defLabel);
    }

    if (type === "signature") {
        const note = document.createElement("span");
        note.className = "form-field-check-label";
        note.style.color = "#5b21b6";
        note.textContent = "Sign in PDF reader";
        note.title = "Creates a signature widget. Recipients sign with their PDF app (not a certificate crypto API here).";
        controls.appendChild(note);
    }

    return controls;
};

/**
 * Collect form field specs for a page container (CSS top-left coords at base scale).
 */
/** Read geometry even if style.* was cleared but layout still has box. */
window.readFormFieldBox = function(el) {
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    const w = parseFloat(el.style.width);
    const h = parseFloat(el.style.height);
    return {
        x: Number.isFinite(left) ? left : (el.offsetLeft || 0),
        y: Number.isFinite(top) ? top : (el.offsetTop || 0),
        w: Number.isFinite(w) && w > 0 ? w : (el.offsetWidth || 100),
        h: Number.isFinite(h) && h > 0 ? h : (el.offsetHeight || 24)
    };
};

window.serializeFormFieldElement = function(el) {
    if (!el || !el.classList || !el.classList.contains("formFieldOverlay")) return null;
    const type = el.dataset.fieldType || "text";
    let options = [];
    if (type === "dropdown") {
        try { options = JSON.parse(el.dataset.options || "[]"); } catch (_) { options = []; }
    }
    const box = window.readFormFieldBox(el);
    return {
        type: "formField",
        fieldType: type,
        fieldName: el.dataset.fieldName || window.generateFormFieldName(type),
        id: el.id || crypto.randomUUID(),
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        required: el.dataset.required === "1",
        multiline: el.dataset.multiline === "1",
        defaultValue: el.dataset.defaultValue || "",
        fontSize: parseFloat(el.dataset.fontSize) || 12,
        optionValue: el.dataset.optionValue || "",
        options,
        nativeId: el.dataset.nativeId || null,
        importedNative: el.dataset.importedNative || null
    };
};

window.serializeFormFieldsFromContainer = function(container) {
    if (!container || !container.querySelectorAll) return [];
    const fields = [];
    container.querySelectorAll(".formFieldOverlay").forEach((el) => {
        const f = window.serializeFormFieldElement(el);
        if (f) fields.push(f);
    });
    return fields;
};

/**
 * Snapshot every designer form shell from page wrappers (KISS export input).
 * Searches the whole .pageWrapper (not only .pageContainer) so shells that
 * sit beside the container or were reparented within the page still count.
 * @returns {{ pageIndex: number, fields: object[] }[]}
 */
window.collectDesignerFormFieldsFromWrappers = function(wrappers) {
    const jobs = [];
    const list = wrappers && wrappers.length != null ? Array.from(wrappers) : [];
    const assigned = new Set();

    for (let i = 0; i < list.length; i++) {
        const w = list[i];
        if (!w || !w.querySelectorAll) continue;
        const fields = [];
        w.querySelectorAll(".formFieldOverlay").forEach((el) => {
            const f = window.serializeFormFieldElement(el);
            if (f) {
                fields.push(f);
                assigned.add(el);
            }
        });
        if (fields.length) jobs.push({ pageIndex: i, fields });
    }

    // Orphans: shells in the active viewer but not under any listed wrapper
    // (should be rare; map to nearest page by geometry, else page 0).
    try {
        const viewer = (typeof window.getActiveViewer === "function" && window.getActiveViewer())
            || (window.APP && APP.DOM && APP.DOM.viewer)
            || null;
        if (viewer && viewer.querySelectorAll) {
            viewer.querySelectorAll(".formFieldOverlay").forEach((el) => {
                if (assigned.has(el)) return;
                const f = window.serializeFormFieldElement(el);
                if (!f) return;
                let pageIndex = 0;
                const host = el.closest && el.closest(".pageWrapper");
                if (host) {
                    const idx = list.indexOf(host);
                    if (idx >= 0) pageIndex = idx;
                }
                let job = jobs.find((j) => j.pageIndex === pageIndex);
                if (!job) {
                    job = { pageIndex, fields: [] };
                    jobs.push(job);
                }
                job.fields.push(f);
                assigned.add(el);
                console.warn("[collectDesignerFormFields] orphan shell assigned to page", pageIndex, f.fieldName);
            });
        }
    } catch (e) {
        console.warn("[collectDesignerFormFields] orphan scan", e);
    }

    jobs.sort((a, b) => a.pageIndex - b.pageIndex);
    return jobs;
};

/**
 * Editor fill often types into PDF.js native widgets while designer twins are hidden.
 * Copy live control values onto designer shells before export/project serialize.
 */
window.syncDesignerFormValuesFromNatives = function(root) {
    const scope = root
        || (typeof window.getActiveViewer === "function" && window.getActiveViewer())
        || document;
    if (!scope || !scope.querySelectorAll) return 0;
    let n = 0;
    scope.querySelectorAll(".formFieldOverlay").forEach((el) => {
        // Prefer values already on the designer fill surface
        const designerCtrl = el.querySelector(".form-field-fill-control");
        if (designerCtrl) {
            if (designerCtrl.type === "checkbox" || designerCtrl.type === "radio") {
                el.dataset.defaultValue = designerCtrl.checked ? "1" : "";
                n++;
                return;
            }
            if (designerCtrl.tagName === "SELECT" || designerCtrl.tagName === "INPUT" || designerCtrl.tagName === "TEXTAREA") {
                el.dataset.defaultValue = String(designerCtrl.value || "");
                n++;
                return;
            }
        }
        const nativeId = el.dataset.nativeId;
        if (!nativeId) return;
        const esc = (window.CSS && CSS.escape)
            ? (s) => CSS.escape(String(s))
            : (s) => String(s).replace(/(["\\])/g, "\\$1");
        let section = null;
        try {
            // tagNativeAnnotationSections sets data-native-id on the section
            section = scope.querySelector(
                `.annotationLayer section[data-native-id="${esc(nativeId)}"]`
            );
            if (!section) {
                const fp = el.dataset.pdfFingerprint || "";
                const layers = fp
                    ? scope.querySelectorAll(`.annotationLayer[data-pdf-fingerprint="${esc(fp)}"] section`)
                    : scope.querySelectorAll(".annotationLayer section");
                for (const s of layers) {
                    if (s.dataset && s.dataset.nativeId === String(nativeId)) {
                        section = s;
                        break;
                    }
                }
            }
        } catch (_) { /* ignore */ }
        if (!section) return;
        const ctrl = section.querySelector("input, textarea, select");
        if (!ctrl) return;
        if (ctrl.type === "checkbox" || ctrl.type === "radio") {
            el.dataset.defaultValue = ctrl.checked ? "1" : "";
        } else {
            el.dataset.defaultValue = String(ctrl.value || "");
        }
        n++;
    });
    return n;
};

/**
 * Snapshot native PDF.js AcroForm widgets when no designer shells exist.
 * Geometry from section bounding box relative to pageContainer.
 */
window.collectNativeFormFieldsFromWrappers = function(wrappers) {
    const jobs = [];
    const list = wrappers && wrappers.length != null ? Array.from(wrappers) : [];
    for (let i = 0; i < list.length; i++) {
        const w = list[i];
        if (!w) continue;
        const container = (w.querySelector && w.querySelector(".pageContainer")) || w;
        const layer = container.querySelector && container.querySelector(".annotationLayer");
        if (!layer) continue;
        const cRect = container.getBoundingClientRect();
        const fields = [];
        const seen = new Set();
        layer.querySelectorAll("section").forEach((section) => {
            // Skip permanently removed / non-widget chrome
            if (section.dataset && section.dataset.formRemoved === "1") return;
            const ctrl = section.querySelector("input, textarea, select");
            if (!ctrl) return;
            const name = (ctrl.getAttribute("name") || section.dataset.fieldName || ctrl.id || "").trim();
            if (!name || seen.has(name + ":" + (ctrl.type || ""))) return;
            // Skip our uniquify prefix noise for field names when possible
            let fieldName = section.dataset.fieldName || name;
            // Strip multi-tab id prefix if present on name
            fieldName = String(fieldName).replace(/^d[a-zA-Z0-9]+_/, "");
            if (fieldName.indexOf("pdfjs_internal") === 0) {
                fieldName = (section.dataset.fieldName || ("field_" + fields.length));
            }

            const sRect = section.getBoundingClientRect();
            const x = sRect.left - cRect.left;
            const y = sRect.top - cRect.top;
            const ww = Math.max(8, sRect.width);
            const hh = Math.max(8, sRect.height);
            if (!Number.isFinite(x) || !Number.isFinite(y) || ww < 2 || hh < 2) return;

            let fieldType = "text";
            let defaultValue = "";
            let options = [];
            if (ctrl.type === "checkbox") {
                fieldType = "checkbox";
                defaultValue = ctrl.checked ? "1" : "";
            } else if (ctrl.type === "radio") {
                fieldType = "radio";
                defaultValue = ctrl.checked ? "1" : "";
            } else if (ctrl.tagName === "SELECT") {
                fieldType = "dropdown";
                defaultValue = String(ctrl.value || "");
                options = Array.from(ctrl.options || []).map((o) => o.value || o.text).filter(Boolean);
            } else if (ctrl.tagName === "TEXTAREA") {
                fieldType = "multiline";
                defaultValue = String(ctrl.value || "");
            } else {
                fieldType = "text";
                defaultValue = String(ctrl.value || "");
            }

            seen.add(name + ":" + (ctrl.type || ""));
            fields.push({
                type: "formField",
                fieldType,
                fieldName: fieldName || ("field_" + fields.length),
                id: section.dataset.nativeId || crypto.randomUUID(),
                x, y, w: ww, h: hh,
                required: !!ctrl.required,
                multiline: fieldType === "multiline",
                defaultValue,
                fontSize: 12,
                optionValue: ctrl.value || "",
                options,
                nativeId: section.dataset.nativeId || null,
                importedNative: "1"
            });
        });
        if (fields.length) jobs.push({ pageIndex: i, fields });
    }
    return jobs;
};

window.restoreFormFieldOverlay = function(container, obj) {
    const el = window.createFormFieldOverlay(container, {
        type: obj.fieldType || "text",
        fieldName: obj.fieldName,
        id: obj.id,
        x: obj.x,
        y: obj.y,
        w: obj.w,
        h: obj.h,
        required: obj.required,
        multiline: obj.multiline,
        defaultValue: obj.defaultValue,
        fontSize: obj.fontSize,
        options: obj.options,
        optionValue: obj.optionValue,
        pushHistory: false,
        activate: false,
        nativeId: obj.nativeId || null
    });
    if (el && obj.importedNative) el.dataset.importedNative = "1";
    // Always treat restored fields that have a nativeId as imported twins
    if (el && obj.nativeId) el.dataset.importedNative = "1";

    const page = container && container.closest(".pageWrapper");
    if (el && page && page.dataset.pdfFingerprint) {
        el.dataset.pdfFingerprint = page.dataset.pdfFingerprint;
    }

    if (el && el.dataset.nativeId && typeof window.setNativeAnnotationVisible === "function") {
        const root = (typeof window.getActiveViewer === "function" && window.getActiveViewer())
            || (el.closest && el.closest(".doc-viewer"))
            || document;
        window.setNativeAnnotationVisible(el.dataset.nativeId, false, {
            fingerprint: el.dataset.pdfFingerprint || undefined,
            fieldName: el.dataset.fieldName || undefined,
            root
        });
        if (typeof window.syncNativeWidgetGeometryFromDesigner === "function") {
            window.syncNativeWidgetGeometryFromDesigner(el);
        }
    }
    return el;
};

/**
 * CSS top-left box → PDF bottom-left box on a page of size pdfW×pdfH.
 * ALWAYS returns finite numbers — NaN boxes make pdf-lib addToPage throw AFTER
 * createTextField already registered the field (fields on form, zero page widgets).
 */
window.cssBoxToPdfBox = function(f, pdfW, pdfH) {
    const num = (v, fallback) => {
        const n = typeof v === "number" ? v : parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    };
    let pw = num(pdfW, 612);
    let ph = num(pdfH, 792);
    if (pw < 1) pw = 612;
    if (ph < 1) ph = 792;

    let w = num(f && f.w, 100);
    let h = num(f && f.h, 24);
    if (w < 1) w = 1;
    if (h < 1) h = 1;

    let x = num(f && f.x, 0);
    let yCss = num(f && f.y, 0);
    x = Math.max(0, Math.min(x, Math.max(0, pw - 2)));
    let y = ph - yCss - h;
    if (!Number.isFinite(y) || y < 0) y = 0;
    if (y + h > ph) y = Math.max(0, ph - h);

    return {
        x: Number(x) || 0,
        y: Number(y) || 0,
        width: Number(w) || 1,
        height: Number(h) || 1
    };
};

/**
 * Create an AcroForm signature widget (pdf-lib has no createSignature helper).
 */
window.createPdfSignatureField = function(pdfDoc, page, fieldName, box) {
    const form = (typeof window.getLivePdfForm === "function")
        ? window.getLivePdfForm(pdfDoc)
        : pdfDoc.getForm();
    if (!form) throw new Error("No live PDFForm for signature field");
    const context = pdfDoc.context;
    const PDFLibNS = window.PDFLib || PDFLib;
    const PDFHexString = PDFLibNS.PDFHexString;
    const PDFString = PDFLibNS.PDFString;

    const nameObj = PDFHexString && PDFHexString.fromText
        ? PDFHexString.fromText(fieldName)
        : (PDFString && PDFString.of ? PDFString.of(fieldName) : fieldName);

    const dict = context.obj({
        FT: "Sig",
        Type: "Annot",
        Subtype: "Widget",
        T: nameObj,
        F: 4,
        P: page.ref,
        Rect: [box.x, box.y, box.x + box.width, box.y + box.height],
    });
    const ref = context.register(dict);

    if (page.node && typeof page.node.addAnnot === "function") {
        page.node.addAnnot(ref);
    } else {
        throw new Error("page.node.addAnnot unavailable");
    }

    // Register on AcroForm
    if (form.acroForm && typeof form.acroForm.addField === "function") {
        form.acroForm.addField(ref);
    } else if (typeof form.markFieldAsDirty === "function") {
        // older paths — try ensure acroform via getForm side effects
        const acro = form.acroForm || (form.doc && form.doc.catalog.getOrCreateAcroForm && form.doc.catalog.getOrCreateAcroForm());
        if (acro && acro.addField) acro.addField(ref);
        else throw new Error("Could not register signature on AcroForm");
    }

    return ref;
};

window.getOrCreateRadioGroup = function(form, name) {
    try {
        return form.getRadioGroup(name);
    } catch (_) {
        return form.createRadioGroup(name);
    }
};

/**
 * pdf-lib throws "No /DA entry" if setFontSize is called before appearances exist.
 * Order: create → addToPage → setText → updateAppearances → setFontSize → updateAppearances.
 * Appearances never throw out — only create/addToPage can fail the embed.
 */
window.embedPdfTextField = function(form, page, name, box, opts = {}) {
    const tf = form.createTextField(name);
    try {
        if (opts.multiline) tf.enableMultiline();
    } catch (_) { /* ignore */ }
    tf.addToPage(page, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
    });
    const text = opts.defaultValue != null ? String(opts.defaultValue) : "";
    try { tf.setText(text); } catch (_) { /* ignore */ }

    const font = opts.font || null;
    const size = Math.max(6, parseFloat(opts.fontSize) || 12);

    if (font) {
        try { tf.updateAppearances(font); } catch (_) { /* ignore */ }
        try {
            tf.setFontSize(size);
            tf.updateAppearances(font);
        } catch (_) { /* ignore */ }
    }
    return tf;
};

/**
 * Create one field + put a widget on the page. Returns true on success.
 * If addToPage rejects the box, retries with a safe on-page rectangle.
 */
window.embedOneFormField = function(form, pdfDoc, page, f, box, font, name) {
    const type = f.fieldType || "text";

    // Repair Annots before every addToPage (strip may have deleted the key)
    if (typeof window.ensurePdfPageAnnotsArray === "function") {
        window.ensurePdfPageAnnotsArray(pdfDoc, page);
    }

    const addWithFallback = (fieldObj, addFn) => {
        try {
            addFn(box);
            return;
        } catch (e1) {
            // Retry after forcing Annots array again (common after strip)
            if (typeof window.ensurePdfPageAnnotsArray === "function") {
                window.ensurePdfPageAnnotsArray(pdfDoc, page);
            }
            let ph = 792;
            try { ph = page.getSize().height || 792; } catch (_) { /* ignore */ }
            const fallback = {
                x: 36,
                y: Math.max(36, ph - 72),
                width: Math.max(24, Number(box && box.width) || 160),
                height: Math.max(14, Number(box && box.height) || 22)
            };
            const msg = (e1 && e1.message) ? String(e1.message) : String(e1);
            // If Annots was the issue, retry original box first after repair
            if (/Annots is undefined|can't access property \"push\"/i.test(msg)) {
                try {
                    addFn(box);
                    return;
                } catch (_) { /* fall through to geometry fallback */ }
            }
            console.warn(
                "[embedOneFormField] addToPage failed for", name,
                msg, "box=", box, "→ retry", fallback
            );
            addFn(fallback);
        }
    };

    if (type === "checkbox") {
        const cb = form.createCheckBox(name);
        addWithFallback(cb, (b) => cb.addToPage(page, b));
        try {
            if (f.defaultValue === "1") cb.check();
            else cb.uncheck();
        } catch (_) { /* ignore */ }
        return true;
    }
    if (type === "dropdown") {
        const dd = form.createDropdown(name);
        const opts = (f.options && f.options.length) ? f.options : ["Option 1"];
        try { dd.addOptions(opts); } catch (_) { /* ignore */ }
        addWithFallback(dd, (b) => dd.addToPage(page, b));
        try {
            if (f.defaultValue && opts.includes(f.defaultValue)) dd.select(f.defaultValue);
            else if (opts[0]) dd.select(opts[0]);
        } catch (_) { /* ignore */ }
        if (font) {
            try { dd.updateAppearances(font); } catch (_) { /* ignore */ }
        }
        return true;
    }
    if (type === "signature") {
        try {
            window.createPdfSignatureField(pdfDoc, page, name, box);
            return true;
        } catch (sigErr) {
            console.warn("[embedOneFormField] signature→text", name, sigErr && sigErr.message);
            // fall through to text with same name — signature create may have partially failed
        }
        // If signature registered the name, text create will throw; use unique suffix
        let textName = name;
        try {
            if (form.getFieldMaybe && form.getFieldMaybe(name)) textName = name + "_txt";
        } catch (_) { /* ignore */ }
        window.embedPdfTextField(form, page, textName, box, {
            multiline: false, fontSize: f.fontSize || 12, defaultValue: "", font
        });
        return true;
    }

    // text / multiline / unknown — create + addToPage with fallback
    const tf = form.createTextField(name);
    try {
        if (f.multiline || type === "multiline") tf.enableMultiline();
    } catch (_) { /* ignore */ }
    addWithFallback(tf, (b) => tf.addToPage(page, {
        x: b.x, y: b.y, width: b.width, height: b.height
    }));
    try { tf.setText(f.defaultValue != null ? String(f.defaultValue) : ""); } catch (_) { /* ignore */ }
    if (font) {
        try { tf.updateAppearances(font); } catch (_) { /* ignore */ }
        try {
            tf.setFontSize(Math.max(6, parseFloat(f.fontSize) || 12));
            tf.updateAppearances(font);
        } catch (_) { /* ignore */ }
    }
    return true;
};

// --- Workspace: Editor vs Form mode ---
window.applyWorkspaceMode = function(opts = {}) {
    const mode = APP.workspaceMode === "form" ? "form" : "editor";
    APP.workspaceMode = mode;
    // opts.preferredTool — optional tool to select after switch (e.g. "edit", "form_text")

    document.body.classList.toggle("workspace-form", mode === "form");
    document.body.classList.toggle("workspace-editor", mode === "editor");
    if (typeof window.syncToolBodyClass === "function") window.syncToolBodyClass();

    const sw = document.getElementById("workspaceModeSwitch");
    if (sw) {
        sw.classList.toggle("is-editor", mode === "editor");
        sw.classList.toggle("is-form", mode === "form");
        sw.setAttribute("aria-checked", mode === "form" ? "true" : "false");
        sw.title = mode === "form"
            ? "Form workspace — place fillable fields. Click for Editor (or press E)."
            : "Editor workspace — annotate / fill forms with Pointer. Click for Form (or press F).";
    }

    // Drop selection if it belongs to the other layer
    // Form fields stay selectable in Form mode only; in Editor they are fill targets (no design chrome)
    if (APP.activeOverlay) {
        const isForm = APP.activeOverlay.classList.contains("formFieldOverlay");
        if ((mode === "editor" && isForm) || (mode === "form" && !isForm)) {
            window.clearActiveOverlay(true);
        }
    }
    if (window.clearMultiSelection) window.clearMultiSelection();

    window.refreshToolModeOptionsForWorkspace();

    // Choose tool: preferred for editor; Form mode always opens on Pointer
    let tool = opts.preferredTool || null;
    if (mode === "form") {
        tool = "select";
    } else if (tool) {
        // Editor: reject form-only tools
        if (window.isFormFieldMode(tool)) tool = "select";
    } else if (window.isFormFieldMode(APP.currentMode)) {
        tool = "select";
    }

    if (tool) {
        APP.currentMode = tool;
        if (APP.DOM.toolModeSelect) {
            APP.DOM.toolModeSelect.value = tool;
            if (window.updateToolModeSelectStyle) window.updateToolModeSelectStyle(tool);
        }
        if (APP.DOM.viewer) {
            APP.DOM.viewer.style.cursor = tool === "select" ? "default" : "crosshair";
        }
    } else if (window.updateToolModeSelectStyle) {
        window.updateToolModeSelectStyle(APP.currentMode);
    }
};

window.setWorkspaceMode = function(mode, opts = {}) {
    APP.workspaceMode = mode === "form" ? "form" : "editor";
    window.applyWorkspaceMode(opts);
};

window.refreshToolModeOptionsForWorkspace = function() {
    const select = APP.DOM.toolModeSelect || document.getElementById("toolModeSelect");
    if (!select) return;
    const mode = APP.workspaceMode === "form" ? "form" : "editor";

    select.querySelectorAll("option").forEach(opt => {
        const ws = opt.dataset.workspace || "both";
        const show = ws === "both" || ws === mode;
        opt.hidden = !show;
        opt.disabled = !show;
    });

    select.querySelectorAll("optgroup").forEach(group => {
        const anyVisible = Array.from(group.querySelectorAll("option")).some(o => !o.hidden);
        group.hidden = !anyVisible;
        // Some browsers ignore optgroup.hidden — also collapse label via disabled
        group.disabled = !anyVisible;
    });

    // If current value is hidden, fall back to select
    const current = select.querySelector(`option[value="${CSS.escape ? CSS.escape(select.value) : select.value}"]`);
    if (!current || current.hidden) {
        select.value = "select";
        APP.currentMode = "select";
        if (window.updateToolModeSelectStyle) window.updateToolModeSelectStyle("select");
    } else if (window.updateToolModeSelectStyle) {
        window.updateToolModeSelectStyle(APP.currentMode);
    }
};

window.toggleWorkspaceMode = function() {
    if (window.gaConfig && window.gaConfig("enableFormMode", true) === false) {
        window.setWorkspaceMode("editor", { preferredTool: "select" });
        return;
    }
    if (APP.workspaceMode === "form") {
        // Back to editor on Pointer (same as first load)
        window.setWorkspaceMode("editor", { preferredTool: "select" });
    } else {
        // Always enter Form on Pointer so fields aren't hard to select
        window.setWorkspaceMode("form", { preferredTool: "select" });
    }
};

/**
 * Save/print capture must not burn Form-mode / non-pointer dimming into output.
 * - Adds body.capture-safe (full opacity; see style.css)
 * - Temporarily leaves Form workspace chrome so export/print see full-strength layers
 * Does not change APP.workspaceMode / tools permanently.
 */
window.withCaptureSafeAppearance = async function(fn) {
    const inForm = APP.workspaceMode === "form"
        || document.body.classList.contains("workspace-form");
    const hadCaptureSafe = document.body.classList.contains("capture-safe");
    document.body.classList.add("capture-safe");
    if (inForm) {
        document.body.classList.remove("workspace-form");
        document.body.classList.add("workspace-editor");
    }
    // Let the browser apply styles before html2canvas / print clone
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
        return await fn();
    } finally {
        if (!hadCaptureSafe) document.body.classList.remove("capture-safe");
        if (inForm) {
            document.body.classList.add("workspace-form");
            document.body.classList.remove("workspace-editor");
        }
    }
};

// Scripts load after DOM via config loader — safe to init chrome here
(function initWorkspaceModeUi() {
    const formEnabled = !(window.gaConfig && window.gaConfig("enableFormMode", true) === false);
    if (!formEnabled) {
        APP.workspaceMode = "editor";
    }
    window.setWorkspaceMode(APP.workspaceMode || "editor");
    if (typeof window.syncToolBodyClass === "function") window.syncToolBodyClass();
    if (typeof window.updateToolModeSelectStyle === "function") {
        window.updateToolModeSelectStyle(APP.currentMode || "select");
    }
    const sw = document.getElementById("workspaceModeSwitch");
    if (sw && !sw.dataset.bound) {
        sw.dataset.bound = "1";
        if (!formEnabled) {
            sw.style.display = "none";
        } else {
            sw.addEventListener("click", () => window.toggleWorkspaceMode());
            sw.addEventListener("keydown", (e) => {
                if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    window.toggleWorkspaceMode();
                }
            });
        }
    }
})();

/**
 * KISS form write path:
 *  1) Snapshot designer shells from the DOM (plain data)
 *  2) Strip every page Widget annotation
 *  3) Drop /AcroForm + form cache so we never write into an orphan form
 *  4) create* fields on a brand-new catalog AcroForm
 *
 * @param {*} pdfDoc pdf-lib PDFDocument (pages already copied)
 * @param {ParentNode[]|NodeList} wrappers .pageWrapper list aligned with pdf pages
 * @param {*} [font] optional embedded font for appearances
 * @param {{ pageIndex: number, fields: object[] }[]} [precollectedJobs] optional snapshot (native fallback)
 * @returns {Promise<number>} widgets written
 */
window.embedAllFormFields = async function(pdfDoc, wrappers, font, precollectedJobs) {
    if (!pdfDoc) return 0;

    let pageJobs = Array.isArray(precollectedJobs) && precollectedJobs.length
        ? precollectedJobs
        : null;
    if (!pageJobs) {
        pageJobs = typeof window.collectDesignerFormFieldsFromWrappers === "function"
            ? window.collectDesignerFormFieldsFromWrappers(wrappers)
            : [];
    }
    if ((!pageJobs || !pageJobs.length) && typeof window.collectNativeFormFieldsFromWrappers === "function") {
        pageJobs = window.collectNativeFormFieldsFromWrappers(wrappers) || [];
    }
    const designerTotal = pageJobs.reduce((n, j) => n + (j.fields ? j.fields.length : 0), 0);
    console.log(
        "[embedAllFormFields] snapshot fields=", designerTotal,
        "pagesWithFields=", pageJobs.length,
        "pdfPages=", (pdfDoc.getPages() || []).length,
        "sample=", pageJobs[0] && pageJobs[0].fields && pageJobs[0].fields[0]
            ? JSON.stringify({
                name: pageJobs[0].fields[0].fieldName,
                x: pageJobs[0].fields[0].x,
                y: pageJobs[0].fields[0].y,
                w: pageJobs[0].fields[0].w,
                h: pageJobs[0].fields[0].h,
                type: pageJobs[0].fields[0].fieldType
            })
            : null
    );

    if (designerTotal === 0) {
        return 0;
    }

    const pages = pdfDoc.getPages();
    if (!pages || !pages.length) {
        console.error("[embedAllFormFields] pdfDoc has 0 pages");
        return 0;
    }

    // Full strip of old widgets/AcroForm, then brand-new getForm().
    // Do NOT manually poke Fields=[] after this — that desyncs pdf-lib internals.
    if (typeof window.stripAcroFormFieldsFromPdfDoc === "function") {
        window.stripAcroFormFieldsFromPdfDoc(pdfDoc, { prepareForReembed: false });
    }
    if (typeof window.invalidatePdfFormCache === "function") {
        window.invalidatePdfFormCache(pdfDoc);
    }

    let form;
    try {
        form = pdfDoc.getForm(); // creates fresh catalog AcroForm after strip
    } catch (e) {
        console.error("[embedAllFormFields] getForm failed", e);
        return 0;
    }

    // pdf-lib addToPage requires page.normalizedEntries().Annots to be an array.
    // Stripping used to delete /Annots entirely → "can't access property push".
    if (typeof window.ensureAllPdfPagesAnnotsArrays === "function") {
        window.ensureAllPdfPagesAnnotsArrays(pdfDoc);
    }

    let count = 0;
    let failCount = 0;
    const usedNames = new Set();
    const radioDefaults = new Map();
    const radioGroups = new Map();
    const radioSrcToName = new Map();

    const uniqueName = (raw) => {
        let name = "ga_" + window.sanitizeFormFieldName(raw);
        if (usedNames.has(name)) {
            let i = 2;
            while (usedNames.has(name + "_" + i)) i++;
            name = name + "_" + i;
        }
        usedNames.add(name);
        return name;
    };

    // Radios first (shared group names across options)
    for (const job of pageJobs) {
        const page = pages[job.pageIndex];
        if (!page) continue;
        if (typeof window.ensurePdfPageAnnotsArray === "function") {
            window.ensurePdfPageAnnotsArray(pdfDoc, page);
        }
        let pdfW = 612;
        let pdfH = 792;
        try {
            const sz = page.getSize();
            pdfW = sz.width;
            pdfH = sz.height;
        } catch (_) { /* defaults */ }
        for (const f of job.fields) {
            if (f.fieldType !== "radio") continue;
            const srcKey = window.sanitizeFormFieldName(f.fieldName);
            let groupName = radioSrcToName.get(srcKey);
            if (!groupName) {
                groupName = uniqueName(f.fieldName);
                try {
                    radioGroups.set(groupName, form.createRadioGroup(groupName));
                    radioSrcToName.set(srcKey, groupName);
                } catch (e) {
                    failCount++;
                    console.warn("[embedAllFormFields] radio group", groupName, e && e.message);
                    continue;
                }
            }
            const group = radioGroups.get(groupName);
            if (!group) continue;
            const optVal = window.sanitizeFormFieldName(f.optionValue || ("opt_" + (count + 1)));
            const box = window.cssBoxToPdfBox(f, pdfW, pdfH);
            try {
                if (typeof window.ensurePdfPageAnnotsArray === "function") {
                    window.ensurePdfPageAnnotsArray(pdfDoc, page);
                }
                try {
                    group.addOptionToPage(optVal, page, box);
                } catch (e1) {
                    if (typeof window.ensurePdfPageAnnotsArray === "function") {
                        window.ensurePdfPageAnnotsArray(pdfDoc, page);
                    }
                    // Retry original box after Annots repair, then geometry fallback
                    try {
                        group.addOptionToPage(optVal, page, box);
                    } catch (e2) {
                        const fallback = { x: 36, y: 36, width: 18, height: 18 };
                        console.warn("[embedAllFormFields] radio addOption retry", e2 && e2.message);
                        group.addOptionToPage(optVal, page, fallback);
                    }
                }
                count++;
                if (f.defaultValue === "1") radioDefaults.set(groupName, optVal);
            } catch (err) {
                failCount++;
                console.warn("[embedAllFormFields] radio option", groupName, optVal, err && err.message);
            }
        }
    }
    for (const [groupName, optVal] of radioDefaults) {
        try { radioGroups.get(groupName).select(optVal); } catch (_) { /* ignore */ }
    }

    // Non-radio
    for (const job of pageJobs) {
        const page = pages[job.pageIndex];
        if (!page) {
            failCount += job.fields.filter((f) => f.fieldType !== "radio").length;
            console.warn("[embedAllFormFields] missing pdf page index", job.pageIndex);
            continue;
        }
        if (typeof window.ensurePdfPageAnnotsArray === "function") {
            window.ensurePdfPageAnnotsArray(pdfDoc, page);
        }
        let pdfW = 612;
        let pdfH = 792;
        try {
            const sz = page.getSize();
            pdfW = sz.width;
            pdfH = sz.height;
        } catch (e) {
            console.warn("[embedAllFormFields] getSize failed, using letter defaults", e);
        }

        for (const f of job.fields) {
            if (f.fieldType === "radio") continue;
            const name = uniqueName(f.fieldName);
            const box = window.cssBoxToPdfBox(f, pdfW, pdfH);
            try {
                window.embedOneFormField(form, pdfDoc, page, f, box, font, name);
                count++;
            } catch (err) {
                failCount++;
                // Field may already be on the form without a page widget — try remove
                try {
                    const orphan = form.getFieldMaybe && form.getFieldMaybe(name);
                    if (orphan && form.removeField) form.removeField(orphan);
                } catch (_) { /* ignore */ }
                console.warn(
                    "[embedAllFormFields] failed",
                    name,
                    f.fieldType,
                    "box=", JSON.stringify(box),
                    "pageSize=", pdfW, "x", pdfH,
                    "src=", f.x, f.y, f.w, f.h,
                    err && (err.message || err)
                );
            }
        }
    }

    try {
        if (font) form.updateFieldAppearances(font);
    } catch (e) {
        console.warn("[embedAllFormFields] updateFieldAppearances", e);
    }

    // Truth: fields on the form that have at least one widget on a page
    let live = 0;
    let withWidgets = 0;
    try {
        const fields = form.getFields();
        live = fields.length;
        fields.forEach((field) => {
            try {
                const widgets = field.acroField && field.acroField.getWidgets
                    ? field.acroField.getWidgets()
                    : [];
                if (widgets && widgets.length) withWidgets++;
            } catch (_) { /* ignore */ }
        });
    } catch (_) { live = -1; }

    // Prefer real widget count; fall back to our success counter
    const written = withWidgets > 0 ? withWidgets : count;
    console.log(
        "[embedAllFormFields] wrote=", written,
        "okSteps=", count,
        "failed=", failCount,
        "form.getFields()=", live,
        "fieldsWithPageWidgets=", withWidgets
    );

    if (written === 0 && designerTotal > 0) {
        console.error(
            "[embedAllFormFields] DOM had", designerTotal,
            "designer field(s) but 0 page widgets — see failed logs above"
        );
    }
    return written;
};

/** @deprecated per-page helper — prefer embedAllFormFields */
window.embedFormFieldsOnPage = async function(pdfDoc, page, container, font) {
    // Minimal compatibility: wrap single page
    const fakeWrapper = { querySelector: () => container };
    // Need page index match — not reliable alone; callers should use embedAllFormFields
    const form = pdfDoc.getForm();
    const fields = window.serializeFormFieldsFromContainer(container);
    if (!fields.length) return 0;
    const pages = pdfDoc.getPages();
    const pageIndex = pages.indexOf(page);
    if (pageIndex < 0) return 0;
    // Build temp list of wrappers aligned to pages
    const wrappers = pages.map((_, i) => (i === pageIndex ? fakeWrapper : { querySelector: () => null }));
    return window.embedAllFormFields(pdfDoc, wrappers, font);
};
