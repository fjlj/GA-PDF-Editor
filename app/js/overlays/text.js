// ==========================================
// text.js: TEXT BOXES & STAMP VACUUM
// ==========================================

// Create a text overlay (+ cleanup hooks)
window.addTextOverlay = function(container, dropX, dropY) {
    const overlay = document.createElement("div"); 
    overlay.className = "textOverlay overlay-active";
    overlay.style.left = dropX + "px"; 
    overlay.style.top = dropY + "px";
    overlay.style.width = "max-content"; 
    overlay.style.minWidth = "20px"; 
    overlay.style.height = "auto";
    overlay.style.fontFamily = "Roboto";
    overlay.style.fontSize = "14px";
    overlay.style.color = "#000000";
    overlay.style.fontWeight = "400";
    overlay.style.lineHeight = "1.2";
    overlay.style.boxSizing = "border-box";

    const textContent = document.createElement("div"); 
    textContent.className = "textContent"; 
    textContent.contentEditable = "true"; 
    textContent.style.width = "100%"; 
    textContent.style.outline = "none";
    textContent.style.overflowWrap = "nowrap";
	textContent.style.overflowWrap = "normal";
    const controls = document.createElement("div"); 
    controls.className = "textControls"; 
    controls.addEventListener("mousedown", e => e.stopPropagation());
    
    // Wire it up to our shiny new CSS-based Toolbar
    const toolbarObj = window.createRichTextToolbar(textContent, overlay); 
    controls.appendChild(toolbarObj.element);
    toolbarObj.sync("Roboto", 14, "#000000", "400", "1.2");

    const dragHandle = document.createElement("div"); 
    dragHandle.className = "textDragHandle"; 
    dragHandle.innerHTML = "⠿"; 
    dragHandle.addEventListener("mousedown", () => textContent.blur());
	const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
    
    const resizeHandle = document.createElement("div"); 
    resizeHandle.className = "resizeHandle"; 
    
    const deleteHandle = window.createDeleteHandle(overlay);

    overlay.append(controls, dragHandle, rotateHandle, deleteHandle, textContent, resizeHandle); 
    container.appendChild(overlay);
    
    window.setActiveOverlay(overlay); 
    window.makeDraggable(overlay, resizeHandle, dragHandle);
    
    if (window.GaProcessor) {
        window.GaProcessor.commit(window.GaProcessor.build.createNode(overlay, "Add Text Box"));
    }

    // Auto-focus the new box so you can start typing immediately
    setTimeout(() => textContent.focus(), 10);
};


