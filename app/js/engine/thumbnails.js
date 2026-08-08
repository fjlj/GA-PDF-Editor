// ==========================================
// thumbnails.js: MINIMAP & SIDEBAR SYNC
// ==========================================

const previewPopover = document.createElement("div");
previewPopover.className = "thumb-preview-popover";
document.body.appendChild(previewPopover);

// === Thumbnail lazy-load ===
// This observer watches for thumbnails entering the viewport (plus a 100% buffer above/below)
const thumbObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const thumbCanvas = entry.target;
            
            // Find the physical page wrapper based on the index we attached
            const index = thumbCanvas.dataset.index;
            const wrapper = APP.DOM.viewer.querySelectorAll(".pageWrapper")[index];
            
            if (wrapper) {
                const origCanvas = wrapper.querySelector(".pageCanvas");
                if (origCanvas) {
                    // Draw the image
                    const ctx = thumbCanvas.getContext("2d", { alpha: false });
                    ctx.drawImage(origCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
                    
                    // Stop observing this thumbnail since it's already drawn
                    observer.unobserve(thumbCanvas);
                }
            }
        }
    });
}, {
    root: document.getElementById("pagesTab"), // The scrolling sidebar container
    rootMargin: "100% 0px 100% 0px"            // The "2x Buffer Zone"
});

