// ==========================================
// mouse.js: MASTER MOUSE & MARQUEE ENGINE
// ==========================================
//
// IMPORTANT (multi-tab): never bind once to a single viewer element.
// New tabs create new .doc-viewer panes; APP.DOM.viewer is swapped.
// All viewer interactions use live getActiveViewer() + delegation.

let justClearedOverlay = false;
let mouseDownCoords = {x: 0, y: 0};

/** Live active document scroll/canvas root (multi-tab safe). */
window.getActiveViewer = function getActiveViewer() {
    if (APP && APP.DOM && APP.DOM.viewer) return APP.DOM.viewer;
    return document.querySelector("#workspaceRoot .doc-viewer.is-active-doc")
        || document.getElementById("viewer");
};

function eventInActiveViewer(e) {
    const v = window.getActiveViewer();
    if (!v || !e || !e.target) return false;
    return v === e.target || v.contains(e.target);
}

function setViewerCursor(cursor) {
    const v = window.getActiveViewer();
    if (v) v.style.cursor = cursor;
}

APP.DOM.toolModeSelect.addEventListener("change", (e) => {
    const selectedValue = e.target.value;

    // Guard: refuse tools that don't belong to the active workspace
    const opt = e.target.querySelector(`option[value="${selectedValue}"]`);
    const ws = opt?.dataset?.workspace || "both";
    if (ws !== "both" && ws !== (APP.workspaceMode || "editor")) {
        e.target.value = APP.currentMode || "select";
        return;
    }

    if (selectedValue === "insert_signature") {
        if (APP.workspaceMode === "form") { e.target.value = APP.currentMode; return; }
        APP.DOM.sigModal.style.display = "flex"; document.getElementById("sigInput").focus(); e.target.value = APP.currentMode; return;
    }
    if (selectedValue === "toggle_smoothing") {
        APP.isPixelated = !APP.isPixelated;
        const root = window.getActiveViewer() || document;
        root.querySelectorAll(".pageCanvas").forEach(canvas => {
            if (APP.isPixelated) canvas.classList.add("render-pixelated"); else canvas.classList.remove("render-pixelated");
        });
        e.target.value = APP.currentMode; return;
    }
    if (selectedValue === "insert_image") {
        if (APP.workspaceMode === "form") { e.target.value = APP.currentMode; return; }
        document.getElementById("imageInput").click(); e.target.value = APP.currentMode; return;
    }
    APP.currentMode = selectedValue;
    if (window.updateToolModeSelectStyle) window.updateToolModeSelectStyle(APP.currentMode);
    setViewerCursor(APP.currentMode === "select" ? "default" : "crosshair");
    window.clearActiveOverlay();
});

// === Mouse engine ===
window.addEventListener('dragstart', e => {
    if (APP.currentMode === "edit" || APP.currentMode === "select") e.preventDefault();
});

// Delegate from workspace root so every tab's .doc-viewer receives tools/marquee
(function bindViewerMouseDown() {
    const root = document.getElementById("workspaceRoot") || document;
    root.addEventListener("mousedown", onViewerMouseDown);
})();

