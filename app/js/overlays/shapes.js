window.createDeleteHandle = function(overlayEl) {
    const deleteHandle = document.createElement("div");
    deleteHandle.className = "deleteHandle"; deleteHandle.innerHTML = "&times;"; deleteHandle.title = "Delete";
    deleteHandle.addEventListener("mousedown", e => {
        e.stopPropagation();
        window.clearActiveOverlay();
        window.hideGuides();
        if (window.GaProcessor) {
            const inst = window.GaProcessor.build.deleteNode(overlayEl, "Delete Overlay");
            // Form cleanup before DOM remove so native twins are stripped for export
            if (overlayEl.classList.contains("formFieldOverlay")
                && typeof window.onFormFieldRemoved === "function") {
                window.onFormFieldRemoved(overlayEl);
            }
            overlayEl.remove();
            window.GaProcessor.commit(inst);
        } else {
            if (overlayEl.classList.contains("formFieldOverlay")
                && typeof window.onFormFieldRemoved === "function") {
                window.onFormFieldRemoved(overlayEl);
            }
            overlayEl.remove();
        }
    });
    return deleteHandle;
};

window.buildShapeControls = function(shapeEl, type) {
    const controls = document.createElement("div"); controls.className = "textControls"; controls.addEventListener("mousedown", e => e.stopPropagation());
    const strokeColor = document.createElement("input"); strokeColor.type = "color"; strokeColor.value = "#000000"; strokeColor.title = "Border Color";
    const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
    const strokeWidth = document.createElement("input"); strokeWidth.type = "number"; strokeWidth.min = "1"; strokeWidth.step = "1";
    strokeWidth.value = 3; strokeWidth.style.width = "40px";
    strokeWidth.title = type === "line" ? "Thickness (or drag corner handle to thicken / redact)" : "Thickness";
    controls.append(strokeColor, strokeWidth);

    if (type === "rect" || type === "circle") {
        const fillColor = document.createElement("input"); fillColor.type = "color"; fillColor.value = "#ffffff"; fillColor.title = "Fill Color";
        const transparentCheck = document.createElement("label"); transparentCheck.innerHTML = `<input type="checkbox" checked> No Fill`; transparentCheck.style.fontSize = "12px";
        controls.append(fillColor, transparentCheck);
        if (type === "circle") {
            shapeEl.style.borderRadius = "50%";
        }
        const updateRect = () => {
            shapeEl.style.border = `${strokeWidth.value}px solid ${strokeColor.value}`;
            shapeEl.style.backgroundColor = transparentCheck.querySelector("input").checked ? "transparent" : fillColor.value;
            if (type === "circle") shapeEl.style.borderRadius = "50%";
            // Stroke changes shrink/grow the padding box under border-box; re-anchor chrome to OD
            if (window.adjustToolbarPosition) window.adjustToolbarPosition(shapeEl);
        };
        strokeColor.addEventListener("input", updateRect); strokeWidth.addEventListener("input", updateRect);
        fillColor.addEventListener("input", () => { transparentCheck.querySelector("input").checked = false; updateRect(); });
        transparentCheck.querySelector("input").addEventListener("change", updateRect);
    } else {
        // Restore spinner + color from current style (project load / clone)
        const existingH = parseFloat(shapeEl.style.height);
        if (!isNaN(existingH) && existingH > 0) strokeWidth.value = String(Math.max(1, Math.round(existingH)));
        if (shapeEl.style.backgroundColor) {
            try {
                const hex = window.rgbToHex ? window.rgbToHex(shapeEl.style.backgroundColor) : null;
                if (hex) strokeColor.value = hex;
            } catch (_) { /* keep default */ }
        }
        const updateLine = () => {
            const t = Math.max(1, parseFloat(strokeWidth.value) || 1);
            strokeWidth.value = String(t);
            // Grow thickness about the midline so chrome / OD don't jump one-sided
            const prevH = parseFloat(shapeEl.style.height) || t;
            const prevTop = parseFloat(shapeEl.style.top) || 0;
            const nextH = t;
            shapeEl.style.backgroundColor = strokeColor.value;
            shapeEl.style.height = nextH + "px";
            shapeEl.style.minHeight = "0px";
            if (nextH !== prevH) {
                shapeEl.style.top = (prevTop + (prevH - nextH) / 2) + "px";
            }
            if (window.adjustToolbarPosition) window.adjustToolbarPosition(shapeEl);
        };
        strokeColor.addEventListener("input", updateLine);
        strokeWidth.addEventListener("input", updateLine);
    }
    const dragHandle = document.createElement("div"); dragHandle.className = "textDragHandle"; dragHandle.innerHTML = "⠿";
    const deleteHandle = window.createDeleteHandle(shapeEl);

    let startStyle = "";
    controls.addEventListener("mousedown", () => { startStyle = shapeEl.style.cssText; });
    controls.addEventListener("change", () => {
        const endStyle = shapeEl.style.cssText;
        if (startStyle !== endStyle) {
            const before = startStyle; const target = shapeEl;
            if (window.GaProcessor) {
                window.GaProcessor.commit(window.GaProcessor.build.style(target, before, endStyle, "Change Shape Style"));
            }
        }
    });
    shapeEl.append(controls, rotateHandle, dragHandle, deleteHandle);
};