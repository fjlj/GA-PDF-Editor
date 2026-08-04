// ==========================================
// modals.js: DRAGGABLE WINDOWS & PROMPTS
// ==========================================

window.makeModalDraggable = function(modal) {
    if (!modal) return;
    let isDragging = false; let startX, startY, initialLeft, initialTop;
    modal.addEventListener("mousedown", (e) => {
        if (e.target.closest('button, input, select, label, #editModalText, #sigPreviews, .editModalControls, .close-btn')) return; 
        isDragging = true; startX = e.clientX; startY = e.clientY;
        if (modal.style.transform !== "none") {
            const rect = modal.getBoundingClientRect();
            modal.style.width = rect.width + "px"; modal.style.left = rect.left + "px"; modal.style.top = rect.top + "px"; modal.style.transform = "none"; 
        }
        initialLeft = parseFloat(modal.style.left) || 0; initialTop = parseFloat(modal.style.top) || 0;
    });
    window.addEventListener("mousemove", (e) => {
        if (!isDragging) return;
        modal.style.left = (initialLeft + (e.clientX - startX)) + "px"; modal.style.top = (initialTop + (e.clientY - startY)) + "px";
    });
    window.addEventListener("mouseup", () => { isDragging = false; });
};

window.initAllModals = function() {
    for (const modal of APP.DOM.modals) {
        window.makeModalDraggable(modal);
    }
};
window.initAllModals();

window.customAlert = function(message, title = "⚠️ Attention") {
    return new Promise(resolve => {
        const modal = document.getElementById("alertModal");
        document.getElementById("alertModalTitle").innerHTML = title;
        document.getElementById("alertModalText").innerHTML = message;
        modal.style.display = "flex";
        
        const okBtn = document.getElementById("alertModalOkBtn");
        const cleanup = () => {
            modal.style.display = "none";
            okBtn.removeEventListener("click", cleanup);
            resolve();
        };
        okBtn.addEventListener("click", cleanup);
    });
};

window.customConfirm = function(message, title = "❓ Please Confirm", opts = {}) {
    return new Promise(resolve => {
        const modal = document.getElementById("confirmModal");
        document.getElementById("confirmModalTitle").innerHTML = title;
        document.getElementById("confirmModalText").innerHTML = message;
        modal.style.display = "flex";
        
        const yesBtn = document.getElementById("confirmModalYesBtn");
        const noBtn = document.getElementById("confirmModalNoBtn");
        const prevYes = yesBtn.textContent;
        const prevNo = noBtn.textContent;
        // Optional custom button labels (e.g. Import / Skip)
        if (opts && opts.yesLabel) yesBtn.textContent = opts.yesLabel;
        if (opts && opts.noLabel) noBtn.textContent = opts.noLabel;
        
        const cleanup = (result) => {
            modal.style.display = "none";
            yesBtn.textContent = prevYes;
            noBtn.textContent = prevNo;
            yesBtn.removeEventListener("click", onYes);
            noBtn.removeEventListener("click", onNo);
            resolve(result);
        };
        
        const onYes = () => cleanup(true);
        const onNo = () => cleanup(false);
        
        yesBtn.addEventListener("click", onYes);
        noBtn.addEventListener("click", onNo);
    });
};

/**
 * Password entry for encrypted PDFs (and similar).
 * @param {string} message
 * @param {string} [title]
 * @param {{ incorrect?: boolean }} [opts]
 * @returns {Promise<string|null>} password string, or null if cancelled
 */
window.customPasswordPrompt = function(message, title = "🔒 Password required", opts = {}) {
    return new Promise(resolve => {
        const modal = document.getElementById("passwordModal");
        const input = document.getElementById("passwordModalInput");
        const hint = document.getElementById("passwordModalHint");
        const okBtn = document.getElementById("passwordModalOkBtn");
        const cancelBtn = document.getElementById("passwordModalCancelBtn");
        if (!modal || !input || !okBtn || !cancelBtn) {
            const fallback = window.prompt(message || "Password:");
            resolve(fallback === null ? null : String(fallback));
            return;
        }

        document.getElementById("passwordModalTitle").textContent = title;
        document.getElementById("passwordModalText").textContent = message || "This PDF is password-protected.";
        input.value = "";
        if (hint) {
            if (opts.incorrect) {
                hint.style.display = "block";
                hint.textContent = "Incorrect password. Try again.";
            } else {
                hint.style.display = "none";
                hint.textContent = "";
            }
        }
        modal.style.display = "flex";
        setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 0);

        const cleanup = (result) => {
            modal.style.display = "none";
            okBtn.removeEventListener("click", onOk);
            cancelBtn.removeEventListener("click", onCancel);
            input.removeEventListener("keydown", onKey);
            resolve(result);
        };
        const onOk = () => cleanup(String(input.value || ""));
        const onCancel = () => cleanup(null);
        const onKey = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                onOk();
            } else if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
            }
        };

        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
        input.addEventListener("keydown", onKey);
    });
};

