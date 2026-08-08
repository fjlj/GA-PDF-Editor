// ==========================================
// keyboard.js: MASTER KEYDOWN ENGINE
// ==========================================


window.disableXRayMode = function() {
    if (APP.isXRayMode) {
        APP.isXRayMode = false;
        document.body.classList.remove("xray-mode"); 
    }
};

window.addEventListener("keydown", e => {
    const activeEl = document.activeElement;
    const isTyping = activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable;
    const key = e.key.toLowerCase();

    // ESCAPE KEY: Only handles modal closing and state clearing
    if (e.key === "Escape") {
        let closedAModal = false;
        for (const m of APP.DOM.modals) {
            if (m.style.display === "flex") {
                m.style.display = "none";
                closedAModal = true;
            }
        }
        if (closedAModal) {
            window.pendingEditTarget = null;
            if (window.disableXRayMode) window.disableXRayMode();
            return; 
        }
        
        // === General cleanup if no modal was open ===
        
        // Clear our new modular selections
        if (window.clearMultiSelection) window.clearMultiSelection();
        if (window.clearActiveOverlay) window.clearActiveOverlay(); 
        
        // Your existing cleanup
        window.hideGuides(); 
        if (window.disableXRayMode) window.disableXRayMode();
        
        if (APP.DOM.toolModeSelect) { 
            APP.DOM.toolModeSelect.value = "select"; 
            if (window.updateToolModeSelectStyle) window.updateToolModeSelectStyle("select"); 
        }
        APP.currentMode = "select"; 
        if (APP.DOM.viewer) APP.DOM.viewer.style.cursor = "default";
        
        // Defocus text
        if (typeof isTyping !== 'undefined' && isTyping && activeEl) {
            activeEl.blur();
        } else if (document.activeElement && document.activeElement.isContentEditable) {
            document.activeElement.blur();
        }
        
        return;
    }

    // ZOOM CONTROLS: Now outside the escape dungeon!
    if (!isTyping) {
        if (key === "=" || key === "+") { 
            e.preventDefault(); window.setZoom(window.currentZoom + APP.ZOOM_STEP); return; 
        }
        if (key === "-" || key === "_") { 
            e.preventDefault(); window.setZoom(window.currentZoom - APP.ZOOM_STEP); return; 
        }
    }

    // TOOL Modes
    if (!isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
        let newMode = null;
        if (key === "v") newMode = "select";

        // F → Form workspace on Pointer
        if (key === "f") {
            e.preventDefault();
            window.setWorkspaceMode("form", { preferredTool: "select" });
            window.clearActiveOverlay();
            window.hideGuides();
            return;
        }
        // E: Form → Editor + Pointer; already in Editor → Edit/Stamp tool
        if (key === "e") {
            e.preventDefault();
            window.clearActiveOverlay();
            window.hideGuides();
            if (APP.workspaceMode === "form") {
                window.setWorkspaceMode("editor", { preferredTool: "select" });
            } else {
                APP.currentMode = "edit";
                if (APP.DOM.toolModeSelect) {
                    APP.DOM.toolModeSelect.value = "edit";
                    if (window.updateToolModeSelectStyle) window.updateToolModeSelectStyle("edit");
                }
                if (APP.DOM.viewer) APP.DOM.viewer.style.cursor = "crosshair";
            }
            return;
        }
        // M toggles workspace
        if (key === "m") {
            e.preventDefault();
            window.toggleWorkspaceMode();
            return;
        }

        if (APP.workspaceMode === "form") {
            if (key === "t") newMode = "form_text";
            if (key === "c") newMode = "form_checkbox";
            if (key === "r") newMode = "form_radio";
            if (key === "d") newMode = "form_dropdown";
            if (key === "g") newMode = "form_signature";
        } else {
            if (key === "t") newMode = "text";
            if (key === "r") newMode = "rect";
            if (key === "o") newMode = "circle";
            if (key === "l") newMode = "line";
            if (key === "s") newMode = "snip";
            if (key === "g") newMode = "table";
            if (key === "i") { e.preventDefault(); document.getElementById("imageInput").click(); return; }
        }

        if (newMode && APP.currentMode !== newMode) {
            e.preventDefault(); 
            if (newMode !== "select") { window.clearActiveOverlay(); window.hideGuides(); }
            APP.currentMode = newMode;
            if (APP.DOM.toolModeSelect) { 
                APP.DOM.toolModeSelect.value = newMode; 
                if (window.updateToolModeSelectStyle) window.updateToolModeSelectStyle(newMode); 
            }
            if (APP.DOM.viewer) APP.DOM.viewer.style.cursor = (newMode === "select" ? "default" : "crosshair"); 
            return;
        }
    }
    
    // UNDO / REDO
    if (!isTyping) {
        if ((e.ctrlKey || e.metaKey) && key === "z") { 
            e.preventDefault(); 
            if (e.shiftKey) window.historyEngine.redo(); else window.historyEngine.undo(); 
            return; 
        }
        if ((e.ctrlKey || e.metaKey) && key === "y") { 
            e.preventDefault(); window.historyEngine.redo(); return; 
        }
    }
	
	// X-ray mode (before guards that early-return)
    if (e.key === "x" && !isTyping && !e.ctrlKey && !e.metaKey && !e.altKey) {
        APP.isXRayMode = !APP.isXRayMode; 
        if (APP.isXRayMode) document.body.classList.add("xray-mode"); 
        else document.body.classList.remove("xray-mode"); 
        return; // Stop here so it doesn't execute lower logic
    }
    if ((e.ctrlKey || e.metaKey) && key === 's') {
        e.preventDefault(); // Stop the browser's default "Save Webpage" dialog
        window.exportProject();
    }
    // Object Manipulation
    if (isTyping || (!APP.activeOverlay && APP.multiSelectedItems.size === 0)) return;
    
    if (e.key === "Delete" || e.key === "Backspace") {
        if (APP.multiSelectedItems.size > 0) {
            const itemsToDelete = Array.from(APP.multiSelectedItems);
            window.clearMultiSelection();
            window.hideGuides();
            if (window.GaProcessor) {
                const steps = itemsToDelete.map((el) => window.GaProcessor.build.deleteNode(el, "Delete"));
                // Form cleanup BEFORE remove (native AcroForm twins must go for export)
                itemsToDelete.forEach((el) => {
                    if (el.classList && el.classList.contains("formFieldOverlay")
                        && typeof window.onFormFieldRemoved === "function") {
                        window.onFormFieldRemoved(el);
                    }
                    el.remove();
                });
                window.GaProcessor.commit(
                    window.GaProcessor.build.compound(steps, `Delete ${itemsToDelete.length} Items`)
                );
            } else {
                itemsToDelete.forEach((el) => {
                    if (el.classList && el.classList.contains("formFieldOverlay")
                        && typeof window.onFormFieldRemoved === "function") {
                        window.onFormFieldRemoved(el);
                    }
                    el.remove();
                });
            }
            return;
        }
        const target = APP.activeOverlay;
        if (!target) return;
        const isForm = target.classList.contains("formFieldOverlay");
        if (APP.workspaceMode === "form" && !isForm) return;
        if (APP.workspaceMode !== "form" && isForm) return;
        window.clearActiveOverlay();
        window.hideGuides();
        if (window.GaProcessor) {
            const inst = window.GaProcessor.build.deleteNode(target, "Delete Overlay");
            if (isForm && typeof window.onFormFieldRemoved === "function") {
                window.onFormFieldRemoved(target);
            }
            target.remove();
            window.GaProcessor.commit(inst);
        } else {
            if (isForm && typeof window.onFormFieldRemoved === "function") {
                window.onFormFieldRemoved(target);
            }
            target.remove();
        }
        return;
    }

    if (e.key === "]" || e.key === "[") {
        e.preventDefault(); 
        
        // Establish context
        const referenceEl = APP.multiSelectedItems.size > 0 ? Array.from(APP.multiSelectedItems)[0] : APP.activeOverlay;
        if (!referenceEl) return;
        
        const container = referenceEl.closest(".pageContainer");
        if (!container) return;

        // Find the highest Z-index of ALL UNSELECTED items on this specific page
        let highestOtherZ = 9; // Base below default 10
        container.querySelectorAll('.overlayImg, .textOverlay, .shapeOverlay, .formFieldOverlay').forEach(el => {
            const isForm = el.classList.contains("formFieldOverlay");
            if (APP.workspaceMode === "form" && !isForm) return;
            if (APP.workspaceMode !== "form" && isForm) return;
            if (!APP.multiSelectedItems.has(el) && el !== APP.activeOverlay) {
                const z = parseInt(el.style.zIndex) || 10;
                if (z > highestOtherZ) highestOtherZ = z;
            }
        });

        // Group Z-Index Support
        if (APP.multiSelectedItems.size > 0) {
            const items = Array.from(APP.multiSelectedItems);
            const beforeZ = items.map(el => el.style.zIndex || "10");
            let actuallyChanged = false;

            items.forEach((el, i) => {
                let currentZ = parseInt(beforeZ[i]);
                let newZ = currentZ;

                if (e.key === "]") {
                    // Only increment if we haven't cleared the highest background object yet
                    if (currentZ <= highestOtherZ) newZ = currentZ + 1;
                } else if (e.key === "[") {
                    // Never go below Z-index 1
                    newZ = Math.max(1, currentZ - 1);
                }

                if (newZ !== currentZ) actuallyChanged = true;
                el.style.zIndex = newZ;
            });

            // History only if z-order really changed
            if (actuallyChanged) {
                const afterZ = items.map(el => el.style.zIndex);
                if (window.GaProcessor) {
                    window.GaProcessor.commit(window.GaProcessor.build.zIndexGroup(
                        items.map((el, i) => ({ el, before: beforeZ[i], after: afterZ[i] })),
                        "Change Group Layer Order"
                    ));
                }
            }
            return;
        }

        // Single Item Z-Index
        const target = APP.activeOverlay; 
        if (target) {
            const beforeZ = target.style.zIndex || "10"; 
            let currentZ = parseInt(beforeZ);
            let newZ = currentZ;

            if (e.key === "]") {
                if (currentZ <= highestOtherZ) newZ = currentZ + 1;
            } else if (e.key === "[") {
                newZ = Math.max(1, currentZ - 1);
            }

            // History only if something changed
            if (newZ !== currentZ) {
                target.style.zIndex = newZ;
                if (window.GaProcessor) {
                    window.GaProcessor.commit(
                        window.GaProcessor.build.zIndex(target, beforeZ, newZ, "Change Layer Order")
                    );
                }
            }
        }
    }
	// Arrow nudge (coalesce into one history entry per burst)
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if (APP.activeOverlay || APP.multiSelectedItems.size > 0) {
            e.preventDefault(); // Stop the whole page from scrolling!

            // Cancel any pending commit while keys are still being pressed
            if (window._nudgeCancelCommit) window._nudgeCancelCommit();

            // The Accelerator: Hold Shift to jump 10px instead of 1px
            const step = e.shiftKey ? 10 : 1;
            let dx = 0, dy = 0;

            if (e.key === "ArrowUp") dy = -step;
            if (e.key === "ArrowDown") dy = step;
            if (e.key === "ArrowLeft") dx = -step;
            if (e.key === "ArrowRight") dx = step;

            // SCENARIO A: Group Nudging
            if (APP.multiSelectedItems.size > 0) {
                const els = Array.from(APP.multiSelectedItems);
                if (window._nudgeNoteBefore) window._nudgeNoteBefore(els);

                els.forEach(el => {
                    const currentLeft = parseFloat(el.style.left) || 0;
                    const currentTop = parseFloat(el.style.top) || 0;
                    el.style.left = (currentLeft + dx) + "px";
                    el.style.top = (currentTop + dy) + "px";
                    if (el.classList.contains("formFieldOverlay")
                        && typeof window.syncNativeWidgetGeometryFromDesigner === "function") {
                        window.syncNativeWidgetGeometryFromDesigner(el);
                    }
                });

                // Keep the Stencil Box and tracking bounds perfectly synced
                if (window.activeStencil) {
                    const st = window.activeStencil;
                    st.style.left = ((parseFloat(st.style.left) || 0) + dx) + "px";
                    st.style.top = ((parseFloat(st.style.top) || 0) + dy) + "px";

                    if (window.activeMarqueeBounds) {
                        window.activeMarqueeBounds.left += dx;
                        window.activeMarqueeBounds.right += dx;
                        window.activeMarqueeBounds.centerX += dx;
                        window.activeMarqueeBounds.top += dy;
                        window.activeMarqueeBounds.bottom += dy;
                        window.activeMarqueeBounds.centerY += dy;
                    }
                }
                // Lock the floating alignment menu to the new position
                if (window.showGroupToolbar) window.showGroupToolbar();
            }
            // SCENARIO B: Single Object Nudging
            else if (APP.activeOverlay) {
                const el = APP.activeOverlay;
                if (window._nudgeNoteBefore) window._nudgeNoteBefore([el]);

                const currentLeft = parseFloat(el.style.left) || 0;
                const currentTop = parseFloat(el.style.top) || 0;
                el.style.left = (currentLeft + dx) + "px";
                el.style.top = (currentTop + dy) + "px";

                // Snap the popup text tools to the new coordinates
                window.adjustToolbarPosition(el);
                if (el.classList.contains("formFieldOverlay")
                    && typeof window.syncNativeWidgetGeometryFromDesigner === "function") {
                    window.syncNativeWidgetGeometryFromDesigner(el);
                }
            }
        }
    }
});

