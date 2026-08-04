// ==========================================
// utils.js: HELPER FUNCTIONS & UI UTILITIES
// ==========================================

window.checkIntersection = function(rect1, rect2) {
    return !(
        rect1.right < rect2.left || 
        rect1.left > rect2.right || 
        rect1.bottom < rect2.top || 
        rect1.top > rect2.bottom
    );
};

// --- Math & Coordinate Helpers ---
window.getRelativeCoords = function(e, container) {
    const rect = container.getBoundingClientRect();
    const zoom = window.currentZoom || 1;
    return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom
    };
};

window.getMarqueeBounds = function(boxEl) {
    const left = parseFloat(boxEl.style.left) || 0;
    const top = parseFloat(boxEl.style.top) || 0;
    const width = parseFloat(boxEl.style.width) || 0;
    const height = parseFloat(boxEl.style.height) || 0;
    return {
        left, top, width, height,
        right: left + width, bottom: top + height,
        centerX: left + (width / 2), centerY: top + (height / 2)
    };
};

// Pull computed style bits off an element
window.getSpanStyles = function(span) {
    if (!span) return { font: "Roboto", size: 12, color: "#000000", weight: "400", lineHeight: "1.2" };
    const comp = window.getComputedStyle(span);
    return {
        font: comp.fontFamily || "Roboto",
        size: parseFloat(span.style.fontSize) || parseFloat(comp.fontSize) || 12,
        color: window.rgbToHex(comp.color) || "#000000",
        weight: comp.fontWeight || "400",
        lineHeight: "1.2"
    };
};

window.rgbToHex = function(rgb) {
    if (!rgb || rgb.indexOf("rgb") === -1) return "#000000";
    const arr = rgb.match(/\d+/g);
    if (!arr || arr.length < 3) return "#000000";
    return "#" + arr.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
};

// --- Viewport & Scrolling ---
/** Soft tool-dropdown palette (less eye-searing than Material orange) */
window.TOOL_SELECT_COLORS = {
    select: { bg: "#0af", fg: "#fff" },
    form:   { bg: "#8b6cc9", fg: "#fff" },       // soft violet
    editor: { bg: "#e8a57a", fg: "#3d2a1f" }     // pastel peach / coral, dark text
};

/** Tool dropdown color: select=blue, form tools=violet, editor tools=pastel coral */
window.updateToolModeSelectStyle = function(mode) {
    const select = APP.DOM?.toolModeSelect || document.getElementById("toolModeSelect");
    if (!select) return;
    const m = mode != null ? mode : APP.currentMode;
    const pal = window.TOOL_SELECT_COLORS || {};
    let c;
    if (m === "select") c = pal.select || { bg: "#0af", fg: "#fff" };
    else if (window.isFormFieldMode && window.isFormFieldMode(m)) c = pal.form || { bg: "#8b6cc9", fg: "#fff" };
    else c = pal.editor || { bg: "#e8a57a", fg: "#3d2a1f" };
    select.style.background = c.bg;
    select.style.color = c.fg;
    // Pointer tool gates form filling (Editor) — keep body class in sync
    if (typeof window.syncToolBodyClass === "function") window.syncToolBodyClass();
    else {
        document.body.classList.toggle("tool-select", m === "select");
        document.body.classList.toggle("tool-nonselect", m !== "select");
    }
};

window.showVerticalGuide = (x) => { APP.DOM.guideV.style.left = x + "px"; APP.DOM.guideV.style.display = "block"; };
window.showHorizontalGuide = (y) => { APP.DOM.guideH.style.top = y + "px"; APP.DOM.guideH.style.display = "block"; };
window.hideGuides = () => { APP.DOM.guideV.style.display = "none"; APP.DOM.guideH.style.display = "none"; };

window.startAutoScroll = (direction) => { 
    window.stopAutoScroll(); 
    APP.autoScrollInterval = setInterval(() => { APP.DOM.viewer.scrollTop += direction * APP.SCROLL_SPEED; }, 16); 
};
window.stopAutoScroll = () => { 
    if (APP.autoScrollInterval) { clearInterval(APP.autoScrollInterval); APP.autoScrollInterval = null; } 
};