function onViewerMouseDown(e) {
    if (!eventInActiveViewer(e)) return;

    justClearedOverlay = false;
    mouseDownCoords = { x: e.clientX, y: e.clientY };

    if (APP.DOM.editModal.style.display === "flex" || APP.DOM.sigModal.style.display === "flex") {
        APP.DOM.editModal.style.display = "none"; APP.DOM.sigModal.style.display = "none";
        window.pendingEditTarget = null; justClearedOverlay = true;
        if (window.disableXRayMode) window.disableXRayMode(); 
        return;
    }

    const targetContainer = e.target.closest(".pageContainer");
	const coords = targetContainer ? window.getRelativeCoords(e, targetContainer) : null;
    
    // Pending image / signature drop (Editor only)
    if (APP.workspaceMode !== "form" && (APP.pendingSignatureSrc || APP.pendingImageSrc) && targetContainer) {
        const img = new Image();
        const actionText = APP.pendingSignatureSrc ? "Add Signature" : "Insert Image";
        const descentRatio = APP.pendingSignatureDescent || 0;
        
        img.onload = () => { 
            window.addOverlayImage(img, targetContainer, coords.x, coords.y, actionText, descentRatio); 
        };
        img.src = APP.pendingSignatureSrc || APP.pendingImageSrc;
        APP.pendingSignatureSrc = null; APP.pendingImageSrc = null;
        setViewerCursor(APP.currentMode === "select" ? "default" : "crosshair");
        justClearedOverlay = true; return;
    }

    const isClickingUI = e.target.closest(".textControls, .resizeHandle, .textDragHandle, .stencil-drag-handle, #historySidebar, .form-field-controls");
    const isClickingOverlay = e.target.closest(".overlayImg, .textOverlay, .shapeOverlay, .formFieldOverlay, .stencil-box");
    const isClickingText = e.target.closest(".textLayer span");
    // Designer fill surface / native AcroForm control (Editor interact)
    const isClickingFormInteract = e.target.closest(
        ".form-field-fill, .form-field-fill-control, .annotationLayer input, .annotationLayer textarea, .annotationLayer select, .annotationLayer button"
    );

    // Click-away: blur focused form fill / native field (same end state as Escape).
    // Fill surfaces stopPropagation on themselves, so this only runs for outside clicks.
    if (!isClickingFormInteract && typeof window.blurFormFieldInteraction === "function") {
        if (window.blurFormFieldInteraction()) justClearedOverlay = true;
    }

    if (APP.activeOverlay && !isClickingUI && !isClickingOverlay) {
        window.clearActiveOverlay(); justClearedOverlay = true;
    }

    // Marquee / text vacuum
    // In form mode, only select tool marquee (for form fields). Edit/snip are editor-only.
    const marqueeAllowed =
        APP.currentMode === "select" ||
        (APP.workspaceMode !== "form" && (APP.currentMode === "edit" || APP.currentMode === "snip"));
    if (marqueeAllowed && targetContainer && !isClickingUI && !isClickingOverlay) {
        
        if (APP.currentMode === "select" && isClickingText && APP.workspaceMode !== "form") return; 
        
        e.preventDefault();
        window.getSelection().removeAllRanges(); 
        
        APP.isDrawingMarquee = true; 
		window.clearMultiSelection();
        
        APP.marqueeStartX = coords.x; 
        APP.marqueeStartY = coords.y;
        
        APP.marqueeBox = document.createElement("div"); APP.marqueeBox.className = "selection-marquee";
        
        // Give Edit Mode Text Vacuum the distinct orange style
        if (APP.currentMode === "edit") {
            APP.marqueeBox.style.border = "1px dashed #ff5722";
            APP.marqueeBox.style.backgroundColor = "rgba(255, 87, 34, 0.1)";
        } 
        // Snip marquee styling
        else if (APP.currentMode === "snip") {
            APP.marqueeBox.style.border = "2px dashed #0af";
            APP.marqueeBox.style.backgroundColor = "rgba(0, 170, 255, 0.1)";
            APP.marqueeBox.style.cursor = "crosshair";
        }

        APP.marqueeBox.style.left = APP.marqueeStartX + "px"; APP.marqueeBox.style.top = APP.marqueeStartY + "px";
        APP.marqueeBox.style.width = "0px"; APP.marqueeBox.style.height = "0px";
        targetContainer.appendChild(APP.marqueeBox);
        return;
    }

    // Place text box (Editor)
    if (APP.workspaceMode !== "form" && APP.currentMode === "text" && targetContainer && !isClickingUI) {
        if (e.target.closest(".textOverlay")) return; 
        window.addTextOverlay(targetContainer, coords.x, coords.y);
    }
    // Form field drag-to-size (Form workspace)
    else if (APP.workspaceMode === "form" && window.isFormFieldMode && window.isFormFieldMode(APP.currentMode) && targetContainer && !isClickingUI) {
        if (e.target.closest(".formFieldOverlay")) return;
        e.preventDefault();
        APP.isDrawingFormField = true;
        APP.startX = coords.x;
        APP.startY = coords.y;

        const fieldType = window.formFieldTypeFromMode
            ? window.formFieldTypeFromMode(APP.currentMode)
            : "text";
        const size = window.defaultFormFieldSize
            ? window.defaultFormFieldSize(fieldType)
            : { w: 160, h: 28 };

        APP.currentFormField = window.createFormFieldOverlay(targetContainer, {
            type: fieldType,
            x: APP.startX,
            y: APP.startY,
            w: size.w,
            h: size.h,
            pushHistory: false
        });
        // Hide chrome while dragging size
        const ctrls = APP.currentFormField.querySelector(".textControls");
        if (ctrls) ctrls.style.visibility = "hidden";
    }
    // Draw shape (Editor)
    else if (APP.workspaceMode !== "form" && (APP.currentMode === "rect" || APP.currentMode === "circle" || APP.currentMode === "line" || APP.currentMode === "table") && targetContainer && !isClickingUI) {
        if (e.target.closest(".shapeOverlay")) return; 
        APP.isDrawingShape = true;
        
        APP.startX = coords.x; 
        APP.startY = coords.y;

        APP.currentShape = document.createElement("div");
        APP.currentShape.className = `shapeOverlay shape-${APP.currentMode} overlay-active`;
        APP.currentShape.style.left = APP.startX + "px"; APP.currentShape.style.top = APP.startY + "px";

        if (APP.currentMode === "rect") {
            APP.currentShape.style.border = "3px solid #000000"; APP.currentShape.style.backgroundColor = "transparent";
        } else if (APP.currentMode === "circle") {
            APP.currentShape.style.border = "3px solid #000000";
            APP.currentShape.style.backgroundColor = "transparent";
            APP.currentShape.style.borderRadius = "50%";
        } else if (APP.currentMode === "line") {
            APP.currentShape.style.backgroundColor = "#000000"; APP.currentShape.style.height = "3px"; APP.currentShape.style.transformOrigin = "center";
        } else if (APP.currentMode === "table") {
            APP.currentShape.dataset.rows = "3"; APP.currentShape.dataset.cols = "3";
            APP.currentShape.dataset.outerStyle = "solid"; APP.currentShape.dataset.innerStyle = "solid";
            APP.currentShape.dataset.outerWidth = "3"; APP.currentShape.dataset.innerWidth = "1";
            APP.currentShape.dataset.borderRadius = "0"; 
            
            // default outer/inner colors
            APP.currentShape.dataset.outerColor = "#000000"; 
            APP.currentShape.dataset.innerColor = "#000000"; 
            
            APP.currentShape.style.backgroundColor = "transparent";
            window.renderTableGrid(APP.currentShape);
        }

        const resizeHandle = document.createElement("div"); resizeHandle.className = "resizeHandle";
        APP.currentShape.appendChild(resizeHandle);

        if (APP.currentMode === "table") window.buildTableControls(APP.currentShape);
        else window.buildShapeControls(APP.currentShape, APP.currentMode);
		
		window.makeDraggable(APP.currentShape, resizeHandle, APP.currentShape.querySelector(".textDragHandle"));

        APP.currentShape.querySelector(".textControls").style.visibility = "hidden";
        targetContainer.appendChild(APP.currentShape);
        window.setActiveOverlay(APP.currentShape); e.preventDefault();
    }
    else if (!isClickingUI && !isClickingOverlay) { window.clearActiveOverlay(); }
}

