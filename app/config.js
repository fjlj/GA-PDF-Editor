/**
 * GA PDF Editor — centralized runtime configuration.
 * Loaded first (sync) so the dynamic script loader can cache-bust with `version`.
 *
 * Toggle features here without a bundler rebuild.
 */
(function (global) {
    "use strict";

    /** @type {Readonly<Record<string, unknown>>} */
    const GA_CONFIG = Object.freeze({
        /** Bump this when shipping script/CSS changes so clients re-fetch. */
        version: "1.5.11-tab-close-focus",

        // === Feature flags ===
        /** Multi-document tab bar (VS Code / Acrobat style). Off = classic single canvas. */
        enableTabbedMode: true,
        /** Editor ↔ Form workspace switcher and form-field tools. */
        enableFormMode: true,
        /** Hide OCR button / skip OCR wiring when true. */
        disableOCR: false,
        /**
         * After open, clone native AcroForm widgets into designer overlays (Form mode).
         * Natives stay visible for filling in Editor; designer twins show in Form mode only.
         */
        autoImportNativeForms: true,
        /** Persist open tabs in IndexedDB (file handles and/or PDF bytes) and restore on launch. */
        enableSessionRestore: true,
        /**
         * Cache each open PDF's bytes in IndexedDB so tabs restore even without a
         * FileSystemFileHandle (normal File menu / &lt;input type=file&gt; opens).
         */
        persistPdfBytesInSession: true,
        /** Soft cap per cached PDF (bytes). Larger files still open; only skip byte cache. */
        maxSessionPdfBytes: 80 * 1024 * 1024,
        /** Consume launchQueue / file_handlers for OS "Open with" into this window. */
        enableLaunchQueue: true,

        // === Defaults ===
        /** Initial zoom when a new document tab is created (1.0 = 100%). */
        defaultZoom: 1.25,
        minZoom: 0.5,
        maxZoom: 3.0,
        zoomStep: 0.25,

        /** Soft cap on open tabs (oldest closed after confirm when exceeded). */
        maxTabs: 16,

        /** IndexedDB database / store names for session restore. */
        sessionDbName: "ga-pdf-editor-session",
        sessionDbVersion: 1,
        sessionStoreKey: "workspace-v1",

        /** App chrome */
        appTitle: "GA PDF Editor",
        themeColor: "#00aaff"
    });

    global.GA_CONFIG = GA_CONFIG;

    /**
     * Helper: read a config key with fallback (safe if config missing).
     * @param {string} key
     * @param {*} [fallback]
     */
    global.gaConfig = function gaConfig(key, fallback) {
        const cfg = global.GA_CONFIG || {};
        return Object.prototype.hasOwnProperty.call(cfg, key) ? cfg[key] : fallback;
    };
})(typeof window !== "undefined" ? window : globalThis);