window.setZoom = function(newZoom) {
    window.currentZoom = Math.max(APP.MIN_ZOOM, Math.min(APP.MAX_ZOOM, newZoom));
    const zoomLabel = document.getElementById("zoomLabel");
    if (zoomLabel) zoomLabel.innerText = Math.round(window.currentZoom * 100) + "%";
    document.documentElement.style.setProperty('--ui-inverse-scale', 1 / window.currentZoom);

    // Scope to the active document viewer only (multi-tab safe)
    const root = (APP.DOM && APP.DOM.viewer) || document.getElementById("viewer");
    if (!root) return;
    root.querySelectorAll(".pageWrapper").forEach(wrapper => {
        const baseW = parseFloat(wrapper.dataset.baseWidth);
        const baseH = parseFloat(wrapper.dataset.baseHeight);
        wrapper.style.width = (baseW * window.currentZoom) + "px";
        wrapper.style.height = (baseH * window.currentZoom) + "px";
        const pc = wrapper.querySelector(".pageContainer");
        if (pc) pc.style.transform = `scale(${window.currentZoom})`;
    });

    // Keep active tab bag in sync
    if (window.GaWorkspace && typeof window.GaWorkspace.activeDoc === "function") {
        const doc = window.GaWorkspace.activeDoc();
        if (doc) doc.zoom = window.currentZoom;
    }
};

// --- UI Builders (DRY Improvements) ---
window.createUIInput = function(type, val, title, width) {
    const input = document.createElement("input");
    input.type = type; 
    input.value = val; 
    input.title = title;
    if(width) input.style.width = width;
    return input;
};

// --- Selection Managers ---
window.clearMultiSelection = function() {
    APP.multiSelectedItems.forEach(el => el.classList.remove("multi-selected"));
    APP.multiSelectedItems.clear();
    if (window.hideGroupToolbar) window.hideGroupToolbar();
    window.activeMarqueeBounds = null;
    
    if (window.activeStencil) {
        window.activeStencil.remove();
        window.activeStencil = null;
    }
};

/**
 * Release keyboard focus from Editor form-fill controls (and native AcroForm
 * widgets) so click-away works the same as Escape.
 */
window.blurFormFieldInteraction = function() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = el.tagName;
    const isFormControl = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
    if (!isFormControl && !el.isContentEditable) return false;

    const inDesignerFill = !!(el.closest && (
        el.closest(".form-field-fill")
        || el.classList.contains("form-field-fill-control")
    ));
    const inNativeWidget = !!(el.closest && el.closest(".annotationLayer"));
    if (!inDesignerFill && !inNativeWidget && !el.isContentEditable) return false;

    try { el.blur(); } catch (_) { /* ignore */ }
    return true;
};

window.clearActiveOverlay = function(skipGarbageCollection = false) {
    // Blur form fill / native widgets as well as contentEditable text boxes
    if (typeof window.blurFormFieldInteraction === "function") {
        window.blurFormFieldInteraction();
    } else if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
    }
    if (APP.activeOverlay) {
        
        // History replay: leave the node alone
        if (!skipGarbageCollection && APP.activeOverlay.classList.contains("textOverlay")) {
            const textContent = APP.activeOverlay.querySelector(".textContent");
            if (textContent) {
                const cleanText = textContent.innerText.replace(/\u200B/g, '').trim();
                
                if (cleanText === "") {
                    // Still on the redo stack? keep it
                    const targetEl = APP.activeOverlay;
                    const hasFutureHistory = window.historyEngine.redoStack.some(action => {
                        const targets = Array.isArray(action.target) ? action.target : [action.target];
                        return targets.includes(targetEl);
                    });

					// Leave it alive! unless it has no history.. It will sit silently invisible on the page.
                    if (!hasFutureHistory) {
                        // Safe to nuke!
                        APP.activeOverlay.remove(); 
                        
                        // 🔥 THE SNIPER GC: Hunt down THIS specific box's creation event!
                        const targetEl = APP.activeOverlay;
                        const stack = window.historyEngine.undoStack;
                        
                        for (let i = stack.length - 1; i >= 0; i--) {
                            const action = stack[i];
                            // Match the name AND the exact DOM node reference
                            if (action.name === "Add Text Box" && action.target === targetEl) {
                                stack.splice(i, 1); // Rip it out of the array
                                window.updateHistoryUI();
                                break; // Target neutralized, stop searching
                            }
                        }
                    }
                }
            }
        }
        
        // If the overlay survived the garbage collector, safely remove its active class
        if (APP.activeOverlay && APP.activeOverlay.parentNode) {
            APP.activeOverlay.classList.remove("overlay-active");
        }
        
        APP.activeOverlay = null;
    }
};

