// ==========================================
// selection.js: MARQUEE ALIGNMENT & GROUPS
// ==========================================

// --- Snap / alignment guides ---
let groupToolbarEl = null;

window.rebuildGroupSelection = function(items,oGBounds) {
    if (!items || items.length === 0) return;

    // 1. Clear whatever is currently selected
    if (window.clearMultiSelection) window.clearMultiSelection();

    const targetContainer = items[0].closest(".pageContainer");
    if (!targetContainer) return;

    items.forEach(el => {
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        const width = parseFloat(el.style.width) || el.offsetWidth;
        const height = parseFloat(el.style.height) || el.offsetHeight;

        // Re-add to the JS brain
        el.classList.add("multi-selected");
        APP.multiSelectedItems.add(el);
    });

    // 3. Rebuild the bounding math
    window.activeMarqueeBounds = {
        left: oGBounds.left, top: oGBounds.top, width: oGBounds.width, height: oGBounds.height,
        right: oGBounds.right, bottom: oGBounds.bottom,
        centerX: oGBounds.centerX, centerY: oGBounds.centerY
    };
    window.activeSelectionContainer = targetContainer;

    // 4. Redraw the physical Stencil Box
    const stencil = document.createElement("div");
    stencil.className = "stencil-box";
    stencil.style.left = oGBounds.left + "px";
    stencil.style.top = oGBounds.top + "px";
    stencil.style.width = oGBounds.width + "px";
    stencil.style.height = oGBounds.height + "px";

    const dragHandle = document.createElement("div");
    dragHandle.className = "stencil-drag-handle";
    dragHandle.innerHTML = "⠿";
    stencil.appendChild(dragHandle);

    targetContainer.appendChild(stencil);
    window.activeStencil = stencil;

    // 5. Reattach the drag listeners and show the toolbar
    window.makeDraggable(window.activeStencil, null, dragHandle);
    if (APP.multiSelectedItems.size >= 1 && window.showGroupToolbar) {
        window.showGroupToolbar();
    }
};

window.showGroupToolbar = function() {
    if (!groupToolbarEl) {
        groupToolbarEl = document.createElement("div");
        groupToolbarEl.className = "group-toolbar";
        groupToolbarEl.innerHTML = `
            <button onclick="alignSelection('left')" title="Align to Box Left">⫷</button>
            <button onclick="alignSelection('centerX')" title="Center in Box (Horiz)">⇹</button>
            <button onclick="alignSelection('right')" title="Align to Box Right">⫸</button>
            <div class="divider"></div>
            <button onclick="alignSelection('top')" title="Align to Box Top">⫱</button>
            <button onclick="alignSelection('centerY')" title="Center in Box (Vert)">⇵</button>
            <button onclick="alignSelection('bottom')" title="Align to Box Bottom">⫰</button>
            <div class="divider"></div>
            <button onclick="alignSelection('distV')" title="Distribute through Box (Vert)">⇕</button>
            <button onclick="alignSelection('distH')" title="Distribute through Box (Horiz)">⇔</button>
        `;
        document.body.appendChild(groupToolbarEl);
        groupToolbarEl.addEventListener("mousedown", e => e.stopPropagation());
    }
    
    groupToolbarEl.style.display = "flex";

    if (window.activeSelectionContainer && window.activeMarqueeBounds) {
        const containerRect = window.activeSelectionContainer.getBoundingClientRect();
        const b = window.activeMarqueeBounds;
        
        const physicalTop = containerRect.top + (b.top * window.currentZoom);
        const physicalCenterX = containerRect.left + (b.centerX * window.currentZoom);
        
        const toolbarWidth = groupToolbarEl.offsetWidth || 280;
        const toolbarHeight = groupToolbarEl.offsetHeight || 40;

        let topPos = physicalTop - toolbarHeight - 15; 
        if (topPos < 10) topPos = containerRect.top + (b.bottom * window.currentZoom) + 15; 

        groupToolbarEl.style.top = topPos + "px";
        groupToolbarEl.style.left = (physicalCenterX - (toolbarWidth / 2)) + "px";
    }
};

