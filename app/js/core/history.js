// ==========================================
// history.js: INSTRUCTION TAPE + SIDEBAR UI
// ==========================================
//
// Undo/redo stores Instruction objects (opcodes + payloads), not DOM closures.
// Undo = invert(instruction) → GaProcessor.execute
// Redo = execute(instruction)
//
// Legacy { undo, redo } closures are still accepted via LEGACY_CLOSURE during
// migration, but new code must use GaProcessor.commit / historyEngine.record.

const historySidebar = document.getElementById("historySidebar");
const historyList = document.getElementById("historyList");

let isHistoryPinned = false;
let previousActiveTab = null;
let autoOpenedHistory = false;
let autoCloseTimeout = null;
let isHoveringSidebar = false;

function resolveTargetEl(inst) {
    if (!inst) return null;
    if (inst.targetId && window.GaProcessor) {
        const el = window.GaProcessor.byId(inst.targetId);
        if (el) return el;
    }
    let t = inst.target;
    if (Array.isArray(t)) t = t[0];
    if (t && t.nodeType === 1) return t;
    if (inst.payload && inst.payload.targetId && window.GaProcessor) {
        return window.GaProcessor.byId(inst.payload.targetId);
    }
    if (inst.payload && inst.payload.items && inst.payload.items[0] && window.GaProcessor) {
        return window.GaProcessor.byId(inst.payload.items[0].targetId);
    }
    return null;
}

function isInstruction(x) {
    return !!(x && typeof x.opcode === "string");
}

function isLegacyClosure(x) {
    return !!(x && (typeof x.undo === "function" || typeof x.redo === "function") && !x.opcode);
}

