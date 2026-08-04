// ==========================================
// snippet.js: THE CUT & PASTE ENGINE
// ==========================================

window.extractCanvasSnippet = function(container, rectX, rectY, rectW, rectH, bgColor = "#ffffff", isCopyMode = false) {
    const pageCanvas = container.querySelector('.pageCanvas');
    if (!pageCanvas) return;

    const wrapper = container.closest('.pageWrapper');
    const displayW = parseFloat(wrapper.dataset.baseWidth) || parseFloat(container.style.width);
    const displayH = parseFloat(wrapper.dataset.baseHeight) || parseFloat(container.style.height);
    
    const scaleX = pageCanvas.width / displayW;
    const scaleY = pageCanvas.height / displayH;

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = rectW * scaleX;
    tempCanvas.height = rectH * scaleY;
    const ctx = tempCanvas.getContext("2d", { alpha: false });
    
    ctx.drawImage(
        pageCanvas, 
        rectX * scaleX, rectY * scaleY, rectW * scaleX, rectH * scaleY,
        0, 0, tempCanvas.width, tempCanvas.height 
    );
    
    const base64Data = tempCanvas.toDataURL("image/png");

    // --- 1. THE WHITEOUT PATCH (Only if NOT copying) ---
    let whiteout = null;
    if (!isCopyMode) {
        whiteout = document.createElement("div");
        whiteout.className = "shapeOverlay shape-rect"; 
        whiteout.style.left = rectX + "px";
        whiteout.style.top = rectY + "px";
        whiteout.style.width = rectW + "px";
        whiteout.style.height = rectH + "px";
        whiteout.style.backgroundColor = bgColor;
        whiteout.style.position = "absolute";
        whiteout.style.boxSizing = "border-box";
        whiteout.style.zIndex = "10"; 
        whiteout.style.border = "none";
        whiteout.style.margin = "0px";
        whiteout.style.padding = "0px";

        const woDrag = document.createElement("div"); woDrag.className = "textDragHandle"; woDrag.innerHTML = "⠿";
        const woResize = document.createElement("div"); woResize.className = "resizeHandle";
        const woDel = window.createDeleteHandle ? window.createDeleteHandle(whiteout) : document.createElement("div"); 
        
        whiteout.append(woDrag, woDel, woResize);
        container.appendChild(whiteout);
        if (window.makeDraggable) window.makeDraggable(whiteout, woResize, woDrag);
    }

    // --- 2. THE DRAGGABLE SNIPPET ---
    const snippet = document.createElement("div");
    snippet.className = "overlayImg"; 
    snippet.style.left = rectX + "px"; 
    snippet.style.top = rectY + "px";
    snippet.style.width = rectW + "px";
    snippet.style.height = rectH + "px";
    snippet.style.position = "absolute";
    snippet.style.zIndex = "100"; 
    snippet.style.boxSizing = "border-box";
    snippet.style.border = "none";
    snippet.style.margin = "0px";
    snippet.style.padding = "0px";

    const img = document.createElement("img");
    img.src = base64Data;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.pointerEvents = "none";
    img.style.display = "block"; 

    const snipDrag = document.createElement("div"); snipDrag.className = "textDragHandle"; snipDrag.innerHTML = "⠿";
    const snipRotate = document.createElement("div"); snipRotate.className = "rotateHandle"; snipRotate.innerHTML = "&#8635;";
    const snipResize = document.createElement("div"); snipResize.className = "resizeHandle";
    const snipDel = window.createDeleteHandle ? window.createDeleteHandle(snippet) : document.createElement("div");

    snippet.append(img, snipDrag, snipRotate, snipDel, snipResize);
    container.appendChild(snippet);
    
    if (window.makeDraggable) window.makeDraggable(snippet, snipResize, snipDrag);
    
    if (window.setActiveOverlay) {
        setTimeout(() => window.setActiveOverlay(snippet), 10);
    }

    // --- 3. Instruction tape (macro commit) ---
    if (window.GaProcessor) {
        const steps = [window.GaProcessor.build.createNode(snippet, "Snippet")];
        if (whiteout) {
            steps.unshift(window.GaProcessor.build.createNode(whiteout, "Whiteout"));
        }
        window.GaProcessor.commit(
            window.GaProcessor.build.compound(
                steps,
                isCopyMode ? "Copy Snippet" : "Cut & Paste Snippet"
            )
        );
    }
};