// Stamp selected PDF text into editable overlays
window.processSpansForStamp = function(selectedSpans, container) {
    if (!selectedSpans || selectedSpans.length === 0) return;

    // 1. Sort the captured spans visually (top-to-bottom, left-to-right)
    selectedSpans.sort((a, b) => {
        const aRect = a.getBoundingClientRect(); const bRect = b.getBoundingClientRect();
        if (Math.abs(aRect.top - bRect.top) < 8) return aRect.left - bRect.left;
        return aRect.top - bRect.top;
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let combinedText = "", maxSpanHeight = 0, lastTop = -1;
    let baseStyles = { font: "Roboto", size: 12, color: "#000000", weight: "400", lineHeight: "1.2" };

    // 2. Loop through and extract the text and boundary box
    selectedSpans.forEach((span, i) => {
        const rect = span.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        const x = (rect.left - containerRect.left) / window.currentZoom;
        const y = (rect.top - containerRect.top) / window.currentZoom;
        const w = rect.width / window.currentZoom;
        const h = rect.height / window.currentZoom;

        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
        if (h > maxSpanHeight) maxSpanHeight = h; 

        // If the vertical drop is significant, add a line break!
        if (lastTop !== -1 && Math.abs(rect.top - lastTop) > 8) combinedText += "<br>";
        lastTop = rect.top;
        combinedText += span.textContent + " ";
        
        // Extract styles purely from the first captured word
        if (i === 0) {
            baseStyles = window.getSpanStyles(span, null);
        }
    });

    baseStyles.size = Math.max(8, Math.round(maxSpanHeight) - 1);
    
    // 3. Fire the modal with the vacuumed data!
    window.openEditModal(container, combinedText.trim(), { 
        x: minX - 2, y: minY - 2, width: (maxX - minX) + 6, height: (maxY - minY) + 4 
    }, baseStyles);
};

window.openEditModal = function(container, textHTML, bounds, styles) {
    window.pendingEditTarget = { container, text: textHTML, ...bounds };
    
    const modalText = document.getElementById("editModalText");
    modalText.innerHTML = textHTML;
    modalText.style.fontFamily = styles.font;
    modalText.style.fontSize = styles.size + "px";
    modalText.style.color = styles.color;
    modalText.style.fontWeight = styles.weight;
    modalText.style.lineHeight = styles.lineHeight;

    window.modalToolbar.sync(styles.font, styles.size, styles.color, styles.weight, styles.lineHeight);

    APP.DOM.editModal.style.cssText = "display: flex; left: ''; top: ''; width: ''; transform: '';";
};

document.getElementById("closeEditModalBtn").addEventListener("click", () => { APP.DOM.editModal.style.display = "none"; window.pendingEditTarget = null; });

document.getElementById("applyEditModalBtn").addEventListener("click", () => {
    if (!window.pendingEditTarget) return;
    if (window.disableXRayMode) window.disableXRayMode();

    const target = window.pendingEditTarget; 
    const editBox = document.getElementById("editModalText");
    const textHTML = editBox.innerHTML; 
    
    const bgColor = document.getElementById("editModalBgColor").value;
    const borderColor = document.getElementById("editModalBorderColor").value;
    const noBorder = document.getElementById("editModalNoBorder").checked;

    const overlay = document.createElement("div"); 
    overlay.className = "textOverlay overlay-active";
    overlay.style.left = (target.x + 2) + "px"; 
    overlay.style.top = target.y + "px"; 
    
    const isJustified = editBox.style.textAlign === "justify";
    const fontSize = parseFloat(editBox.style.fontSize) || 14;
    const extraRightPadding = isJustified ? (fontSize * 1.5) : 0; 

    overlay.style.width = "max-content"; 
    overlay.style.minWidth = (target.width + 6 + extraRightPadding) + "px";
    overlay.style.minHeight = "max-content";
    overlay.style.height = "auto"; 
    
    if (isJustified) overlay.style.paddingRight = extraRightPadding + "px";
    
    overlay.style.backgroundColor = bgColor; 
    overlay.style.border = noBorder ? "none" : `2px solid ${borderColor}`;
    
    // No flex here — it was fighting text layout
    overlay.style.display = "block"; 
    overlay.style.boxSizing = "border-box";
    overlay.style.color = editBox.style.color || "#000000"; 
    overlay.style.fontFamily = editBox.style.fontFamily || "Roboto";
    overlay.style.fontSize = editBox.style.fontSize; 
    overlay.style.fontWeight = editBox.style.fontWeight || "400"; 
    overlay.style.lineHeight = editBox.style.lineHeight || "1.2";

    const textContent = document.createElement("div"); 
    textContent.className = "textContent"; 
    textContent.contentEditable = "true"; 
    textContent.innerHTML = window.sanitizeHTML(textHTML); 
    textContent.style.width = "100%"; 
    textContent.style.outline = "none";
	textContent.style.whiteSpace = "nowrap"; 
    textContent.style.overflowWrap = "normal";
    textContent.style.fontWeight = editBox.style.fontWeight || "400"; 
    textContent.style.lineHeight = editBox.style.lineHeight || "1.2";
    textContent.style.textAlign = editBox.style.textAlign || "left";
    if (editBox.style.textAlign === "justify") textContent.style.textAlignLast = "justify";

    const controls = document.createElement("div"); 
    controls.className = "textControls"; 
    controls.addEventListener("mousedown", e => e.stopPropagation());
    
    const toolbarObj = window.createRichTextToolbar(textContent, overlay); 
    controls.appendChild(toolbarObj.element);
    toolbarObj.sync(editBox.style.fontFamily || "Roboto", parseFloat(editBox.style.fontSize) || 14, editBox.style.color || "#000000", editBox.style.fontWeight || "400", editBox.style.lineHeight || "1.2");

    const dragHandle = document.createElement("div"); 
    dragHandle.className = "textDragHandle"; 
    dragHandle.innerHTML = "⠿"; 
    dragHandle.addEventListener("mousedown", () => textContent.blur());
    const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
	
    const resizeHandle = document.createElement("div"); 
    resizeHandle.className = "resizeHandle"; 
    const deleteHandle = window.createDeleteHandle(overlay);

    overlay.append(controls, dragHandle, rotateHandle, deleteHandle, textContent, resizeHandle); 
    target.container.appendChild(overlay);
    
    window.setActiveOverlay(overlay); 
    window.makeDraggable(overlay, resizeHandle, dragHandle);
    if (window.GaProcessor) {
        window.GaProcessor.commit(window.GaProcessor.build.createNode(overlay, "Stamp Edit"));
    }

    APP.DOM.editModal.style.display = "none"; 
    window.pendingEditTarget = null;
});

// --- Text History Tracker ---
let activeTextBeforeState = null;
let activeTextOverlay = null;

window.addEventListener("focusin", e => {
    if (e.target.classList.contains("textContent")) {
        activeTextOverlay = e.target.closest('.textOverlay');       
        if (activeTextOverlay) {
            activeTextBeforeState = {
                html: e.target.innerHTML,
                overlayCss: activeTextOverlay.style.cssText,
                textCss: e.target.style.cssText
            };
            
            // 2. Reposition toolbar if it would clip
            setTimeout(() => window.adjustToolbarPosition(activeTextOverlay), 10);
        }
    }
});

window.addEventListener("focusout", e => {
    // 10ms timeout allows toolbar button clicks to process without breaking focus
    setTimeout(() => {
        // Ignore if focus just moved to the toolbar inside the same overlay
        if (activeTextOverlay && activeTextOverlay.contains(document.activeElement)) return;
        
        if (activeTextOverlay && activeTextBeforeState) {
            const textNode = activeTextOverlay.querySelector('.textContent');
            if (!textNode) return;

            const afterState = {
                html: textNode.innerHTML,
                overlayCss: activeTextOverlay.style.cssText,
                textCss: textNode.style.cssText
            };
            
            // Only push to history if something actually changed!
            if (activeTextBeforeState.html !== afterState.html || 
                activeTextBeforeState.overlayCss !== afterState.overlayCss ||
                activeTextBeforeState.textCss !== afterState.textCss) {
                
                const before = activeTextBeforeState; 
                const target = activeTextOverlay;
                const tNode = textNode;
                
                if (window.GaProcessor) {
                    window.GaProcessor.commit(window.GaProcessor.build.textState(
                        target,
                        before,
                        afterState,
                        activeTextBeforeState.html === "" ? "Initialize Text" : "Text Edit"
                    ));
                }
            }
            activeTextOverlay = null;
            activeTextBeforeState = null;
        }
    }, 10);
});