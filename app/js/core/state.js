// ==========================================
// state.js: GLOBAL CONFIGURATION & STATE
// ==========================================
(function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol === "file:") return;
    // Install-only SW (network for everything — see sw.js). Version query helps updates.
    const ver = (window.GA_CONFIG && window.GA_CONFIG.version) || "0";
    navigator.serviceWorker.register("./sw.js?v=" + encodeURIComponent(ver)).catch((err) => {
        console.log("Service Worker registration failed:", err);
    });
})();

const _cfg = (k, d) => (typeof window.gaConfig === "function" ? window.gaConfig(k, d) : d);

window.APP = {
    // PDF Config (overridable via config.js)
    SAFE_FONTS: [
        "Roboto", "'Open Sans'", "Montserrat", "Merriweather", "Arial",
        "'Courier New'", "Georgia", "'Times New Roman'", "Verdana",
        "'Trebuchet MS'", "Impact", "'Comic Sans MS'", "'Great Vibes', cursive",
        "'Dancing Script', cursive", "'Homemade Apple', cursive",
        "'Caveat', cursive", "'Pacifico', cursive"
    ],
    SCROLL_ZONE: 80,
    SCROLL_SPEED: 12,
    ZOOM_STEP: Number(_cfg("zoomStep", 0.25)),
    MIN_ZOOM: Number(_cfg("minZoom", 0.5)),
    MAX_ZOOM: Number(_cfg("maxZoom", 3.0)),

    // App State
    // editor = annotate (text/shapes/images); form = fillable AcroForm design
    workspaceMode: "editor",
    currentMode: "select",
    activeOverlay: null,
    autoScrollInterval: null,
    isPixelated: false,
    isDrawingShape: false,
    isDrawingFormField: false,
    currentFormField: null,
    startX: 0,
    startY: 0,
    currentShape: null,
    pendingImageSrc: null,
    pendingSignatureSrc: null,
    dragging: false,
    resizing: false,
    isDrawingMarquee: false,
    marqueeBox: null,
    marqueeStartX: 0,
    marqueeStartY: 0,
    multiSelectedItems: new Set(),
    isXRayMode: false,

    // Cached DOM Elements (Prevents redundant lookups)
    DOM: {
        viewer: document.getElementById("viewer"),
        guideV: document.getElementById("guide-vertical"),
        guideH: document.getElementById("guide-horizontal"),
        toolModeSelect: document.getElementById("toolModeSelect"),
        fileInput: document.getElementById("fileInput"),
        editModal: document.getElementById("editModal"),
        sigModal: document.getElementById("sigModal"),
        helpModal: document.getElementById("helpModal"),
        saveAsModal: document.getElementById("saveAsModal"),
        dropChoiceModal: document.getElementById("dropChoiceModal"),
        modals: document.getElementsByClassName("modal"),
        printArea: document.getElementById("printArea")
    }
};

// Default zoom from config (workspace may re-apply per tab)
window.currentZoom = Number(_cfg("defaultZoom", 1.0)) || 1.0;
document.documentElement.style.setProperty("--ui-inverse-scale", 1 / window.currentZoom);

// Initialize PDF.js Worker
if (window.location.protocol !== "file:") {
    if (typeof pdfjsLib !== "undefined") {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "./lib/pdfjs/pdf.worker.local.js";
    }
} else {
    console.log("Running PDF.js in single-thread offline mode.");
}
