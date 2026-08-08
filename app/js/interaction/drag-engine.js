// ==========================================
// drag-engine.js: MOVE, RESIZE, & ROTATE MATH
// ==========================================


window.calculateSnapping = function(el, parent, newLeft, newTop) {
    const SNAP = 6 / window.currentZoom; 
    const parentRect = parent.getBoundingClientRect();
    let snappedX = false, snappedY = false;
    let res = { x: newLeft, y: newTop };

    parent.querySelectorAll('.overlayImg, .textOverlay, .shapeOverlay, .formFieldOverlay').forEach(sibling => {
        if (sibling === el) return; 
        const sibLeft = parseFloat(sibling.style.left) || 0; const sibTop = parseFloat(sibling.style.top) || 0;
        if (!snappedX && Math.abs(res.x - sibLeft) < SNAP) { res.x = sibLeft; window.showVerticalGuide(parentRect.left + (sibLeft * window.currentZoom)); snappedX = true; }
        if (!snappedY && Math.abs(res.y - sibTop) < SNAP) { res.y = sibTop; window.showHorizontalGuide(parentRect.top + (sibTop * window.currentZoom)); snappedY = true; }
    });

    if (!snappedX || !snappedY) {
        const elCenterX = res.x + (el.offsetWidth / 2); const elCenterY = res.y + (el.offsetHeight / 2);
        const parentCenterX = parent.offsetWidth / 2; const parentCenterY = parent.offsetHeight / 2;
        if (!snappedX && Math.abs(elCenterX - parentCenterX) < SNAP) { res.x = parentCenterX - (el.offsetWidth / 2); window.showVerticalGuide(parentRect.left + (parentCenterX * window.currentZoom)); }
        if (!snappedY && Math.abs(elCenterY - parentCenterY) < SNAP) { res.y = parentCenterY - (el.offsetHeight / 2); window.showHorizontalGuide(parentRect.top + (parentCenterY * window.currentZoom)); }
    }
    return res;
};

