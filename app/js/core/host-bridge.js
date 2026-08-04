// ==========================================
// host-bridge.js: Desktop shell integration
// WebView2 (Windows) + future hosts. PWA uses launchQueue in io.js.
// ==========================================

/**
 * Open files delivered by a native shell.
 * entries: [{ name: "doc.pdf", url: "https://ga-open.local/...." }]
 * Host maps a temp folder so large files avoid base64 postMessage limits.
 */
window.openFromHostUrls = async function (entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;

    const files = [];
    for (const entry of entries) {
        if (!entry || !entry.url || !entry.name) continue;
        try {
            const res = await fetch(entry.url);
            if (!res.ok) throw new Error("HTTP " + res.status);
            const blob = await res.blob();
            const lower = String(entry.name).toLowerCase();
            const type = lower.endsWith(".pdf")
                ? "application/pdf"
                : (lower.endsWith(".gapdf") ? "application/octet-stream" : (blob.type || "application/octet-stream"));
            files.push(new File([blob], entry.name, { type: type }));
        } catch (err) {
            console.error("openFromHostUrls failed for", entry.name, err);
            if (typeof window.customAlert === "function") {
                await window.customAlert("Could not open: " + entry.name + "\n" + (err && err.message ? err.message : err));
            }
        }
    }

    if (files.length === 0) return;

    // Prefer multi-tab open when enabled (each host file → its own tab)
    if (window.GaWorkspace && window.GaWorkspace.tabbed && window.GaWorkspace.tabbed()
        && typeof window.GaWorkspace.openFilesAsTabs === "function") {
        await window.GaWorkspace.openFilesAsTabs(files.map((f) => ({ file: f, handle: null })));
    } else if (typeof window.processPdfFiles === "function") {
        await window.processPdfFiles(files, false);
    } else {
        console.error("processPdfFiles not available yet");
    }
};

window.__GA_SHELL__ = null;

(function initHostBridge() {
    // Microsoft Edge WebView2 injects chrome.webview
    const wv = window.chrome && window.chrome.webview;
    if (!wv) return;

    window.__GA_SHELL__ = "webview2";
    console.log("GA host bridge: WebView2");

    wv.addEventListener("message", async (event) => {
        let msg = event.data;
        if (typeof msg === "string") {
            try { msg = JSON.parse(msg); } catch (_) { return; }
        }
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "open-files" && Array.isArray(msg.files)) {
            await window.openFromHostUrls(msg.files);
        }
    });

    // Tell the shell the page can accept files (after our listeners are ready)
    const signalReady = () => {
        try {
            wv.postMessage({ type: "ready" });
        } catch (e) {
            console.warn("host ready signal failed", e);
        }
    };

    if (document.readyState === "complete") {
        // Defer so processPdfFiles / renderPDF scripts are defined (defer order)
        setTimeout(signalReady, 0);
    } else {
        window.addEventListener("load", () => setTimeout(signalReady, 0));
    }
})();