// ========================================
// Nudge history coalescing
// keydown → cancel pending timer + apply move + capture "before" once
// keyup   → start short timeout; if it fires (no more arrows), COMMIT_TRANSFORM
// ========================================
(function initNudgeHistoryCoalesce() {
    const COMMIT_MS = 320;
    /** @type {Map<string, { el: Element, before: object }>|null} */
    let session = null;
    let timer = null;
    const heldArrows = new Set();

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function noteBefore(els) {
        if (!window.GaProcessor || !els || !els.length) return;
        if (!session) {
            session = new Map();
            els.forEach((el) => {
                if (!el || el.nodeType !== 1) return;
                const id = window.GaProcessor.ensureId(el, "ov");
                if (!session.has(id)) {
                    session.set(id, {
                        el,
                        before: window.GaProcessor.snapshotTransform(el)
                    });
                }
            });
        }
    }

    function commitSession() {
        clearTimer();
        if (!session || !window.GaProcessor) {
            session = null;
            return;
        }
        const items = [];
        session.forEach(({ el, before }) => {
            if (!el || !el.isConnected) return;
            const after = window.GaProcessor.snapshotTransform(el);
            if (!after || !before) return;
            if (before.left === after.left && before.top === after.top
                && before.width === after.width && before.height === after.height
                && before.transform === after.transform
                && before.parentId === after.parentId) {
                return;
            }
            items.push({ el, before, after });
        });
        session = null;
        if (items.length === 0) return;
        if (items.length === 1) {
            window.GaProcessor.commit(
                window.GaProcessor.build.transform(
                    items[0].el,
                    items[0].before,
                    items[0].after,
                    "Nudge"
                )
            );
        } else {
            window.GaProcessor.commit(
                window.GaProcessor.build.transforms(items, `Nudge ${items.length} items`)
            );
        }
    }

    function scheduleCommit() {
        clearTimer();
        // Only arm when no arrow keys are still held
        if (heldArrows.size > 0) return;
        timer = setTimeout(commitSession, COMMIT_MS);
    }

    window._nudgeNoteBefore = noteBefore;
    window._nudgeCancelCommit = clearTimer;
    window._nudgeFlushCommit = commitSession;

    window.addEventListener("keyup", (e) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
        heldArrows.delete(e.key);
        if (session) scheduleCommit();
    });

    window.addEventListener("keydown", (e) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
        heldArrows.add(e.key);
        // Cancel pending commit while still nudging (repeat keydown / multi-arrow)
        clearTimer();
    }, true);

    // Selection change / blur: flush so the next gesture is a clean session
    window.addEventListener("mousedown", () => {
        if (session) commitSession();
    }, true);
})();