// === Drag engine ===
window.makeDraggable = function(el, resizeHandle = null, dragHandle = null) {
    el.addEventListener("mousedown", e => {
        if (APP.isXRayMode) return;
        if (APP.pendingSignatureSrc || APP.pendingImageSrc) return;
        
        const isFormEl = el.classList.contains("formFieldOverlay");
        const isStencil = el.classList.contains("stencil-box");
        // Workspace isolation: never drag the inactive layer.
        // Stencil/group boxes are allowed in both modes (they only wrap the active layer's selection).
        if (!isStencil) {
            if (APP.workspaceMode === "form" && !isFormEl) return;
            if (APP.workspaceMode !== "form" && isFormEl) return;
        }

        const isClickingHandle = e.target === resizeHandle || e.target === dragHandle;
        const isSmartText = APP.currentMode === "text" && el.classList.contains("textOverlay");
        const isSmartShape = (APP.currentMode === "rect" || APP.currentMode === "circle" || APP.currentMode === "line" || APP.currentMode === "table") && el.classList.contains("shapeOverlay");
        const isSmartForm = window.isFormFieldMode && window.isFormFieldMode(APP.currentMode) && isFormEl;
        
        if (!isClickingHandle && APP.currentMode !== "select" && APP.currentMode !== "edit" && !isSmartText && !isSmartShape && !isSmartForm) return;

        const isGroupDrag = APP.multiSelectedItems.has(el) || el.classList.contains("stencil-box");
        
        if (!isGroupDrag && APP.multiSelectedItems.size > 0) {
            window.clearMultiSelection();
        }
        
        if (!isGroupDrag) window.setActiveOverlay(el);
        
        if (e.target.closest(".textContent")) return;
        if (isClickingHandle) {
            if (document.activeElement && document.activeElement.isContentEditable) {
                document.activeElement.blur();
            }
        }

        let dragging = false;
        let resizing = false;
		let rotating = false;
        let targetEl = el;
        let lockedAxis = null;
        
        // Remember start parent for undo
        let initialParent = targetEl.parentElement; 
		
		let startCenterX = 0, startCenterY = 0, startAngle = 0, startRotation = 0;
        
        let groupInitialState = [];
		let stencilInitialState = null;
        if (isGroupDrag) {
            if (window.hideGroupToolbar) window.hideGroupToolbar(); 
            groupInitialState = Array.from(APP.multiSelectedItems).map(item => ({
                el: item,
                startParent: item.parentElement, // group member start parent
                startLeft: parseFloat(item.style.left) || 0,
                startTop: parseFloat(item.style.top) || 0
            }));

            if (window.activeStencil) {
                stencilInitialState = {
                    el: window.activeStencil,
                    startParent: window.activeStencil.parentElement, 
                    startLeft: parseFloat(window.activeStencil.style.left) || 0,
                    startTop: parseFloat(window.activeStencil.style.top) || 0
                };
            }
        }

        if (e.altKey) {
            const clone = el.cloneNode(true);
            const oldDelete = clone.querySelector(".deleteHandle");
            if (oldDelete) oldDelete.replaceWith(window.createDeleteHandle(clone));
            
            const oldDrag = clone.querySelector(".textDragHandle");
            const newDrag = document.createElement("div");
            newDrag.className = "textDragHandle";
            newDrag.innerHTML = "⠿";
            
            if (oldDrag) {
                const textContent = clone.querySelector(".textContent");
                if (textContent) newDrag.addEventListener("mousedown", () => textContent.blur());
                oldDrag.replaceWith(newDrag);
            }
            
            const oldControls = clone.querySelector(".textControls");
            if (oldControls && clone.classList.contains("textOverlay")) {
                const textContent = clone.querySelector(".textContent");
                const newControls = document.createElement("div");
                newControls.className = "textControls";
                newControls.addEventListener("mousedown", ev => ev.stopPropagation());
                const toolbarObj = window.createRichTextToolbar(textContent, clone);
                toolbarObj.sync(clone.style.fontFamily, parseFloat(clone.style.fontSize) || 14, clone.style.color, clone.style.fontWeight || "400", clone.style.lineHeight || "1.2");
                newControls.appendChild(toolbarObj.element);
                oldControls.replaceWith(newControls);
            }
            
            if (oldControls && clone.classList.contains("shapeOverlay")) {
                const type = clone.classList.contains("shape-rect") ? "rect"
                    : clone.classList.contains("shape-circle") ? "circle"
                    : clone.classList.contains("shape-line") ? "line"
                    : "table";
                oldControls.remove();
                clone.querySelectorAll(".textDragHandle, .deleteHandle,.rotateHandle").forEach(h => h.remove());
                
                if (type === "table") window.buildTableControls(clone);
                else window.buildShapeControls(clone, type);
            }
            
            el.parentElement.appendChild(clone);
            window.makeDraggable(clone, clone.querySelector(".resizeHandle"), clone.querySelector(".textDragHandle"));
            window.setActiveOverlay(clone);
            const targetContainer = el.parentElement;
            if (window.GaProcessor) {
                window.GaProcessor.commit(window.GaProcessor.build.createNode(clone, "Clone Item"));
            }
            targetEl = clone;
            initialParent = targetContainer; // Reset for clone
        }
		if (e.target.classList.contains("rotateHandle")) {
            rotating = true;
            
            // Save the current rotation
            const currentTransform = targetEl.style.transform || "";
            const match = currentTransform.match(/rotate\(([\d.-]+)deg\)/);
            startRotation = match ? parseFloat(match[1]) : 0;
            
            // Temporarily un-rotate the element to get its pure physical boundaries
            targetEl.style.transform = "none";
            const rawRect = targetEl.getBoundingClientRect();
            
            // Read exactly where the CSS transform-origin is set for this specific shape
            const computedStyle = window.getComputedStyle(targetEl);
            let originX = rawRect.width / 2;
            let originY = rawRect.height / 2;
            
            if (computedStyle.transformOrigin) {
                const origins = computedStyle.transformOrigin.split(" ");
                const pxX = parseFloat(origins[0]);
                const pxY = parseFloat(origins[1]);
                
                // 0px is valid — do not treat as falsy
                // The || operator treats 0 as false, which broke lines that pivot on the left edge.
                if (!isNaN(pxX)) originX = pxX;
                if (!isNaN(pxY)) originY = pxY;
            }
            
            // Because transform-origin is the ONE point that NEVER moves during rotation,
            // we now have our absolute mathematical pivot point!
            startCenterX = rawRect.left + originX;
            startCenterY = rawRect.top + originY;
            
            // Put the rotation back instantly
            targetEl.style.transform = currentTransform;
            
            // Calculate the initial angle of the mouse relative to this perfect center
            startAngle = Math.atan2(e.clientY - startCenterY, e.clientX - startCenterX) * (180 / Math.PI);
        }
        else if (resizeHandle && e.target === resizeHandle && !e.altKey) {
            resizing = true;
        } 
        else if (!dragHandle || e.target === dragHandle || targetEl.contains(e.target)) {
            dragging = true;
        }

        let startGlobalX = e.clientX;
        let startGlobalY = e.clientY;
        
        let startScrollTop = APP.DOM.viewer.scrollTop || 0;
        let startScrollLeft = APP.DOM.viewer.scrollLeft || 0;
        
        let startLeft = parseFloat(targetEl.style.left) || 0;
        let startTop = parseFloat(targetEl.style.top) || 0;
        let startW = parseFloat(targetEl.style.width) || targetEl.offsetWidth;
        let startH = parseFloat(targetEl.style.height) || targetEl.offsetHeight;
        
        if (dragging || resizing || rotating) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        // We now also track transform for undo/redo
        let initialStyles = { left: targetEl.style.left, top: targetEl.style.top, width: targetEl.style.width, height: targetEl.style.height, transform: targetEl.style.transform };
        
        const onMouseMove = (moveEvent) => {
            if (!dragging && !resizing && !rotating) return;
            targetEl.classList.add("is-dragging");
            window.hideGuides();
            
            const scrollDx = (APP.DOM.viewer.scrollLeft || 0) - startScrollLeft;
            const scrollDy = (APP.DOM.viewer.scrollTop || 0) - startScrollTop;
            
            let dx = (moveEvent.clientX - startGlobalX + scrollDx) / window.currentZoom;
            let dy = (moveEvent.clientY - startGlobalY + scrollDy) / window.currentZoom;
            
            // rotate around transform-origin
            if (rotating) {
                // Calculate current mouse angle relative to center
                const currentMouseAngle = Math.atan2(moveEvent.clientY - startCenterY, moveEvent.clientX - startCenterX) * (180 / Math.PI);
                let finalAngle = startRotation + (currentMouseAngle - startAngle);
                
                // Bonus: Hold Shift while rotating to snap to 15-degree increments!
                if (moveEvent.shiftKey) {
                    finalAngle = Math.round(finalAngle / 15) * 15;
                }
                
                targetEl.style.transform = `rotate(${finalAngle}deg)`;
                if (window.syncOverlayChromeRotation) window.syncOverlayChromeRotation(targetEl);
            }
            
            if (dragging) {
                // Reparent when dragged onto another page
                let hoveredPage = null;
                const pages = document.querySelectorAll(".pageContainer");
                pages.forEach(page => {
                    const rect = page.getBoundingClientRect();
                    if (moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right &&
                        moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom) {
                        hoveredPage = page;
                    }
                });

                if (hoveredPage) {
                    const itemsToCheck = isGroupDrag ? groupInitialState.map(g => g.el) : [targetEl];
                    itemsToCheck.forEach(el => {
                        const currentParent = el.parentElement;
                        if (currentParent && currentParent !== hoveredPage && currentParent.classList.contains("pageContainer")) {
                            
                            // Calculate DOM physical offset so we can adjust math transparently
                            const oldRect = currentParent.getBoundingClientRect();
                            const newRect = hoveredPage.getBoundingClientRect();
                            
                            const shiftX = (oldRect.left - newRect.left) / window.currentZoom;
                            const shiftY = (oldRect.top - newRect.top) / window.currentZoom;

                            // Adjust the mathematical starting origin so the item doesn't jump
                            if (isGroupDrag) {
                                const stateObj = groupInitialState.find(g => g.el === el);
                                if (stateObj) {
                                    stateObj.startLeft += shiftX;
                                    stateObj.startTop += shiftY;
                                } else if (stencilInitialState && stencilInitialState.el === el) {
                                    // Keep stencil from jumping on reparent
                                    stencilInitialState.startLeft += shiftX;
                                    stencilInitialState.startTop += shiftY;
                                }
                            } else {
                                startLeft += shiftX;
                                startTop += shiftY;
                            }
                            
                            // Move the physical DOM node instantly
                            hoveredPage.appendChild(el);
                        }
                    });
                }

                if (isGroupDrag) {
                    // Clamp group to page top/left
                    // Find the bounding box of the group so we don't distort it when clamping
                    let minLeft = Infinity;
                    let minTop = Infinity;
                    groupInitialState.forEach(item => {
                        if (item.startLeft < minLeft) minLeft = item.startLeft;
                        if (item.startTop < minTop) minTop = item.startTop;
                    });
                    
                    // Clamp the master movement deltas if they try to push past 0!
                    if (minLeft + dx < 0) dx = -minLeft;
                    if (minTop + dy < 0) dy = -minTop;

                    groupInitialState.forEach(item => {
                        item.el.style.left = (item.startLeft + dx) + "px";
                        item.el.style.top = (item.startTop + dy) + "px";
                    });
					if (stencilInitialState) {
                        stencilInitialState.el.style.left = (stencilInitialState.startLeft + dx) + "px";
                        stencilInitialState.el.style.top = (stencilInitialState.startTop + dy) + "px";
                    }
                } else {
                    let newLeft = startLeft + dx;
                    let newTop = startTop + dy;
                    if (moveEvent.shiftKey) {
                        if (!lockedAxis && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                            lockedAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                        }
                        if (lockedAxis === 'x') newTop = startTop;
                        else if (lockedAxis === 'y') newLeft = startLeft;
                        else { newLeft = startLeft; newTop = startTop; }
                    } else {
                        lockedAxis = null;
                    }
                    const parent = targetEl.closest(".pageContainer");
                    if (!parent) return;
                    if (moveEvent.ctrlKey || moveEvent.metaKey) {
                        const snapped = window.calculateSnapping(targetEl, parent, newLeft, newTop);
                        newLeft = snapped.x;
                        newTop = snapped.y;
                    }
                    
		    // Clamp single item to page
                    // Hard lock the Top and Left edges at exactly 0
                    newLeft = Math.max(0, newLeft);
                    newTop = Math.max(0, newTop);
                    
                    // Shrink the bounding box to 10px so the handle can slide completely flush
                    // against the right and bottom edges of the canvas without falling off!
                    const maxLeft = parent.offsetWidth - 5;
                    const maxTop = parent.offsetHeight - 5;
                    newLeft = Math.min(newLeft, maxLeft);
                    newTop = Math.min(newTop, maxTop);

                    targetEl.style.left = newLeft + "px";
                    targetEl.style.top = newTop + "px";
		}

	    }
            if (resizing) {
                let newW = startW + dx;
                let newH = startH + dy;

                // Shift: lock aspect ratio
                if (moveEvent.shiftKey && startH !== 0) {
                    const ratio = startW / startH;
                    // Force the height to mathematically align with the width change
                    newH = newW / ratio; 
                }

                targetEl.style.minWidth = "0px";
                targetEl.style.minHeight = "0px";

                // Form fields (esp. radios/checks): allow very small widgets
                if (targetEl.classList.contains("formFieldOverlay")) {
                    const ft = targetEl.dataset.fieldType;
                    if (ft === "checkbox" || ft === "radio") {
                        const side = Math.max(1, Math.max(newW, newH));
                        targetEl.style.width = side + "px";
                        targetEl.style.height = side + "px";
                    } else {
                        targetEl.style.width = Math.max(1, newW) + "px";
                        targetEl.style.height = Math.max(1, newH) + "px";
                    }
                } else {
                    // Lines double as quick redact bars: free width + height (thickness)
                    const isLine = targetEl.classList.contains("shape-line");
                    const minW = isLine ? 4 : 20;
                    targetEl.style.width = Math.max(minW, newW) + "px";

                    if (targetEl.classList.contains("textOverlay")) {
                        const content = targetEl.querySelector(".textContent");
                        if (content) {
                            content.style.whiteSpace = "normal";
                            content.style.overflowWrap = "break-word";
                        }
                        targetEl.style.height = "auto"; // Text usually manages its own height
                    } else if (isLine) {
                        // Allow vertical thicken for redaction cover; keep at least 1px stroke
                        const h = Math.max(1, newH);
                        targetEl.style.height = h + "px";
                        // Keep thickness spinner in the shape toolbar in sync
                        const thickInput = targetEl.querySelector(".textControls input[type='number']");
                        if (thickInput) thickInput.value = String(Math.round(h));
                    } else {
                        targetEl.style.height = Math.max(5, newH) + "px";
                    }
                }
            }
            
            if (targetEl) window.adjustToolbarPosition(targetEl);
            
            const rect = APP.DOM.viewer.getBoundingClientRect();
            if (moveEvent.clientY < rect.top + APP.SCROLL_ZONE) window.startAutoScroll(-1);
            else if (moveEvent.clientY > rect.bottom - APP.SCROLL_ZONE) window.startAutoScroll(1);
            else window.stopAutoScroll();
        };
        
        const onMouseUp = () => {
            if (dragging && isGroupDrag) {
                const hasMoved = groupInitialState.some(item => 
                    parseFloat(item.el.style.left) !== item.startLeft || 
                    parseFloat(item.el.style.top) !== item.startTop ||
                    item.el.parentElement !== item.startParent
                );
                
                if (hasMoved) {
                    const before = groupInitialState.map(i => ({el: i.el, parent: i.startParent, left: i.startLeft + "px", top: i.startTop + "px"}));
                    const after = groupInitialState.map(i => ({el: i.el, parent: i.el.parentElement, left: i.el.style.left, top: i.el.style.top}));
                    
                    // Stencil bounds before/after for history
                    let beforeBounds = null;
                    let afterBounds = null;

                    if (stencilInitialState) {
                        const sWidth = parseFloat(stencilInitialState.el.style.width) || 0;
                        const sHeight = parseFloat(stencilInitialState.el.style.height) || 0;
                        
                        beforeBounds = {
                            left: stencilInitialState.startLeft, top: stencilInitialState.startTop,
                            width: sWidth, height: sHeight,
                            right: stencilInitialState.startLeft + sWidth, bottom: stencilInitialState.startTop + sHeight,
                            centerX: stencilInitialState.startLeft + (sWidth / 2), centerY: stencilInitialState.startTop + (sHeight / 2)
                        };

                        const currentLeft = parseFloat(stencilInitialState.el.style.left) || 0;
                        const currentTop = parseFloat(stencilInitialState.el.style.top) || 0;

                        afterBounds = {
                            left: currentLeft, top: currentTop,
                            width: sWidth, height: sHeight,
                            right: currentLeft + sWidth, bottom: currentTop + sHeight,
                            centerX: currentLeft + (sWidth / 2), centerY: currentTop + (sHeight / 2)
                        };
                    }

                    if (window.GaProcessor) {
                        const items = groupInitialState.map((item) => ({
                            el: item.el,
                            before: {
                                left: item.startLeft + "px",
                                top: item.startTop + "px",
                                width: item.el.style.width || "",
                                height: item.el.style.height || "",
                                transform: item.el.style.transform || "",
                                parentId: window.GaProcessor.ensureId(item.startParent, "pg")
                            },
                            after: window.GaProcessor.snapshotTransform(item.el)
                        }));
                        window.GaProcessor.commit(
                            window.GaProcessor.build.transforms(items, `Move ${after.length} Items`)
                        );
                    }

                    if (window.activeStencil) {
                        const s = window.activeStencil;
                        window.activeMarqueeBounds = {
                            left: parseFloat(s.style.left), 
                            top: parseFloat(s.style.top),
                            width: parseFloat(s.style.width),
                            height: parseFloat(s.style.height),
                            right: parseFloat(s.style.left) + parseFloat(s.style.width),
                            bottom: parseFloat(s.style.top) + parseFloat(s.style.height),
                            centerX: parseFloat(s.style.left) + (parseFloat(s.style.width) / 2),
                            centerY: parseFloat(s.style.top) + (parseFloat(s.style.height) / 2)
                        };
                    }
                
                    if (window.showGroupToolbar) window.showGroupToolbar();
                }
            }
            else if (dragging || resizing || rotating) {
                const endParent = targetEl.parentElement;
                
                // Record transform for undo
                if (targetEl.style.left !== initialStyles.left || targetEl.style.top !== initialStyles.top || targetEl.style.width !== initialStyles.width || targetEl.style.height !== initialStyles.height || targetEl.style.transform !== initialStyles.transform || initialParent !== endParent) {
                    
                    const before = { ...initialStyles };
                    const after = { left: targetEl.style.left, top: targetEl.style.top, width: targetEl.style.width, height: targetEl.style.height, transform: targetEl.style.transform };
                    
                    let actionName = "Move Overlay";
                    if (resizing) actionName = "Resize Overlay";
                    if (rotating) actionName = "Rotate Overlay";

                    if (window.GaProcessor) {
                        const beforeSnap = Object.assign({}, before, {
                            parentId: window.GaProcessor.ensureId(initialParent, "pg")
                        });
                        const afterSnap = Object.assign({}, after, {
                            parentId: window.GaProcessor.ensureId(endParent, "pg")
                        });
                        window.GaProcessor.commit(
                            window.GaProcessor.build.transform(targetEl, beforeSnap, afterSnap, actionName)
                        );
                    }
                }
            }
            targetEl.classList.remove("is-dragging");
            
            if (targetEl && window.adjustToolbarPosition) window.adjustToolbarPosition(targetEl);

            // Keep AcroForm twin geometry aligned when designer shells move/resize
            if (targetEl && targetEl.classList && targetEl.classList.contains("formFieldOverlay")
                && typeof window.syncNativeWidgetGeometryFromDesigner === "function") {
                window.syncNativeWidgetGeometryFromDesigner(targetEl);
            }
            if (isGroupDrag && groupInitialState.length) {
                groupInitialState.forEach((item) => {
                    if (item.el && item.el.classList && item.el.classList.contains("formFieldOverlay")
                        && typeof window.syncNativeWidgetGeometryFromDesigner === "function") {
                        window.syncNativeWidgetGeometryFromDesigner(item.el);
                    }
                });
            }
	    
	    window.stopAutoScroll();
            window.hideGuides();
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
        
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    });
};
