// ==========================================
// zoom-scroll.js: CAMERA & MINIMAP SYNC
// ==========================================
// Multi-tab: wheel/scroll are delegated (scroll does not bubble — use capture).

let syncScrollTimeout;
let isZooming = false; // one zoom step per animation frame (trackpads)

function activeViewerEl() {
    if (typeof window.getActiveViewer === "function") return window.getActiveViewer();
    return (APP && APP.DOM && APP.DOM.viewer)
        || document.querySelector("#workspaceRoot .doc-viewer.is-active-doc")
        || document.getElementById("viewer");
}

// Zoom (wheel / trackpad)
window.applySmartZoom = function(targetZoom, mouseX = null, mouseY = null) {
    targetZoom = Math.max(APP.MIN_ZOOM, Math.min(targetZoom, APP.MAX_ZOOM));
    if (targetZoom === window.currentZoom) return;

    const viewer = activeViewerEl();
    if (!viewer) return;
    const rect = viewer.getBoundingClientRect();

    if (mouseX === null || mouseY === null) {
        mouseX = rect.left + (rect.width / 2);
        mouseY = rect.top + (rect.height / 2);
    }

    const offsetX = mouseX - rect.left;
    const offsetY = mouseY - rect.top;

    const docX = viewer.scrollLeft + offsetX;
    const docY = viewer.scrollTop + offsetY;

    const zoomRatio = targetZoom / window.currentZoom;

    // Run your existing visual zoom function
    window.setZoom(targetZoom);

    // Force layout reflow after zoom
    // We explicitly ask the browser for the new scrollHeight. 
    // This forces the browser to halt, physically recalculate the new DOM sizes, 
    // and acknowledge the new boundaries BEFORE we try to move the scrollbar!
    void viewer.scrollHeight;

    // Apply the perfect scroll position
    viewer.scrollLeft = (docX * zoomRatio) - offsetX;
    viewer.scrollTop = (docY * zoomRatio) - offsetY;
};


// === UI Buttons ===
document.getElementById("zoomInBtn").addEventListener("click", () => window.applySmartZoom(window.currentZoom + APP.ZOOM_STEP));
document.getElementById("zoomOutBtn").addEventListener("click", () => window.applySmartZoom(window.currentZoom - APP.ZOOM_STEP));


// Wheel on any active document pane (delegate from workspace root)
(function bindViewerWheel() {
    const root = document.getElementById("workspaceRoot") || document;
    root.addEventListener("wheel", e => {
        const viewer = activeViewerEl();
        if (!viewer || !(viewer === e.target || viewer.contains(e.target))) return;

        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();

            // rAF lock
            if (isZooming) return;
            isZooming = true;

            requestAnimationFrame(() => {
                const zoomSensitivity = 0.002;
                let zoomDelta = 1 - (e.deltaY * zoomSensitivity);
                let targetZoom = window.currentZoom * zoomDelta;

                window.applySmartZoom(targetZoom, e.clientX, e.clientY);
                isZooming = false;
            });
        }
    }, { passive: false });
})();

// Scroll does not bubble — capture on document, filter to active viewer
document.addEventListener("scroll", (e) => {
    const viewer = activeViewerEl();
    if (!viewer || e.target !== viewer) return;

    if (!syncScrollTimeout) {
        syncScrollTimeout = setTimeout(() => {
            const wrappers = Array.from(viewer.querySelectorAll(".pageWrapper"));
            if (wrappers.length === 0) {
                syncScrollTimeout = null;
                return;
            }

            const viewerRect = viewer.getBoundingClientRect();
            const viewerTargetY = viewerRect.top + (viewerRect.height / 3);

            let closestIndex = 0;
            let minDiff = Infinity;

            wrappers.forEach((w, index) => {
                const rect = w.getBoundingClientRect();
                const wrapperTargetY = rect.top + (rect.height / 3);
                const diff = Math.abs(wrapperTargetY - viewerTargetY);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIndex = index;
                }
            });

            const thumbs = document.querySelectorAll(".thumb-item");
            const activeThumb = thumbs[closestIndex];

            if (activeThumb) {
                thumbs.forEach(t => {
                    t.style.borderColor = "#ddd";
                    t.style.background = "#f4f6f8";
                });
                activeThumb.style.borderColor = "#0af";
                activeThumb.style.background = "#e6f7ff";

                const historySidebar = document.getElementById("historySidebar");
                const pagesTab = document.getElementById("pagesTab");

                if (historySidebar && pagesTab
                    && historySidebar.classList.contains("sidebar-open")
                    && pagesTab.classList.contains("active")) {
                    const targetTop = activeThumb.offsetTop - (pagesTab.clientHeight / 2) + (activeThumb.clientHeight / 2);
                    pagesTab.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
                }
            }
            syncScrollTimeout = null;
        }, 150);
    }
}, true);