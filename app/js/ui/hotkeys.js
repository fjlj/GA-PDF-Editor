// ==========================================
// hotkeys.js: HELP MENU RENDERING
// ==========================================

/**
 * Help content — keep in sync with keyboard.js tool bindings.
 * Each section: { title, hint?, tone?, rows: [{ action, keys }] }
 * keys: string or string[] (rendered as separate <kbd> chips)
 */
window.HELP_SECTIONS = [
    {
        id: "workspace",
        title: "Workspace",
        hint: "Switch between annotating and designing fillable fields",
        tone: "cyan",
        rows: [
            { action: "Form mode (on Pointer)", keys: "F" },
            { action: "Editor mode (from Form)", keys: "E" },
            { action: "In Editor → Edit / Stamp tool", keys: "E" },
            { action: "Toggle Editor ↔ Form", keys: ["M", "Header switch"] },
            { action: "Pointer / Select", keys: "V" },
            { action: "Deselect / Select mode", keys: "Esc" }
        ]
    },
    {
        id: "form-tools",
        title: "Form mode tools",
        hint: "Only while Form workspace is active",
        tone: "violet",
        rows: [
            { action: "Form: Text field", keys: "T" },
            { action: "Form: Checkbox", keys: "C" },
            { action: "Form: Radio button", keys: "R" },
            { action: "Form: Dropdown", keys: "D" },
            { action: "Form: Signature field", keys: "G" },
            { action: "Place / size a field", keys: "Click-drag on page" },
            { action: "Resize selected field", keys: ["Corner handle", "W / H"] },
            { action: "Edit dropdown choices", keys: "Options… on field" },
            { action: "Radio group", keys: "Same name + unique values" },
            { action: "Export fillable PDF", keys: "File → Save PDF" }
        ]
    },
    {
        id: "editor-tools",
        title: "Editor tools",
        hint: "Annotate and stamp (Editor workspace)",
        tone: "coral",
        rows: [
            { action: "Text box", keys: "T" },
            { action: "Rectangle", keys: "R" },
            { action: "Circle / Ellipse", keys: "O" },
            { action: "Line / Redact", keys: "L" },
            { action: "Snip & Move", keys: "S" },
            { action: "Table / Grid", keys: "G" },
            { action: "Insert image", keys: "I" },
            { action: "Edit / Stamp (vacuum)", keys: "E" }
        ]
    },
    {
        id: "objects",
        title: "Canvas & objects",
        tone: "slate",
        rows: [
            { action: "X-Ray (see through layers)", keys: "X" },
            { action: "Delete selection", keys: ["Del", "Backspace"] },
            { action: "Clone selection", keys: "Alt + Drag" },
            { action: "Bring forward", keys: "]" },
            { action: "Send backward", keys: "[" },
            { action: "Lock aspect ratio", keys: "Shift + Drag" },
            { action: "Snap to center / edges", keys: "Ctrl + Drag" },
            { action: "Nudge 1px (undo coalesces)", keys: "Arrow keys" },
            { action: "Nudge 10px", keys: "Shift + Arrow" }
        ]
    },
    {
        id: "nav",
        title: "Navigation",
        tone: "slate",
        rows: [
            { action: "Zoom in / out", keys: ["Ctrl + Scroll", "+", "−"] },
            { action: "Scroll page", keys: "Mouse wheel" }
        ]
    },
    {
        id: "history",
        title: "History & files",
        tone: "slate",
        rows: [
            { action: "Undo", keys: "Ctrl + Z" },
            { action: "Redo", keys: ["Ctrl + Y", "Ctrl + Shift + Z"] },
            { action: "Save project (.gapdf)", keys: "Ctrl + S" }
        ]
    },
    {
        id: "power",
        title: "Power moves",
        tone: "amber",
        rows: [
            { action: "Marquee select", keys: "Drag in Pointer mode" },
            { action: "Text vacuum (stamp)", keys: "Drag in Edit mode" },
            { action: "Cut canvas snippet", keys: "Drag in Snip mode" },
            { action: "Copy canvas snippet", keys: "Alt + Drag in Snip" },
            { action: "Toggle pixelated render", keys: "Toolbar → Smoothing" }
        ]
    }
];

// Back-compat for anything still reading SHORTCUTS
window.SHORTCUTS = (function () {
    const out = {};
    (window.HELP_SECTIONS || []).forEach((sec) => {
        const map = {};
        (sec.rows || []).forEach((row) => {
            const k = Array.isArray(row.keys) ? row.keys.join("  ·  ") : String(row.keys);
            map[row.action] = k;
        });
        out[sec.title] = map;
    });
    return out;
})();

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderKeyChips(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return list
        .map((k, i) => {
            const chip = `<kbd class="help-kbd">${escapeHtml(k)}</kbd>`;
            if (i === 0) return chip;
            return `<span class="help-key-sep">or</span>${chip}`;
        })
        .join("");
}

window.renderHelpModal = function () {
    const container = document.getElementById("hotkeysContainer");
    if (!container) return;

    const sections = window.HELP_SECTIONS || [];
    // Balanced two-column pack by row count (stable visual weight)
    const left = [];
    const right = [];
    let leftN = 0;
    let rightN = 0;
    sections.forEach((sec) => {
        const n = (sec.rows && sec.rows.length) || 0;
        if (leftN <= rightN) {
            left.push(sec);
            leftN += n + 2; // + heading weight
        } else {
            right.push(sec);
            rightN += n + 2;
        }
    });

    const renderCol = (secs) =>
        secs
            .map(
                (sec) => `
        <section class="help-section help-tone-${escapeHtml(sec.tone || "slate")}">
            <header class="help-section-head">
                <h4 class="help-section-title">${escapeHtml(sec.title)}</h4>
                ${sec.hint ? `<p class="help-section-hint">${escapeHtml(sec.hint)}</p>` : ""}
            </header>
            <ul class="help-rows">
                ${(sec.rows || [])
                    .map(
                        (row) => `
                <li class="help-row">
                    <span class="help-action">${escapeHtml(row.action)}</span>
                    <span class="help-keys">${renderKeyChips(row.keys)}</span>
                </li>`
                    )
                    .join("")}
            </ul>
        </section>`
            )
            .join("");

    container.innerHTML = `
        <div class="help-grid">
            <div class="help-col">${renderCol(left)}</div>
            <div class="help-col">${renderCol(right)}</div>
        </div>`;
};

document.getElementById("helpBtn").addEventListener("click", () => {
    const m = APP.DOM.helpModal;
    if (m.style.display === "flex") m.style.display = "none";
    else {
        window.renderHelpModal();
        m.style.display = "flex";
    }
});
document.getElementById("closeHelpBtn").addEventListener("click", () => {
    APP.DOM.helpModal.style.display = "none";
});
