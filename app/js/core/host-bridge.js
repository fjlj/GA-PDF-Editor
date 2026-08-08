// ==========================================
// host-bridge.js — talking to the desktop shell
// WebView2 (and friends). Browser PWA uses launchQueue instead.
// ==========================================

// Shell hands us { name, url } pointing at a mapped temp folder
// (keeps giant PDFs off the postMessage highway — base64 is not a personality).
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

    // "Hey workspace, user *meant* to open these — don't silently resurrect the old session under them"
    if (window.GaWorkspace && typeof window.GaWorkspace.noteStartupOpen === "function") {
        window.GaWorkspace.noteStartupOpen(files.length);
    }

    // Tabs on → one file, one tab. Tabs off → classic pile-into-active.
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
    // WebView2 leaves chrome.webview under the pillow for us
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

    // Don't yell "ready" until the workspace is awake enough to catch open-files.
    // Early ready = restore race = blank tabs with wrong names. We learned that the hard way.
    const signalReady = () => {
        try {
            wv.postMessage({ type: "ready" });
        } catch (e) {
            console.warn("host ready signal failed", e);
        }
    };

    const whenAcceptingOpens = (cb) => {
        if (window.__GA_WORKSPACE_ACCEPTING_STARTUP_OPENS__
            || window.__GA_WORKSPACE_READY__) {
            cb();
            return;
        }
        const onAccept = () => cb();
        window.addEventListener("ga-workspace-accepting-opens", onAccept, { once: true });
        window.addEventListener("ga-workspace-ready", onAccept, { once: true });
    };

    whenAcceptingOpens(() => {
        setTimeout(signalReady, 0); // one tick so other listeners finish their coffee
    });
})();