window.syncPageThumbnails = function() {
    const thumbList = document.getElementById("pageThumbList");
    // reset thumbnail observer
    thumbObserver.disconnect(); 
    thumbList.innerHTML = "";
    const wrappers = Array.from(APP.DOM.viewer.querySelectorAll(".pageWrapper"));
    
    wrappers.forEach((wrapper, index) => {
        const thumbItem = document.createElement("div");
        thumbItem.className = "thumb-item";
        thumbItem.draggable = true;
        thumbItem.dataset.index = index;
        
        const origCanvas = wrapper.querySelector(".pageCanvas");
        if (origCanvas) {
            // placeholder canvas until painted
            const thumbCanvas = document.createElement("canvas");
            thumbCanvas.width = 100;
            thumbCanvas.height = (origCanvas.height / origCanvas.width) * 100;
            thumbCanvas.dataset.index = index; 
            
            // Add a subtle background color so the user knows it's a page before it loads
            thumbCanvas.style.backgroundColor = "#e0e0e0"; 
            
            thumbItem.appendChild(thumbCanvas);
            
            // observe for lazy paint
            thumbObserver.observe(thumbCanvas);
        }
        
        // === Page naming ===
        let displayName = wrapper.dataset.pageName;
        let hoverTitle = wrapper.dataset.hoverTitle;

        // default page name once
        if (!displayName) {
            const textSpans = wrapper.querySelectorAll('.textLayer span');
            let extractedText = "";
            for (let i = 0; i < Math.min(textSpans.length, 15); i++) {
                extractedText += textSpans[i].textContent.trim() + " ";
            }
            extractedText = extractedText.trim();

            if (extractedText) {
                const words = extractedText.split(' ');
                displayName = words.slice(0, 3).join(' ') + (words.length > 3 ? "..." : "");
                hoverTitle = words.slice(0, 15).join(' ') + (words.length > 15 ? "..." : "");
            } else {
                displayName = `Page ${index + 1}`;
                hoverTitle = `Original ${displayName}`;
            }

            // Save to the physical DOM wrapper so it travels during Drag & Drop!
            wrapper.dataset.pageName = displayName;
            wrapper.dataset.hoverTitle = hoverTitle;
        }

        const label = document.createElement("div");
        label.className = "thumb-label";
        label.innerText = wrapper.dataset.pageName;
        label.title = wrapper.dataset.hoverTitle;

        // double-click rename
        label.addEventListener("dblclick", (e) => {
            e.stopPropagation(); 
            thumbItem.draggable = false; 
            
            // show full title while editing
            label.innerText = wrapper.dataset.hoverTitle; 
            
            label.contentEditable = "true";
            label.focus();

            const range = document.createRange();
            range.selectNodeContents(label);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });

        // Save the name when they click away
        label.addEventListener("blur", () => {
            label.contentEditable = "false";
            thumbItem.draggable = true; 
            
            // Grab the full string they just typed
            const fullNewName = label.innerText.trim() || `Page ${index + 1}`;
            
            if (fullNewName !== wrapper.dataset.hoverTitle) {
                const oldName = wrapper.dataset.pageName;
                const oldHover = wrapper.dataset.hoverTitle;
                
                // truncate for the sidebar label
                const words = fullNewName.split(' ');
                const truncatedName = words.slice(0, 3).join(' ') + (words.length > 3 ? "..." : "");
                
                // Update the hidden dataset
                wrapper.dataset.pageName = truncatedName;
                wrapper.dataset.hoverTitle = fullNewName; 
                
                // Update the visible UI
                label.innerText = truncatedName;
                label.title = fullNewName;
                
                if (window.GaProcessor) {
                    window.GaProcessor.commit(window.GaProcessor.build.dataset(
                        wrapper,
                        { pageName: oldName, hoverTitle: oldHover },
                        { pageName: truncatedName, hoverTitle: fullNewName },
                        "Rename Page",
                        "patch"
                    ));
                }
            } else {
                // blur without edit — restore truncated label 
                // just collapse the text back down to the existing truncated version!
                label.innerText = wrapper.dataset.pageName;
            }
        });

        // Save the name if they press Enter
        label.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                label.blur(); 
            }
        });
        
        // Shield mousedowns from accidentally triggering the thumbnail drag logic
        label.addEventListener("mousedown", e => {
            if (label.contentEditable === "true") e.stopPropagation(); 
        });

        thumbItem.appendChild(label);

        const delBtn = document.createElement("button");
        delBtn.innerHTML = "&times;";
        delBtn.className = "thumb-delete";
        delBtn.title = "Delete Page";
        delBtn.onclick = async (e) => {
            if (window.GaProcessor) {
                const inst = window.GaProcessor.build.deleteNode(wrapper, `Delete Page ${index + 1}`);
                wrapper.remove();
                window.syncPageThumbnails();
                window.GaProcessor.commit(inst);
            } else {
                wrapper.remove();
                window.syncPageThumbnails();
            }
        };
        thumbItem.appendChild(delBtn);

        thumbItem.addEventListener("click", (e) => {
            if (e.target.classList.contains("thumb-delete") || e.target.classList.contains("thumb-label")) return;
            const targetPage = APP.DOM.viewer.querySelectorAll(".pageWrapper")[index];
            if (targetPage) {
                APP.DOM.viewer.scrollTo({ top: targetPage.offsetTop - 20, behavior: "smooth" });
            }
        });

        let hoverTimer;
        thumbItem.addEventListener("mouseenter", (e) => {
            hoverTimer = setTimeout(() => {
                if (origCanvas) {
                    previewPopover.innerHTML = ""; 
                    const previewWidth = 350; 
                    const previewHeight = (origCanvas.height / origCanvas.width) * previewWidth;
                    
                    const previewCanvas = document.createElement("canvas");
                    previewCanvas.width = previewWidth;
                    previewCanvas.height = previewHeight;
                    const ctx = previewCanvas.getContext("2d");
                    ctx.drawImage(origCanvas, 0, 0, previewWidth, previewHeight);
                    
                    previewPopover.appendChild(previewCanvas);
                    previewPopover.style.display = "block";
                    
                    const rect = thumbItem.getBoundingClientRect();
                    let topPos = rect.top - 20;
                    const maxTop = window.innerHeight - previewHeight - 40; 
                    
                    if (topPos > maxTop) topPos = Math.max(10, maxTop); 
                    else topPos = Math.max(10, topPos);
                    
                    previewPopover.style.top = topPos + "px";
                    previewPopover.style.left = (rect.left - previewWidth - 30) + "px"; 
                    setTimeout(() => previewPopover.style.opacity = "1", 10);
                }
            }, 500); 
        });

        const hidePreview = () => {
            clearTimeout(hoverTimer);
            previewPopover.style.opacity = "0";
            setTimeout(() => {
                if (previewPopover.style.opacity === "0") previewPopover.style.display = "none";
            }, 200);
        };

        thumbItem.addEventListener("mouseleave", hidePreview);
        thumbItem.addEventListener("mousedown", hidePreview); 
        
        // === Drag & drop ===
        thumbItem.addEventListener("dragstart", e => {
			e.stopPropagation();
            e.dataTransfer.setData("text/plain", index);
            e.dataTransfer.effectAllowed = "move";
            setTimeout(() => thumbItem.style.opacity = "0.5", 0);
            hidePreview(); 
        });
        thumbItem.addEventListener("dragend", () => {
            thumbItem.style.opacity = "1";
            document.querySelectorAll(".thumb-item").forEach(t => t.classList.remove("drag-over"));
        });
        thumbItem.addEventListener("dragover", e => { e.preventDefault(); thumbItem.classList.add("drag-over"); });
        thumbItem.addEventListener("dragleave", () => { thumbItem.classList.remove("drag-over"); });
        thumbItem.addEventListener("drop", e => {
            e.preventDefault();
			e.stopPropagation();
            const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
            const toIndex = index;
            if (fromIndex === toIndex || isNaN(fromIndex)) return;
            const allWrappers = Array.from(APP.DOM.viewer.querySelectorAll(".pageWrapper"));
            const movedWrapper = allWrappers[fromIndex];
            const refWrapper = allWrappers[toIndex];
            const originalNextSibling = movedWrapper.nextElementSibling;
            
            if (fromIndex < toIndex) refWrapper.after(movedWrapper);
            else refWrapper.before(movedWrapper);
            
            window.syncPageThumbnails();
            if (window.GaProcessor) {
                const parent = APP.DOM.viewer;
                window.GaProcessor.ensureId(parent, "viewer");
                window.GaProcessor.ensureId(movedWrapper, "page");
                const beforeNext = originalNextSibling
                    ? window.GaProcessor.ensureId(originalNextSibling, "page")
                    : null;
                const afterNext = movedWrapper.nextElementSibling
                    ? window.GaProcessor.ensureId(movedWrapper.nextElementSibling, "page")
                    : null;
                // REORDER after the fact — capture before as original next, after as current next
                // We already moved DOM; record applied reorder with swapped semantics for undo.
                const beforeNextId = beforeNext;
                let afterNextId = null;
                if (fromIndex < toIndex) {
                    afterNextId = refWrapper.nextElementSibling && refWrapper.nextElementSibling !== movedWrapper
                        ? window.GaProcessor.ensureId(refWrapper.nextElementSibling, "page")
                        : null;
                    // moved after refWrapper → next sibling of moved is refWrapper.next
                    afterNextId = movedWrapper.nextElementSibling
                        ? window.GaProcessor.ensureId(movedWrapper.nextElementSibling, "page")
                        : null;
                } else {
                    afterNextId = movedWrapper.nextElementSibling
                        ? window.GaProcessor.ensureId(movedWrapper.nextElementSibling, "page")
                        : null;
                }
                window.GaProcessor.commit({
                    opcode: "REORDER_CHILD",
                    targetId: movedWrapper.id,
                    payload: {
                        parentId: parent.id,
                        beforeNextSiblingId: beforeNextId,
                        afterNextSiblingId: afterNextId
                    },
                    name: `Move Page ${fromIndex + 1} to ${toIndex + 1}`,
                    applied: true
                });
            }
        });
        
        thumbList.appendChild(thumbItem);
    });
};

// Wiring Up Insertion Button
const insertPdfInput = document.getElementById("insertPdfInput");
document.getElementById("insertPdfBtn").addEventListener("click", () => insertPdfInput.click());

insertPdfInput.addEventListener("change", e => {
    // By passing 'true', it bypasses the "Open/Append" modal and goes straight to the Location modal!
    window.processPdfFiles(e.target.files, true);
    insertPdfInput.value = ""; 
}); 

// ==========================================
// SIDEBAR OVERDRIVE SCROLL ENGINE
// ==========================================

const pagesTab = document.getElementById("pagesTab");

pagesTab.addEventListener("dragover", e => {
    const rect = pagesTab.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    
    const SCROLL_ACTIVATION_ZONE = 60; // Pixels from top/bottom to trigger scroll
    const SCROLL_SPEED = 15;           // Pixels to jump per frame

    if (mouseY < SCROLL_ACTIVATION_ZONE) {
        // Scrolling UP
        pagesTab.scrollTop -= SCROLL_SPEED;
    } else if (mouseY > rect.height - SCROLL_ACTIVATION_ZONE) {
        // Scrolling DOWN
        pagesTab.scrollTop += SCROLL_SPEED;
    }
});