window.hideGroupToolbar = function() {
    if (groupToolbarEl) groupToolbarEl.style.display = "none";
};

window.alignSelection = function(type) {
    let items = [];
    let bounds = null;

    // Scenario A: Multi-Selection (2+ items aligning to the Marquee Box)
    if (APP.multiSelectedItems && APP.multiSelectedItems.size >= 1 && window.activeMarqueeBounds) {
        items = Array.from(APP.multiSelectedItems).map(el => ({
            el, left: parseFloat(el.style.left) || 0, 
			top: parseFloat(el.style.top) || 0, 
			width: parseFloat(el.style.width) || el.offsetWidth, 
			height: parseFloat(el.style.height) || el.offsetHeight
        }));
        bounds = window.activeMarqueeBounds;
    } 

    if (items.length === 0 || !bounds) return;
	
    const beforeState = items.map(item => ({ el: item.el, left: item.el.style.left, top: item.el.style.top }));

    items.forEach(item => {
        if (type === 'left') item.el.style.left = bounds.left + "px";
        if (type === 'right') item.el.style.left = (bounds.right - item.width) + "px";
        if (type === 'centerX') item.el.style.left = (bounds.centerX - (item.width / 2)) + "px";
        if (type === 'top') item.el.style.top = bounds.top + "px";
        if (type === 'bottom') item.el.style.top = (bounds.bottom - item.height) + "px";
        if (type === 'centerY') item.el.style.top = (bounds.centerY - (item.height / 2)) + "px";
    });

    if (type === 'distV' && items.length >= 2) {
        items.sort((a, b) => a.top - b.top);
        if (window.lastAlignType === 'distV') { items.reverse(); window.lastAlignType = null; } else { window.lastAlignType = 'distV'; }
        
        if (items.length === 2) {
            items[0].el.style.top = bounds.top + "px";
            items[1].el.style.top = (bounds.bottom - items[1].height) + "px";
        } else {
            const gap = (bounds.height - items.reduce((sum, item) => sum + item.height, 0)) / (items.length - 1);
            let currentTop = bounds.top;
            items.forEach(item => { item.el.style.top = currentTop + "px"; currentTop += item.height + gap; });
        }
    }
    else if (type === 'distH' && items.length >= 2) {
        items.sort((a, b) => a.left - b.left);
        if (window.lastAlignType === 'distH') { items.reverse(); window.lastAlignType = null; } else { window.lastAlignType = 'distH'; }
        
        if (items.length === 2) {
            items[0].el.style.left = bounds.left + "px";
            items[1].el.style.left = (bounds.right - items[1].width) + "px";
        } else {
            const gap = (bounds.width - items.reduce((sum, item) => sum + item.width, 0)) / (items.length - 1);
            let currentLeft = bounds.left;
            items.forEach(item => { item.el.style.left = currentLeft + "px"; currentLeft += item.width + gap; });
        }
    } else {
        window.lastAlignType = null;
    }

    const afterState = items.map(item => ({ el: item.el, left: item.el.style.left, top: item.el.style.top }));

    if (window.GaProcessor) {
        const txItems = beforeState.map((st, i) => {
            const parentId = window.GaProcessor.ensureId(st.el.parentElement, "pg");
            return {
                el: st.el,
                before: {
                    left: st.left,
                    top: st.top,
                    width: st.el.style.width || "",
                    height: st.el.style.height || "",
                    transform: st.el.style.transform || "",
                    parentId
                },
                after: {
                    left: afterState[i].left,
                    top: afterState[i].top,
                    width: st.el.style.width || "",
                    height: st.el.style.height || "",
                    transform: st.el.style.transform || "",
                    parentId
                }
            };
        });
        window.GaProcessor.commit(
            window.GaProcessor.build.transforms(txItems, `Align: ${type.toUpperCase()}`)
        );
    }
};