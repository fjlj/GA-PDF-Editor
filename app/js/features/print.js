// ==========================================
// print.js: CSS MEDIA QUERY GENERATOR
// ==========================================

window.printBtn = async function() {
    // Still rendering pages? Don't print a half-baked sandwich.
    if (window.isAppBusy && window.isAppBusy()) {
        return window.customAlert(
            "Please wait for the document to finish loading before printing.",
            "⏳ Still working"
        );
    }
    const pages = APP.DOM.viewer.querySelectorAll(".pageContainer");
    if (pages.length === 0) { window.customAlert("No pages loaded."); return; }

    const doPrint = async () => {
        const firstPage = pages[0];
        const isLandscape = firstPage.offsetWidth > firstPage.offsetHeight;
        const orientationStr = isLandscape ? "landscape" : "portrait";
        
        let dynamicPrintStyle = document.getElementById("dynamicPrintStyle");
        if (!dynamicPrintStyle) {
            dynamicPrintStyle = document.createElement("style");
            dynamicPrintStyle.id = "dynamicPrintStyle";
            document.head.appendChild(dynamicPrintStyle);
        }
        dynamicPrintStyle.innerHTML = `@media print { @page { size: ${orientationStr}; margin: 0mm !important; } }`;

        window.clearActiveOverlay();
        APP.DOM.printArea.innerHTML = "";

        const blobUrlsToRevoke = [];

        for (let i = 0; i < pages.length; i++) {
            const container = pages[i]; const canvas = container.querySelector("canvas.pageCanvas"); if (!canvas) continue;
            
            const containerW = container.offsetWidth; 
            const containerH = container.offsetHeight;

            const pageWrapper = document.createElement("div"); 
            pageWrapper.className = "print-page-wrapper";

            const printImg = new Image(); 
            const blobUrl = await new Promise(resolve => canvas.toBlob(blob => resolve(URL.createObjectURL(blob)), "image/png"));
            blobUrlsToRevoke.push(blobUrl);
            
            printImg.src = blobUrl; 
            printImg.className = "print-page-img";
            printImg.style.width = "100%"; printImg.style.display = "block";
            pageWrapper.appendChild(printImg);

            // Skip form designer chrome in print; annotations only at full opacity
            container.querySelectorAll(".overlayImg, .textOverlay, .shapeOverlay").forEach(overlay => {
                const clone = overlay.cloneNode(true);
                const controls = clone.querySelector(".textControls"); if(controls) controls.remove();
                clone.querySelectorAll(".textDragHandle, .resizeHandle, .deleteHandle, .rotateHandle").forEach(h => h.remove());
                clone.classList.remove("overlay-active");
                clone.style.opacity = "1";
                    
                const contentDiv = clone.querySelector(".textContent"); 
                if(contentDiv) {
                    contentDiv.contentEditable = "false";
                    contentDiv.style.padding = ((2 / containerW) * 100) + "cqw"; 
                }
                const leftPx = parseFloat(overlay.style.left) || 0; const topPx = parseFloat(overlay.style.top) || 0;
                clone.style.left = ((leftPx / containerW) * 100) + "%"; clone.style.top = ((topPx / containerH) * 100) + "%";

                const widthPx = parseFloat(overlay.style.width) || 0;
                if (widthPx) clone.style.width = ((widthPx / containerW) * 100) + "%";

                const heightPx = parseFloat(overlay.style.height) || 0;
                if (heightPx) clone.style.height = ((heightPx / containerH) * 100) + "%";

                if (overlay.classList.contains("textOverlay")) {
                    clone.style.fontSize = (((parseFloat(overlay.style.fontSize) || 12) / containerW) * 100) + "cqw";
                }
                
                pageWrapper.appendChild(clone);
            });
            APP.DOM.printArea.appendChild(pageWrapper);
        }
        
        setTimeout(() => { 
            window.print(); 
            setTimeout(() => { blobUrlsToRevoke.forEach(url => URL.revokeObjectURL(url)); }, 1000);
        }, 150);
    };

    if (window.withCaptureSafeAppearance) {
        await window.withCaptureSafeAppearance(doPrint);
    } else {
        await doPrint();
    }
};