window.promptSaveAsName = function(defaultName, title = "💾 Save File As") {
    return new Promise((resolve) => {
        const input = document.getElementById("saveAsInput");
        const btnSave = document.getElementById("saveAsConfirmBtn");
        const btnCancel = document.getElementById("saveAsCancelBtn");
        const titleEl = document.getElementById("saveAsModalTitle");

        if (titleEl) titleEl.textContent = title;
        input.value = defaultName;
        APP.DOM.saveAsModal.style.display = "flex";
        input.focus();

        const extIndex = defaultName.lastIndexOf(".");
        if (extIndex > 0) input.setSelectionRange(0, extIndex);

        const cleanup = () => {
            APP.DOM.saveAsModal.style.display = "none";
            btnSave.removeEventListener("click", onConfirm);
            btnCancel.removeEventListener("click", onCancel);
            input.removeEventListener("keydown", onKeydown);
        };

        const onConfirm = () => { cleanup(); resolve(input.value.trim() || null); };
        const onCancel = () => { cleanup(); resolve(null); };
        const onKeydown = (e) => {
            if (e.key === "Enter") onConfirm();
            if (e.key === "Escape") onCancel();
        };

        btnSave.addEventListener("click", onConfirm);
        btnCancel.addEventListener("click", onCancel);
        input.addEventListener("keydown", onKeydown);
    });
};

/**
 * Multi-row options editor (dropdown choices, etc.).
 * @param {string[]} initialOptions
 * @param {{ title?: string, help?: string, minItems?: number }} [opts]
 * @returns {Promise<string[]|null>} null if cancelled
 */
window.promptFormOptionsList = function(initialOptions = [], opts = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById("formOptionsModal");
        const listEl = document.getElementById("formOptionsList");
        const titleEl = document.getElementById("formOptionsModalTitle");
        const helpEl = document.getElementById("formOptionsModalHelp");
        const addBtn = document.getElementById("formOptionsAddBtn");
        const confirmBtn = document.getElementById("formOptionsConfirmBtn");
        const cancelBtn = document.getElementById("formOptionsCancelBtn");

        if (!modal || !listEl) {
            console.error("formOptionsModal missing from DOM");
            resolve(null);
            return;
        }

        const minItems = opts.minItems != null ? opts.minItems : 1;
        if (titleEl) titleEl.textContent = opts.title || "📋 Dropdown options";
        if (helpEl) {
            helpEl.textContent = opts.help
                || "Each row is one choice the person filling the PDF will see.";
        }

        const addRow = (value = "") => {
            const row = document.createElement("div");
            row.className = "form-option-row";

            const grip = document.createElement("span");
            grip.className = "form-option-grip";
            grip.textContent = "⠿";
            grip.title = "Option";

            const input = document.createElement("input");
            input.type = "text";
            input.value = value;
            input.placeholder = "Option label";
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    addRow("");
                    const inputs = listEl.querySelectorAll("input");
                    inputs[inputs.length - 1].focus();
                }
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "form-option-remove";
            removeBtn.title = "Remove option";
            removeBtn.textContent = "×";
            removeBtn.addEventListener("click", () => {
                const rows = listEl.querySelectorAll(".form-option-row");
                if (rows.length <= minItems) {
                    input.value = "";
                    input.focus();
                    return;
                }
                row.remove();
            });

            row.append(grip, input, removeBtn);
            listEl.appendChild(row);
            return input;
        };

        listEl.innerHTML = "";
        const seed = (Array.isArray(initialOptions) && initialOptions.length)
            ? initialOptions
            : [""];
        seed.forEach((v) => addRow(String(v)));

        modal.style.display = "flex";
        const firstInput = listEl.querySelector("input");
        if (firstInput) {
            firstInput.focus();
            firstInput.select();
        }

        const cleanup = (result) => {
            modal.style.display = "none";
            addBtn.removeEventListener("click", onAdd);
            confirmBtn.removeEventListener("click", onConfirm);
            cancelBtn.removeEventListener("click", onCancel);
            modal.removeEventListener("keydown", onKeydown);
            resolve(result);
        };

        const onAdd = () => {
            const input = addRow("");
            input.focus();
        };

        const onConfirm = () => {
            const values = Array.from(listEl.querySelectorAll("input"))
                .map((inp) => inp.value.trim())
                .filter(Boolean);
            if (values.length < minItems) {
                window.customAlert(`Please add at least ${minItems} option${minItems === 1 ? "" : "s"}.`);
                return;
            }
            cleanup(values);
        };

        const onCancel = () => cleanup(null);

        const onKeydown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
            }
        };

        addBtn.addEventListener("click", onAdd);
        confirmBtn.addEventListener("click", onConfirm);
        cancelBtn.addEventListener("click", onCancel);
        modal.addEventListener("keydown", onKeydown);
    });
};