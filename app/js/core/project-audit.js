// ==========================================
// project-audit.js: Rolling change log for .gapdf trailers
// ==========================================
// Insight into what this user changed in this project package.
// Not a legal e-sign ledger — OneDrive / file-share versioning covers file history.
//
// Caps: 200 entries rolling + ~128 KB compressed safety valve on save.

window.PROJECT_AUDIT_MAX_ENTRIES = 200;
window.PROJECT_AUDIT_MAX_COMPRESSED = 128 * 1024; // bytes after gzip, when pruning on save

window.projectAudit = {
    entries: [],
    seq: 0
};

/**
 * Truncate long strings for the trailer (avoid bloating with huge defaults).
 */
window.auditTruncate = function(val, maxLen) {
    const s = val == null ? "" : String(val);
    const n = maxLen || 120;
    if (s.length <= n) return s;
    return s.slice(0, n) + "…";
};

/**
 * Append one high-signal change. Oldest entries drop when over the rolling cap.
 *
 * @param {string} action  e.g. FIELD_CREATED, OVERLAY_ADD, SAVE_PROJECT
 * @param {object} [detail]  small JSON-safe summary (no DOM refs)
 */
window.logProjectAudit = function(action, detail) {
    try {
        if (!window.projectAudit || !Array.isArray(window.projectAudit.entries)) {
            window.projectAudit = { entries: [], seq: 0 };
        }
        const entry = {
            id: ++window.projectAudit.seq,
            t: new Date().toISOString(),
            action: String(action || "UNKNOWN").slice(0, 64)
        };
        if (detail && typeof detail === "object") {
            // Shallow copy only string/number/boolean/null fields; truncate strings
            const d = {};
            Object.keys(detail).forEach((k) => {
                if (d && Object.keys(d).length >= 12) return;
                const v = detail[k];
                if (v == null || typeof v === "number" || typeof v === "boolean") {
                    d[k] = v;
                } else if (typeof v === "string") {
                    d[k] = window.auditTruncate(v, 120);
                } else if (typeof v === "object" && !Array.isArray(v)) {
                    // one level only
                    try {
                        const s = JSON.stringify(v);
                        d[k] = window.auditTruncate(s, 160);
                    } catch (_) { /* skip */ }
                }
            });
            if (Object.keys(d).length) entry.detail = d;
        }
        window.projectAudit.entries.push(entry);
        while (window.projectAudit.entries.length > window.PROJECT_AUDIT_MAX_ENTRIES) {
            window.projectAudit.entries.shift();
        }
    } catch (e) {
        console.warn("logProjectAudit failed", e);
    }
};

/**
 * Reset audit log (new document / clear canvas).
 */
window.clearProjectAudit = function() {
    window.projectAudit = { entries: [], seq: 0 };
};

/**
 * Restore audit from a loaded project schema (keeps rolling window).
 */
window.loadProjectAudit = function(schema) {
    window.clearProjectAudit();
    if (!schema || !Array.isArray(schema.audit) || !schema.audit.length) return;
    const list = schema.audit.slice(-window.PROJECT_AUDIT_MAX_ENTRIES);
    let maxId = 0;
    list.forEach((e) => {
        if (!e || typeof e !== "object") return;
        const id = typeof e.id === "number" ? e.id : ++maxId;
        if (id > maxId) maxId = id;
        window.projectAudit.entries.push({
            id: id,
            t: e.t || new Date().toISOString(),
            action: String(e.action || "UNKNOWN").slice(0, 64),
            detail: e.detail && typeof e.detail === "object" ? e.detail : undefined
        });
    });
    window.projectAudit.seq = maxId;
    while (window.projectAudit.entries.length > window.PROJECT_AUDIT_MAX_ENTRIES) {
        window.projectAudit.entries.shift();
    }
};

/**
 * Snapshot for Save Project — applies entry cap, then optional compressed-size prune.
 * @returns {Promise<object[]>}
 */
window.getProjectAuditForSave = async function() {
    let entries = (window.projectAudit && window.projectAudit.entries)
        ? window.projectAudit.entries.slice(-window.PROJECT_AUDIT_MAX_ENTRIES)
        : [];

    if (!entries.length || typeof window.compressData !== "function") {
        return entries;
    }

    // Size safety: drop oldest until gzip(JSON(audit)) fits under cap
    try {
        let working = entries.slice();
        while (working.length > 20) {
            const compressed = await window.compressData(JSON.stringify(working));
            const len = compressed && compressed.byteLength != null
                ? compressed.byteLength
                : (compressed && compressed.length != null ? compressed.length : 0);
            if (len <= window.PROJECT_AUDIT_MAX_COMPRESSED) break;
            // drop ~10% oldest each pass
            const drop = Math.max(1, Math.floor(working.length * 0.1));
            working = working.slice(drop);
        }
        // Keep live log aligned with what we save (so reopen matches)
        if (working.length < entries.length && window.projectAudit) {
            window.projectAudit.entries = working.slice();
        }
        return working;
    } catch (e) {
        console.warn("getProjectAuditForSave size prune failed", e);
        return entries;
    }
};

/**
 * Map historyEngine action names → audit actions (coarse).
 */
window.auditFromHistoryAction = function(action) {
    if (!action) return;
    const name = String(action.name || action.opcode || "Edit");
    let code = "EDIT";
    const n = name.toLowerCase();
    if (/add form field/i.test(name)) code = "FIELD_CREATED";
    else if (/import .*form field/i.test(name)) code = "FIELD_IMPORTED";
    else if (/delete/i.test(n)) code = "OVERLAY_DELETED";
    else if (/add text|initialize text|add .*box/i.test(n)) code = "TEXT_ADDED";
    else if (/add .*image|dropped image|signature/i.test(n)) code = "IMAGE_ADDED";
    else if (/shape|rect|circle|ellipse|line|table|draw /i.test(n)) code = "SHAPE_ADDED";
    else if (/move|drag|resize|rotate|transform|align/i.test(n)) code = "OVERLAY_TRANSFORM";
    else if (/insert|append|page/i.test(n)) code = "PAGE_CHANGE";
    else if (action.opcode === "COMMIT_TRANSFORM" || action.opcode === "COMMIT_TRANSFORMS") {
        code = "OVERLAY_TRANSFORM";
    } else if (action.opcode === "CREATE_NODE") {
        code = "EDIT";
    } else if (action.opcode === "DELETE_NODE") {
        code = "OVERLAY_DELETED";
    }

    let targetId = action.targetId || null;
    let targetKind = null;
    try {
        let el = action.target;
        if (Array.isArray(el)) el = el[0];
        if (!el && targetId && window.GaProcessor) el = window.GaProcessor.byId(targetId);
        if (el && el.id) targetId = el.id;
        if (el && el.classList) {
            if (el.classList.contains("formFieldOverlay")) targetKind = "formField";
            else if (el.classList.contains("textOverlay")) targetKind = "text";
            else if (el.classList.contains("shapeOverlay")) targetKind = "shape";
            else if (el.classList.contains("overlayImg")) targetKind = "image";
        }
    } catch (_) { /* ignore */ }

    window.logProjectAudit(code, {
        label: window.auditTruncate(name, 80),
        targetId: targetId,
        targetKind: targetKind,
        opcode: action.opcode || null
    });
};