window.addEventListener("mousemove", e => {
    // Resizing form fields while placing
    if (APP.isDrawingFormField && APP.currentFormField) {
        const targetContainer = APP.currentFormField.closest(".pageContainer");
        if (!targetContainer) return;
        const rect = targetContainer.getBoundingClientRect();
        const currentX = (e.clientX - rect.left) / window.currentZoom;
        const currentY = (e.clientY - rect.top) / window.currentZoom;
        const fType = APP.currentFormField.dataset.fieldType;
        const isSquare = fType === "checkbox" || fType === "radio";
        if (isSquare) {
            const side = Math.max(1, Math.max(Math.abs(currentX - APP.startX), Math.abs(currentY - APP.startY)));
            APP.currentFormField.style.minWidth = "0";
            APP.currentFormField.style.minHeight = "0";
            APP.currentFormField.style.width = side + "px";
            APP.currentFormField.style.height = side + "px";
            APP.currentFormField.style.left = Math.min(currentX, APP.startX) + "px";
            APP.currentFormField.style.top = Math.min(currentY, APP.startY) + "px";
        } else {
            const minW = fType === "signature" ? 40 : 1;
            const minH = fType === "signature" ? 16 : 1;
            APP.currentFormField.style.minWidth = "0";
            APP.currentFormField.style.minHeight = "0";
            APP.currentFormField.style.width = Math.max(minW, Math.abs(currentX - APP.startX)) + "px";
            APP.currentFormField.style.height = Math.max(minH, Math.abs(currentY - APP.startY)) + "px";
            APP.currentFormField.style.left = Math.min(currentX, APP.startX) + "px";
            APP.currentFormField.style.top = Math.min(currentY, APP.startY) + "px";
        }
    }

    // Resizing Shapes
    if (APP.isDrawingShape && APP.currentShape) {
        const targetContainer = APP.currentShape.closest(".pageContainer"); 
        if (!targetContainer) return;
        const rect = targetContainer.getBoundingClientRect();
        const currentX = (e.clientX - rect.left) / window.currentZoom; 
        const currentY = (e.clientY - rect.top) / window.currentZoom;
        
        if (APP.currentShape.classList.contains("shape-rect") || APP.currentShape.classList.contains("shape-circle") || APP.currentShape.classList.contains("shape-table")) {
            APP.currentShape.style.width = Math.abs(currentX - APP.startX) + "px"; 
            APP.currentShape.style.height = Math.abs(currentY - APP.startY) + "px";
            APP.currentShape.style.left = Math.min(currentX, APP.startX) + "px"; 
            APP.currentShape.style.top = Math.min(currentY, APP.startY) + "px";
		} 
		else if (APP.currentShape.classList.contains("shape-line")) {
            // line: length + angle from drag midpoint
            const dx = currentX - APP.startX; 
            const dy = currentY - APP.startY;
            const length = Math.hypot(dx, dy); // hypot is a cleaner way to write sqrt(a^2 + b^2)
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const midX = (APP.startX + currentX) / 2;
            const midY = (APP.startY + currentY) / 2;
            // Pull the exact thickness you set during mousedown
            const thickness = parseFloat(APP.currentShape.style.height) || 3;
            APP.currentShape.style.width = length + "px";
            // Anchor CSS left/top to the moving midpoint!
            APP.currentShape.style.left = (midX - (length / 2)) + "px";
            APP.currentShape.style.top = (midY - (thickness / 2)) + "px";
            APP.currentShape.style.transform = `rotate(${angle}deg)`;
            if (window.syncOverlayChromeRotation) window.syncOverlayChromeRotation(APP.currentShape);
        }
    }
    
    // Resizing the Marquee / Text Vacuum
    if (APP.isDrawingMarquee && APP.marqueeBox) {
        const targetContainer = APP.marqueeBox.closest(".pageContainer");
        if (!targetContainer) return;
        
        const coords = window.getRelativeCoords(e, targetContainer);

        APP.marqueeBox.style.width = Math.abs(coords.x - APP.marqueeStartX) + "px"; 
        APP.marqueeBox.style.height = Math.abs(coords.y - APP.marqueeStartY) + "px";
        APP.marqueeBox.style.left = Math.min(coords.x, APP.marqueeStartX) + "px"; 
        APP.marqueeBox.style.top = Math.min(coords.y, APP.marqueeStartY) + "px";
    }
});