window.historyEngine = {
    undoStack: [],
    redoStack: [],
    isProcessing: false,
    actionQueue: [],
    savePoint: 0,

    scrollToTarget: function (inst) {
        const scrollTarget = resolveTargetEl(inst);
        const viewer = (window.APP && APP.DOM && APP.DOM.viewer) || document.getElementById("viewer");
        if (!scrollTarget || !viewer || !viewer.contains(scrollTarget)) return false;

        const rect = scrollTarget.getBoundingClientRect();
        const viewerRect = viewer.getBoundingClientRect();
        const isOutTop = rect.top < viewerRect.top + 50;
        const isOutBottom = rect.bottom > viewerRect.bottom - 50;

        if (isOutTop || isOutBottom) {
            const targetCenterY = rect.top + rect.height / 2;
            const viewerCenterY = viewerRect.top + viewerRect.height / 2;
            viewer.scrollTo({
                top: viewer.scrollTop + (targetCenterY - viewerCenterY),
                behavior: "smooth"
            });
            return true;
        }
        return false;
    },

    processQueue: function () {
        if (this.isProcessing || this.actionQueue.length === 0) return;
        this.isProcessing = true;

        const task = this.actionQueue.shift();
        const inst = task.type === "undo" ? this.undoStack.pop() : this.redoStack.pop();

        if (!inst) {
            this.isProcessing = false;
            this.processQueue();
            return;
        }

        const didScroll = this.scrollToTarget(inst);

        setTimeout(() => {
            if (window.clearMultiSelection) window.clearMultiSelection();
            if (window.clearActiveOverlay) window.clearActiveOverlay(true);

            const P = window.GaProcessor;

            if (inst.opcode === "LEGACY_CLOSURE" || isLegacyClosure(inst)) {
                if (task.type === "undo") {
                    if (typeof inst.undo === "function") inst.undo();
                    this.redoStack.push(inst);
                } else {
                    if (typeof inst.redo === "function") inst.redo();
                    this.undoStack.push(inst);
                }
            } else if (task.type === "undo") {
                const inv = P ? P.invert(inst) : null;
                if (inv && P) P.execute(inv, { applied: false });
                this.redoStack.push(inst);
            } else {
                if (P) P.execute(inst, { applied: false });
                this.undoStack.push(inst);
            }

            this.scrollToTarget(inst);

            const focusTarget = resolveTargetEl(inst);
            if (focusTarget && focusTarget.isConnected && APP.multiSelectedItems && APP.multiSelectedItems.size === 0) {
                const isOverlay = focusTarget.classList && (
                    focusTarget.classList.contains("textOverlay") ||
                    focusTarget.classList.contains("shapeOverlay") ||
                    focusTarget.classList.contains("overlayImg") ||
                    focusTarget.classList.contains("formFieldOverlay")
                );
                if (isOverlay && window.setActiveOverlay) window.setActiveOverlay(focusTarget);
            }

            window.updateHistoryUI();
            window.peekHistoryTab();
            this.isProcessing = false;
            this.processQueue();
        }, didScroll ? 400 : 0);
    },

    /**
     * Preferred: record a pure Instruction (already applied or about to be applied by Processor).
     */
    record: function (instruction) {
        if (this.isProcessing) return;
        if (!isInstruction(instruction)) {
            console.warn("[history] record expects { opcode, ... }", instruction);
            return;
        }

        // Splice "Initialize Text" after CREATE of same text box
        if (instruction.name === "Initialize Text" || (instruction.meta && instruction.meta.rebaseAfterCreate)) {
            const tid = instruction.targetId;
            let insertIndex = -1;
            for (let i = this.undoStack.length - 1; i >= 0; i--) {
                const past = this.undoStack[i];
                if (past && past.opcode === "CREATE_NODE" && past.targetId === tid && /add text/i.test(past.name || "")) {
                    insertIndex = i;
                    break;
                }
            }
            if (insertIndex !== -1) {
                this.undoStack.splice(insertIndex + 1, 0, instruction);
                this.redoStack = [];
                window.updateHistoryUI();
                if (typeof window.auditFromHistoryAction === "function") {
                    window.auditFromHistoryAction(instruction);
                }
                return;
            }
        }

        this.undoStack.push(instruction);
        this.redoStack = [];
        window.updateHistoryUI();
        if (typeof window.auditFromHistoryAction === "function") {
            window.auditFromHistoryAction(instruction);
        }
    },

    /**
     * push(action):
     *  - Instruction → record
     *  - Legacy { name, undo, redo, target } → LEGACY_CLOSURE (deprecated)
     */
    push: function (action) {
        if (this.isProcessing) return;

        if (isInstruction(action)) {
            this.record(action);
            return;
        }

        if (isLegacyClosure(action)) {
            // Best-effort auto-convert create-style actions still in DOM
            if (window.GaProcessor) {
                const el = Array.isArray(action.target) ? action.target[0] : action.target;
                const name = action.name || "Edit";
                if (el && el.nodeType === 1 && el.isConnected && /add |create |clone |stamp |draw |insert /i.test(name)) {
                    this.record(window.GaProcessor.build.createNode(el, name));
                    return;
                }
            }

            console.warn("[history] legacy closure push — migrate to GaProcessor.commit:", action.name);
            const legacyInst = {
                opcode: "LEGACY_CLOSURE",
                name: action.name || "Edit",
                targetId: action.target && !Array.isArray(action.target) && action.target.id
                    ? action.target.id
                    : null,
                target: action.target,
                parentPage: action.parentPage,
                undo: action.undo,
                redo: action.redo,
                payload: {}
            };
            this.undoStack.push(legacyInst);
            this.redoStack = [];
            window.updateHistoryUI();
            if (typeof window.auditFromHistoryAction === "function") {
                window.auditFromHistoryAction(legacyInst);
            }
            return;
        }

        console.warn("[history] push ignored", action);
    },

    undo: function () {
        if (this.undoStack.length === 0 && this.actionQueue.length === 0) return;
        this.actionQueue.push({ type: "undo" });
        this.processQueue();
    },

    redo: function () {
        if (this.redoStack.length === 0 && this.actionQueue.length === 0) return;
        this.actionQueue.push({ type: "redo" });
        this.processQueue();
    }
};

// LEGACY_CLOSURE is a no-op under execute(); undo/redo use .undo/.redo on the record.
if (window.GaProcessor) {
    window.GaProcessor.register("LEGACY_CLOSURE", function () { /* intentional no-op */ });
}