window.setActiveOverlay = function(el) {
    if (APP.activeOverlay && APP.activeOverlay !== el) APP.activeOverlay.classList.remove("overlay-active");
	if (document.activeElement && document.activeElement.isContentEditable && !el.contains(document.activeElement)) {
            document.activeElement.blur();
        }
    APP.activeOverlay = el;
    if (el) {
        el.classList.add("overlay-active");
        window.adjustToolbarPosition(el); // keep toolbar on-screen
    }
};

/**
 * Sync overlay chrome layout metrics:
 *  - --chrome-counter-rot  → keep toolbar/handles screen-upright when object rotates
 *  - --od-bt/br/bb/bl      → border widths so chrome anchors to the OUTER box (OD),
 *                            not the padding edge (which shrinks when stroke grows under border-box)
 */
window.syncOverlayChrome = function(overlay) {
    if (!overlay || !overlay.style) return;

    const t = overlay.style.transform || "";
    const match = /rotate\(\s*([-.\d]+)\s*deg\s*\)/i.exec(t);
    const angle = match ? parseFloat(match[1]) : 0;
    if (!angle || isNaN(angle)) {
        overlay.style.removeProperty("--chrome-counter-rot");
    } else {
        overlay.style.setProperty("--chrome-counter-rot", `${-angle}deg`);
    }

    let bt = 0, br = 0, bb = 0, bl = 0;
    try {
        const cs = window.getComputedStyle(overlay);
        bt = parseFloat(cs.borderTopWidth) || 0;
        br = parseFloat(cs.borderRightWidth) || 0;
        bb = parseFloat(cs.borderBottomWidth) || 0;
        bl = parseFloat(cs.borderLeftWidth) || 0;
    } catch (_) { /* keep zeros */ }

    overlay.style.setProperty("--od-bt", bt + "px");
    overlay.style.setProperty("--od-br", br + "px");
    overlay.style.setProperty("--od-bb", bb + "px");
    overlay.style.setProperty("--od-bl", bl + "px");

    return { bt, br, bb, bl, angle: angle || 0 };
};

/** @deprecated alias — use syncOverlayChrome */
window.syncOverlayChromeRotation = window.syncOverlayChrome;