// === Mouse up ===
window.addEventListener("mouseup", e => {
    // Resolve form field placement
    if (APP.isDrawingFormField) {
        APP.isDrawingFormField = false;
        if (APP.currentFormField) {
            const field = APP.currentFormField;
            const parent = field.parentElement;
            const ctrls = field.querySelector(".textControls");
            if (ctrls) ctrls.style.visibility = "";
            if (window.adjustToolbarPosition) window.adjustToolbarPosition(field);

            // Click without drag → keep default size from create
            const w = parseFloat(field.style.width) || 0;
            const h = parseFloat(field.style.height) || 0;
            // Pure click (no real drag) → default size; intentional tiny drag is kept
            if (w < 3 || h < 3) {
                const d = window.defaultFormFieldSize
                    ? window.defaultFormFieldSize(field.dataset.fieldType)
                    : { w: 160, h: 28 };
                field.style.width = d.w + "px";
                field.style.height = d.h + "px";
            }

            if (window.GaProcessor) {
                window.GaProcessor.commit(
                    window.GaProcessor.build.createNode(
                        field,
                        `Add form field (${field.dataset.fieldType || "text"})`
                    )
                );
            }
            APP.currentFormField = null;
        }
    }

	// finish shape draw
	if (APP.isDrawingShape) {
        APP.isDrawingShape = false;
        
	if (APP.currentShape) {
            const controls = APP.currentShape.querySelector(".textControls");
            if (controls) controls.style.visibility = ""; 
            if (window.adjustToolbarPosition) window.adjustToolbarPosition(APP.currentShape);
	}	

	// Push the brand new shape to the history engine so undo/redo works!
        if (APP.currentShape) {
            const shape = APP.currentShape;
            if (window.GaProcessor) {
                window.GaProcessor.commit(
                    window.GaProcessor.build.createNode(shape, `Draw ${APP.currentMode}`)
                );
            }
        }
    }
    // Resolve Marquee Box
    if (APP.isDrawingMarquee && APP.marqueeBox) {
        APP.isDrawingMarquee = false;
        const targetContainer = APP.marqueeBox.closest(".pageContainer");
        const marqueeRect = APP.marqueeBox.getBoundingClientRect();

        // TEXT VACUUM LOGIC (EDIT MODE)
        if (APP.currentMode === "edit") {
            const spans = targetContainer.querySelectorAll(".textLayer span");
            const selectedSpans = Array.from(spans).filter(span => window.checkIntersection(marqueeRect, span.getBoundingClientRect()));
            APP.marqueeBox.remove(); APP.marqueeBox = null;

            if (selectedSpans.length > 0) {
                window.getSelection().removeAllRanges();
                window.processSpansForStamp(selectedSpans, targetContainer);
            } else if (marqueeRect.width < 10 && marqueeRect.height < 10 && !justClearedOverlay) {
				const coords = window.getRelativeCoords(e, targetContainer);
				window.openEditModal(targetContainer, "", { x: coords.x, y: coords.y, width: 40, height: 24 }, { font: "Roboto", size: 12, color: "#000000", weight: "400", lineHeight: "1.3" });
			}
        }
        // SELECT MODE LOGIC (STENCIL & GROUPING)
        else if (APP.currentMode === "select") {
            // coords helper handles the math
            window.activeMarqueeBounds = window.getMarqueeBounds(APP.marqueeBox);
            window.activeSelectionContainer = targetContainer;
            
            targetContainer.querySelectorAll(".overlayImg, .textOverlay, .shapeOverlay, .formFieldOverlay").forEach(overlay => {
                if (overlay === APP.marqueeBox) return;
                const isForm = overlay.classList.contains("formFieldOverlay");
                if (APP.workspaceMode === "form" && !isForm) return;
                if (APP.workspaceMode !== "form" && isForm) return;
                if (window.checkIntersection(marqueeRect, overlay.getBoundingClientRect())) {
                    overlay.classList.add("multi-selected"); APP.multiSelectedItems.add(overlay);
                }
            });

            // Stencil works for 1 OR more items!
            if (APP.multiSelectedItems.size >= 1) {
                APP.marqueeBox.className = "stencil-box";
                const dragHandle = document.createElement("div"); dragHandle.className = "stencil-drag-handle"; dragHandle.innerHTML = "⠿"; 
                APP.marqueeBox.appendChild(dragHandle);
                window.activeStencil = APP.marqueeBox;
                window.makeDraggable(window.activeStencil, null, dragHandle);
                APP.marqueeBox = null;
                
                // Show alignment tools only if it's a true group
                if (APP.multiSelectedItems.size >= 1) window.showGroupToolbar();
            } else {
                APP.marqueeBox.remove(); APP.marqueeBox = null;
            }
        }
		// snip cut/paste
        else if (APP.currentMode === "snip") {
            const x = parseFloat(APP.marqueeBox.style.left);
            const y = parseFloat(APP.marqueeBox.style.top);
            const w = parseFloat(APP.marqueeBox.style.width);
            const h = parseFloat(APP.marqueeBox.style.height);
            
            APP.marqueeBox.remove(); APP.marqueeBox = null;

            if (w > 10 || h > 10) {
                // Alt = copy snip instead of move
                const isCopyMode = e.altKey; 

                APP.DOM.toolModeSelect.value = "select";
                APP.DOM.toolModeSelect.dispatchEvent(new Event('change'));

                const whiteoutColor = "#ffffff"; 
                // Pass the modifier flag to the engine
                window.extractCanvasSnippet(targetContainer, x, y, w, h, whiteoutColor, isCopyMode);
            }
        }
    }
});

