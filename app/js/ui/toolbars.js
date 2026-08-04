// ==========================================
// toolbars.js: RICH TEXT UI GENERATOR
// ==========================================

window.createRichTextToolbar = function(textNode, styleNode) {
    const toolbar = document.createElement("div"); 
    toolbar.style.cssText = "display: flex; flex-direction: column; gap: 6px; align-items: flex-start; background: #f4f6f8; padding: 6px 8px; border-radius: 4px; border: 1px solid #ddd; margin-bottom: 4px;";
    
    const row1 = document.createElement("div");
    row1.style.cssText = "display: flex; align-items: center; gap: 6px; width: 100%;";
    
    const row2 = document.createElement("div");
    row2.style.cssText = "display: flex; align-items: center; gap: 6px; width: 100%;";

    const createDivider = () => {
        const div = document.createElement("div");
        div.style.cssText = "width: 1px; height: 24px; background: #ccc; margin: 0 2px;";
        return div;
    };

	const isModal = textNode.id === "editModalText";
	
	// 💉 EyeDropper Helper
    const addEyeDropper = (colorInput, saveRangeCallback) => {
        if (!window.EyeDropper) return; // Fails gracefully on Firefox/Safari
        
        const dropperBtn = document.createElement("button");
        dropperBtn.innerHTML = "💧"; 
        dropperBtn.title = "Pick color from screen";
        dropperBtn.style.cssText = "cursor: pointer; background: transparent; border: none; padding: 0 4px; font-size: 14px; outline: none;";
        
        dropperBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            
            // Save text selection before losing focus
            if (saveRangeCallback) saveRangeCallback(); 
            
            const parentModal = dropperBtn.closest('.modal');
            let pickedColor = null;

            try {
                // 1. Hide the modal to reveal the document
                if (parentModal) {
                    // Stash current display state to restore it cleanly later
                    parentModal.dataset.prevDisplay = parentModal.style.display;
                    
                    // We use opacity instead of 'display: none' because 'display: none' 
                    // completely destroys the browser's internal text selection range 
                    // on contenteditable elements. Opacity keeps the DOM node active.
                    parentModal.style.opacity = '0';
                    parentModal.style.pointerEvents = 'none';
                    
                    // Tiny delay to ensure the browser paints the hidden state 
                    // before the blocking native UI thread takes over
                    await new Promise(r => setTimeout(r, 50)); 
                }

                // 2. Open the native picker
                const dropper = new EyeDropper();
                const result = await dropper.open();
                pickedColor = result.sRGBHex;
                
            } catch (err) {
                // User pressed Escape/Cancel, do nothing
            } finally {
                // 3. ALWAYS restore the modal, whether successful or cancelled
                if (parentModal) {
                    parentModal.style.opacity = '1';
                    parentModal.style.pointerEvents = 'auto';
                }
            }

            // 4. Apply the color ONLY AFTER the modal is visible again
            if (pickedColor) {
                colorInput.value = pickedColor;
                colorInput.dispatchEvent(new Event("input")); // Triggers your existing style logic
            }
        });
        
        // Insert it directly after the color input element
        colorInput.parentNode.insertBefore(dropperBtn, colorInput.nextSibling);
    };
 
    const fontPicker = document.createElement("select"); fontPicker.style.cssText = (isModal ? "" : "flex-grow:1; ") + "padding: 4px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; outline: none;";
    APP.SAFE_FONTS.forEach(font => { 
        const opt = document.createElement("option"); opt.value = font; opt.innerText = font.replace(/'/g, "").replace(", cursive", ""); opt.style.fontFamily = font; fontPicker.appendChild(opt); 
    });
    fontPicker.addEventListener("change", e => {
        textNode.focus(); const sel = window.getSelection();
        if (!sel || sel.isCollapsed) styleNode.style.fontFamily = e.target.value; 
        else document.execCommand("fontName", false, e.target.value); 
    });

    const sizeInput = document.createElement("input"); sizeInput.type = "number"; sizeInput.style.cssText = "width: 45px; padding: 4px; border-radius: 4px; border: 1px solid #ccc; outline: none;";
    sizeInput.addEventListener("input", e => styleNode.style.fontSize = e.target.value + "px");

    const textColorWrapper = document.createElement("div"); textColorWrapper.style.cssText = "display: flex; align-items: center; border: 1px solid #ccc; border-radius: 4px; padding: 0 4px; height: 26px; background: #fff;";
    const textColorIcon = document.createElement("span"); textColorIcon.innerHTML = "A"; textColorIcon.title = "Text Color"; textColorIcon.style.cssText = "font-weight: bold; font-family: serif; margin-right: 4px; font-size: 14px; color: #333;";
    const colorPicker = document.createElement("input"); colorPicker.type = "color"; colorPicker.style.cssText = "cursor: pointer; padding: 0; border: none; width: 22px; height: 20px; background: transparent;";
    textColorWrapper.append(textColorIcon, colorPicker);
	addEyeDropper(colorPicker, () => { const sel = window.getSelection(); if (sel.rangeCount > 0) savedRange = sel.getRangeAt(0); });

    let savedRange = null; 
    colorPicker.addEventListener("mousedown", () => { const sel = window.getSelection(); if (sel.rangeCount > 0) savedRange = sel.getRangeAt(0); });
    colorPicker.addEventListener("input", e => {
        textNode.focus();
        if (savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) styleNode.style.color = e.target.value;
        else document.execCommand("foreColor", false, e.target.value);
    });

    const highlightWrapper = document.createElement("div"); highlightWrapper.style.cssText = "display: flex; align-items: center; border: 1px solid #ccc; border-radius: 4px; padding: 0 0 0 4px; height: 26px; background: #fff;";
    const highlightIcon = document.createElement("span"); highlightIcon.innerHTML = "🖍️"; highlightIcon.title = "Text Highlight Color"; highlightIcon.style.cssText = "margin-right: 2px; font-size: 12px;";
    const highlightPicker = document.createElement("input"); highlightPicker.type = "color"; highlightPicker.style.cssText = "cursor: pointer; padding: 0; border: none; width: 22px; height: 20px; background: transparent; outline: none;";
    const clearHighlightBtn = document.createElement("button"); clearHighlightBtn.innerHTML = "&times;"; clearHighlightBtn.title = "Remove Highlight"; clearHighlightBtn.style.cssText = "cursor: pointer; background: transparent; border: none; border-left: 1px solid #ccc; padding: 0 6px; margin-left: 4px; font-weight: bold; font-size: 16px; height: 100%; display: flex; align-items: center; justify-content: center; color: #555;";
    highlightWrapper.append(highlightIcon, highlightPicker, clearHighlightBtn);
	addEyeDropper(highlightPicker, () => { const sel = window.getSelection(); if (sel.rangeCount > 0) savedHighlightRange = sel.getRangeAt(0); });
	
    let savedHighlightRange = null; 
    highlightPicker.addEventListener("mousedown", () => { const sel = window.getSelection(); if (sel.rangeCount > 0) savedHighlightRange = sel.getRangeAt(0); });
    highlightPicker.addEventListener("input", e => {
        textNode.focus();
        if (savedHighlightRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedHighlightRange); }
        document.execCommand("backColor", false, e.target.value);
    });
    clearHighlightBtn.addEventListener("mousedown", e => { e.preventDefault(); document.execCommand("backColor", false, "transparent"); });

    const fillWrapper = document.createElement("div"); fillWrapper.style.cssText = "display: flex; align-items: center; border: 1px solid #ccc; border-radius: 4px; padding: 0 0 0 4px; height: 26px; background: #fff;";
    const fillIcon = document.createElement("span"); fillIcon.innerHTML = "🔲"; fillIcon.title = "Background Fill Color"; fillIcon.style.cssText = "margin-right: 2px; font-size: 14px;";
    const fillPicker = document.createElement("input"); fillPicker.type = "color"; fillPicker.style.cssText = "cursor: pointer; padding: 0; border: none; width: 22px; height: 20px; background: transparent; outline: none;";
    const clearFillBtn = document.createElement("button"); clearFillBtn.innerHTML = "&times;"; clearFillBtn.title = "Remove Background"; clearFillBtn.style.cssText = "cursor: pointer; background: transparent; border: none; border-left: 1px solid #ccc; padding: 0 6px; margin-left: 4px; font-weight: bold; font-size: 16px; height: 100%; display: flex; align-items: center; justify-content: center; color: #555;";
    fillWrapper.append(fillIcon, fillPicker, clearFillBtn);
	addEyeDropper(fillPicker);

    fillPicker.addEventListener("input", e => { styleNode.style.backgroundColor = e.target.value; });
    clearFillBtn.addEventListener("mousedown", e => { e.preventDefault(); styleNode.style.backgroundColor = "transparent"; styleNode.style.border = "none"; });
	// Border controls wrapper
    const borderWrapper = document.createElement("div"); 
    borderWrapper.style.cssText = "display: flex; align-items: center; border: 1px solid #ccc; border-radius: 4px; padding: 0 4px; height: 26px; background: #fff;";
    
    const borderIcon = document.createElement("span"); 
    borderIcon.innerHTML = "🔳"; 
    borderIcon.title = "Border Color & Thickness";
    borderIcon.style.cssText = "margin-right: 4px; font-size: 14px;";
    
    const borderPicker = document.createElement("input"); 
    borderPicker.type = "color"; 
    borderPicker.style.cssText = "cursor: pointer; padding: 0; border: none; width: 22px; height: 20px; background: transparent; outline: none;";
    
    const borderWidthInput = document.createElement("input"); 
    borderWidthInput.type = "number"; 
    borderWidthInput.min = "0"; 
    borderWidthInput.max = "20"; 
    borderWidthInput.style.cssText = "width: 35px; padding: 0; margin-left: 6px; border: none; border-left: 1px solid #eee; padding-left: 6px; outline: none; background: transparent;";
    borderWidthInput.title = "Border Thickness (px) - Set to 0 to remove";

    borderWrapper.append(borderIcon, borderPicker, borderWidthInput);
	addEyeDropper(borderPicker);
	
    const updateBorder = () => {
        const w = parseInt(borderWidthInput.value) || 0;
        if (w > 0) {
            styleNode.style.border = `${w}px solid ${borderPicker.value}`;
        } else {
            styleNode.style.border = "none";
        }
    };

    borderPicker.addEventListener("input", updateBorder);
    borderWidthInput.addEventListener("input", updateBorder);
    const weightPicker = document.createElement("select"); weightPicker.style.cssText = "padding: 4px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; outline: none; background: #fff;";
    [{ name: "Thin", val: "100" }, { name: "Light", val: "300" }, { name: "Normal", val: "400" }, { name: "Medium", val: "500" }, { name: "Strong", val: "600" }, { name: "Bold", val: "700" }, { name: "Black", val: "900" }].forEach(w => {
        const opt = document.createElement("option"); opt.value = w.val; opt.innerText = w.name; opt.style.fontWeight = w.val;
        if(w.val === "400") opt.selected = true; weightPicker.appendChild(opt);
    });
    weightPicker.addEventListener("change", e => {
        textNode.focus(); const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
            styleNode.style.fontWeight = e.target.value; textNode.style.fontWeight = e.target.value; 
            textNode.querySelectorAll("b, strong").forEach(b => { const span = document.createElement("span"); span.innerHTML = b.innerHTML; b.replaceWith(span); });
        } else {
            const range = sel.getRangeAt(0); const span = document.createElement("span"); span.style.fontWeight = e.target.value; span.appendChild(range.extractContents()); range.insertNode(span);
        }
    });

    const alignPicker = document.createElement("select"); 
    alignPicker.style.cssText = "padding: 4px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; outline: none; background: #fff;";
    [{ name: "⫷", val: "left", title: "Align Left" }, { name: "≡", val: "center", title: "Align Center" }, { name: "⫸", val: "right", title: "Align Right" }, { name: "▤", val: "justify", title: "Justify (Stretch)" }].forEach(a => {
        const opt = document.createElement("option"); 
        opt.value = a.val; opt.innerText = a.name; opt.title = a.title;
        if(a.val === "left") opt.selected = true; alignPicker.appendChild(opt);
    });

    alignPicker.addEventListener("change", e => {
        textNode.focus(); textNode.style.textAlign = e.target.value;
        if (e.target.value === "justify") textNode.style.textAlignLast = "justify";
        else textNode.style.textAlignLast = "auto";
    });

    const lhWrapper = document.createElement("div"); lhWrapper.style.cssText = "display: flex; align-items: center; border: 1px solid #ccc; border-radius: 4px; background: #fff; padding-left: 6px; height: 26px;";
    const lhIcon = document.createElement("span"); lhIcon.innerHTML = "↕"; lhIcon.style.cssText = "font-size: 14px; color: #555; margin-right: 2px;";
    const lhInput = document.createElement("input"); lhInput.type = "number"; lhInput.step = "0.1"; lhInput.style.cssText = "width: 45px; padding: 0; border: none; outline: none; background: transparent;";
    lhInput.addEventListener("input", e => { styleNode.style.lineHeight = e.target.value; textNode.style.lineHeight = e.target.value; });
    lhWrapper.append(lhIcon, lhInput);

    const createBtn = (text, command, styleStr) => {
        const btn = document.createElement("button"); btn.innerText = text; btn.style.cssText = `padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: #fff; ${styleStr}`;
        btn.addEventListener("mousedown", e => { 
            e.preventDefault(); textNode.focus(); const sel = window.getSelection(); let didAutoSelect = false;
            if (!sel || sel.isCollapsed) { const range = document.createRange(); range.selectNodeContents(textNode); sel.removeAllRanges(); sel.addRange(range); didAutoSelect = true; }
            document.execCommand(command, false, null); if (didAutoSelect) sel.removeAllRanges();
        });
        return btn;
    };

    row1.append(fontPicker, sizeInput, createDivider(), alignPicker, lhWrapper);
    row2.append(textColorWrapper, highlightWrapper);
    if (!isModal) { row2.append(fillWrapper, borderWrapper); }
    row2.append(createDivider(), weightPicker, createBtn("I", "italic", "font-style: italic; font-weight: bold; font-family: serif; width: 26px;"), createBtn("U", "underline", "text-decoration: underline; font-weight: bold; font-family: serif; width: 26px;"));

    toolbar.append(row1, row2);
    
    if (isModal) {
        toolbar.style.background = "transparent";
        toolbar.style.border = "none";
        toolbar.style.padding = "0";
        toolbar.style.marginBottom = "0";
    }
    
    return {
        element: toolbar,
        sync: (font, size, color, weight, lineHeight) => {
            const cleanFont = font ? font.replace(/"/g, "'") : "Roboto"; let found = false;
            for (let opt of fontPicker.options) { if (opt.value === cleanFont || opt.style.fontFamily === cleanFont) { fontPicker.value = opt.value; found = true; break; } }
            if (!found) { fontPicker.value = "Roboto"; styleNode.style.fontFamily = "Roboto"; }
            sizeInput.value = parseFloat(size) || 12; colorPicker.value = window.rgbToHex(color); weightPicker.value = weight || "400"; lhInput.value = lineHeight || "1.2";
            alignPicker.value = textNode.style.textAlign || "left";
            
            const bg = styleNode.style.backgroundColor;
            if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") fillPicker.value = window.rgbToHex(bg);
            else fillPicker.value = "#ffffff";

            // Keep border UI in sync with the overlay
            if (!isModal) {
                const bStyle = styleNode.style.borderStyle;
                const bWidth = parseInt(styleNode.style.borderWidth) || 0;
                const bColor = styleNode.style.borderColor;

                if (bStyle && bStyle !== "none" && bWidth > 0) {
                    borderWidthInput.value = bWidth;
                    if (bColor) borderPicker.value = window.rgbToHex(bColor);
                } else {
                    borderWidthInput.value = 0;
                    borderPicker.value = "#000000"; // Default reset
                }
            }
        }
    };
};

const modalEditBox = document.getElementById("editModalText");
window.modalToolbar = window.createRichTextToolbar(modalEditBox, modalEditBox);
document.getElementById("editModalToolbarContainer").appendChild(window.modalToolbar.element);