// Toolbar placement (flip/nudge so it stays visible)
window.adjustToolbarPosition = function(overlay) {
    if (!overlay) return;
    const od = window.syncOverlayChrome ? window.syncOverlayChrome(overlay) : { bt: 0, br: 0, bb: 0, bl: 0 };
    const controls = overlay.querySelector('.textControls');
    const page = overlay.closest('.pageContainer');
    if (!controls || !page) return;
    
    // Disable transitions momentarily
    const oldTransition = controls.style.transition;
    controls.style.transition = "none";

    const wasHidden = window.getComputedStyle(controls).display === "none";
    if (wasHidden) {
        controls.style.visibility = "hidden";
        controls.style.display = "flex";
    }
    
    // 1. Reset — anchor to OUTER diameter (padding edge + border), not the ID/padding box
    //    Absolute % positions resolve against the padding box; add border widths to sit on OD.
    const bt = od.bt || 0;
    const bb = od.bb || 0;
    const bl = od.bl || 0;
    controls.style.bottom = `calc(100% + ${bt}px)`;
    controls.style.top = "auto";
    controls.style.left = `calc(0px - ${bl}px)`;
    controls.style.right = "auto";
    controls.style.marginLeft = "0px"; 
    
    // Force DOM layout recalculation
    void controls.offsetWidth; 
    
    // 2. Y-Axis Check (Still using screen coords here just to check if it hits the top UI header)
    const rect = controls.getBoundingClientRect();
    const viewerRect = APP.DOM.viewer.getBoundingClientRect();
    let flippedY = false;
    
    if (rect.top < viewerRect.top + 40) { 
        controls.style.bottom = "auto";
        controls.style.top = `calc(100% + ${bb}px)`;
        flippedY = true;
    }
    
    // 3. Horizontal nudge if toolbar would hang off the page
    // Because 'overlay' and 'page' scale together, their offsetWidth/offsetLeft 
    // represent the true logical pixels of your document, ignoring the zoom completely.
    // offsetLeft/offsetWidth are border-box (OD) coordinates.
    const overlayLeft = overlay.offsetLeft;
    const controlsWidth = controls.offsetWidth;
    const pageWidth = page.offsetWidth;
    
    let shiftX = 0;
    
    // Toolbar starts at OD left (left: -bl); spill check uses outer left
    const currentRightEdge = overlayLeft + controlsWidth;
    
    // If it spills off the right edge of the PDF page, nudge it back
    if (currentRightEdge > pageWidth) {
        shiftX = pageWidth - currentRightEdge; // This will be a negative number
    }
    
    // Bulletproofing: Don't let the nudge push it off the left side of the PDF page
    if (overlayLeft + shiftX < 0) {
        shiftX = -overlayLeft; 
    }

    controls.style.marginLeft = `${shiftX}px`;
    controls.style.transformOrigin = `${flippedY ? "top" : "bottom"} left`;
    
    if (wasHidden) {
        controls.style.display = "";
        controls.style.visibility = "";
    }
    
    setTimeout(() => { controls.style.transition = oldTransition; }, 0);
};

window.sanitizeHTML = function(dirtyHTML) {
    if (!dirtyHTML) return "";
    
    // Create an inert, sandboxed DOM to parse the string safely
    const parser = new DOMParser();
    const doc = parser.parseFromString(dirtyHTML, 'text/html');
    
    // The strict whitelist of what is allowed to survive
    const allowedTags = ['B', 'I', 'U', 'STRONG', 'EM', 'BR', 'SPAN', 'DIV','FONT']; 
    
    function cleanNode(node) {
        // 1. Text nodes are always safe
        if (node.nodeType === Node.TEXT_NODE) return;
        
        // 2. Destroy anything that isn't a standard element (comments, etc.)
        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            return;
        }
        
        // 3. Destroy unapproved tags completely (scripts, iframes, imgs, objects)
        if (!allowedTags.includes(node.tagName)) {
			console.log("3_Removed: "+node.tagName);
            node.remove();
            return;
        }
        
        // 4. Scrub ALL attributes EXCEPT 'style'
        const attributes = Array.from(node.attributes);
        attributes.forEach(attr => {
            if (attr.name !== 'style' && attr.name !== 'color') {
				console.log("4_Removed_attr: "+attr.name);
                node.removeAttribute(attr.name);
            } else {
                // Mild style sanitization: block external network calls via CSS
                if (attr.value.toLowerCase().includes('url(')) {
					console.log("4b_Removed_attr: "+attr.name);
                    node.removeAttribute(attr.name);
                }
            }
        });
        
        // 5. Recurse down the tree
        const children = Array.from(node.childNodes);
        children.forEach(cleanNode);
    }
    
    // Run the cleaner over the sandboxed body
    Array.from(doc.body.childNodes).forEach(cleanNode);
    
    // Return the cleaned string
    return doc.body.innerHTML;
};

window.computeHash = async function(str) {
    const msgBuffer = new TextEncoder().encode(str+"GA-SAVE-HASH-CHECK-S4lT!!");
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};
window.compressData = async function(str) {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
};

window.decompressData = async function(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
};
