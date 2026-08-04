// ==========================================
// header-density.js: collapse header labels when they would overflow
// ==========================================
// Uses measured overflow (not viewport width alone) so Windows DPI scaling
// and non-maximized windows still get full labels when space allows.

(function () {
    const bar = document.getElementById("headerBar");
    if (!bar) return;

    let raf = 0;
    let lastCompact = null;

    function measureAndApply() {
        raf = 0;
        // Measure with FULL labels first
        bar.classList.remove("is-compact");
        // Force layout so scrollWidth reflects full chrome
        void bar.offsetWidth;

        const needsCompact = bar.scrollWidth > bar.clientWidth + 1;
        if (needsCompact) {
            bar.classList.add("is-compact");
        }

        if (lastCompact !== needsCompact) {
            lastCompact = needsCompact;
            // Optional: debug
            // console.log("header density:", needsCompact ? "compact" : "full", bar.clientWidth);
        }
    }

    function schedule() {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(measureAndApply);
    }

    // Initial pass after layout (fonts / flex settle)
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => schedule());
    } else {
        schedule();
    }
    window.addEventListener("load", () => schedule());
    window.addEventListener("resize", schedule);

    // WebView2 / DPI changes
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", schedule);
    }

    // If fonts load late, remeasure
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => schedule()).catch(() => {});
    }

    // Expose for rare manual refresh (e.g. after dynamic header changes)
    window.refreshHeaderDensity = schedule;
})();