window.updateHistoryUI = function () {
    if (!historyList) return;
    historyList.innerHTML = "";
    for (let i = window.historyEngine.redoStack.length - 1; i >= 0; i--) {
        const li = document.createElement("div");
        li.className = "history-item future-state";
        const rec = window.historyEngine.redoStack[i];
        li.innerText = "Redo: " + (rec.name || rec.opcode || "Edit");
        const stepsToJump = window.historyEngine.redoStack.length - i;
        li.onclick = () => {
            for (let s = 0; s < stepsToJump; s++) window.historyEngine.redo();
        };
        historyList.appendChild(li);
    }
    const currentLi = document.createElement("div");
    currentLi.className = "history-item current-state";
    currentLi.innerText = window.historyEngine.undoStack.length === 0 ? "Original Document" : "Current State";
    historyList.appendChild(currentLi);
    for (let i = window.historyEngine.undoStack.length - 1; i >= 0; i--) {
        const li = document.createElement("div");
        li.className = "history-item past-state";
        const rec = window.historyEngine.undoStack[i];
        li.innerText = rec.name || rec.opcode || "Edit";
        const stepsToJump = window.historyEngine.undoStack.length - i;
        li.onclick = () => {
            for (let s = 0; s < stepsToJump; s++) window.historyEngine.undo();
        };
        historyList.appendChild(li);
    }
};

window.peekHistoryTab = function () {
    if (isHistoryPinned) return;
    clearTimeout(autoCloseTimeout);

    if (!historySidebar.classList.contains("sidebar-open")) {
        autoOpenedHistory = true;
        const activeTab = document.querySelector(".panel-tab.active");
        previousActiveTab = activeTab ? activeTab.dataset.target : "pagesTab";
        historySidebar.classList.add("sidebar-open");
    }

    document.querySelectorAll(".panel-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel-content").forEach((c) => c.classList.remove("active"));
    document.querySelector(".panel-tab[data-target='historyTab']").classList.add("active");
    document.getElementById("historyTab").classList.add("active");

    if (!isHoveringSidebar) {
        autoCloseTimeout = setTimeout(() => {
            if (!isHistoryPinned && historySidebar.classList.contains("sidebar-open")) closeSidebar();
        }, 3500);
    }
};

const closeSidebar = () => {
    isHistoryPinned = false;
    historySidebar.classList.remove("sidebar-open");

    if (autoOpenedHistory && previousActiveTab) {
        setTimeout(() => {
            document.querySelectorAll(".panel-tab").forEach((t) => t.classList.remove("active"));
            document.querySelectorAll(".panel-content").forEach((c) => c.classList.remove("active"));
            document.querySelector(`.panel-tab[data-target='${previousActiveTab}']`).classList.add("active");
            document.getElementById(previousActiveTab).classList.add("active");
            autoOpenedHistory = false;
        }, 300);
    }
};

historySidebar.addEventListener("mouseenter", () => {
    isHoveringSidebar = true;
    if (autoOpenedHistory) clearTimeout(autoCloseTimeout);
});

historySidebar.addEventListener("mouseleave", () => {
    isHoveringSidebar = false;
    if (autoOpenedHistory && !isHistoryPinned) {
        autoCloseTimeout = setTimeout(() => {
            if (!isHistoryPinned && historySidebar.classList.contains("sidebar-open")) closeSidebar();
        }, 1500);
    }
});

document.getElementById("historyToggleBtn").addEventListener("click", () => {
    isHistoryPinned = !isHistoryPinned;
    clearTimeout(autoCloseTimeout);
    if (isHistoryPinned) {
        historySidebar.classList.add("sidebar-open");
        autoOpenedHistory = false;
    } else {
        closeSidebar();
    }
    window.updateHistoryUI();
});

document.getElementById("closeHistoryBtn").addEventListener("click", closeSidebar);
document.getElementById("undoBtn").addEventListener("click", () => window.historyEngine.undo());
document.getElementById("redoBtn").addEventListener("click", () => window.historyEngine.redo());

document.querySelectorAll(".panel-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        autoOpenedHistory = false;
        document.querySelectorAll(".panel-tab").forEach((t) => t.classList.remove("active"));
        document.querySelectorAll(".panel-content").forEach((c) => c.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(tab.dataset.target).classList.add("active");
    });
});
