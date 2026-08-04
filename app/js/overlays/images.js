// ==========================================
// images.js: IMAGE & SIGNATURE SPAWNING
// ==========================================

window.addOverlayImage = function(img, container, dropX, dropY, actionName = "Add Image", descentRatio = 0) {
    const overlay = document.createElement("div"); overlay.className = "overlayImg overlay-active";

    // Size image in page space (respect zoom)
    // Divide max bounds by currentZoom so it always looks proportionally correct on screen!
    const safeZoom = window.currentZoom || 1;
    const MAX_WIDTH = (actionName === "Add Signature" ? 200 : 300) / (safeZoom+0.1);
    const MAX_HEIGHT = (actionName === "Add Signature" ? 200 : 300) / (safeZoom+0.1);
    
    let newW = img.naturalWidth || img.width;
    let newH = img.naturalHeight || img.height;

    if (newW > MAX_WIDTH) {
        newH = newH * (MAX_WIDTH / newW);
        newW = MAX_WIDTH;
    }
    if (newH > MAX_HEIGHT) {
        newW = newW * (MAX_HEIGHT / newH);
        newH = MAX_HEIGHT;
    }

    let finalX = dropX;
    let finalY = dropY;

    if (actionName === "Add Signature") {
        // baseline anchor for signature-style placement
        // Push the image down by exactly the scaled height of the cursive loops!
        const scaledDescent = newH * (descentRatio+0.15);
        finalY = dropY - newH + scaledDescent; 
    } 
    else if (actionName === "Add Dropped Image") {
        finalX = dropX - (newW / 2);
        finalY = dropY - (newH / 2);
    } 
    else {
        finalX = dropX;
        finalY = dropY;
    }

    overlay.style.left = finalX + "px"; 
    overlay.style.top = finalY + "px";
    overlay.style.width = newW + "px"; 
    overlay.style.height = newH + "px";
    
    const innerImg = document.createElement("img");
    innerImg.src = img.src;
    innerImg.style.width = "100%";
    innerImg.style.height = "100%";
    innerImg.style.display = "block";
    innerImg.style.pointerEvents = "none"; 

    const dragHandle = document.createElement("div"); dragHandle.className = "textDragHandle"; dragHandle.innerHTML = "⠿";
    const handle = document.createElement("div"); handle.className = "resizeHandle";
	const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
    const deleteHandle = window.createDeleteHandle(overlay);

    overlay.append(innerImg, dragHandle,rotateHandle, handle, deleteHandle); container.appendChild(overlay);
    window.setActiveOverlay(overlay); window.makeDraggable(overlay, handle, dragHandle);
    if (window.GaProcessor) {
        window.GaProcessor.commit(window.GaProcessor.build.createNode(overlay, actionName));
    }
};
