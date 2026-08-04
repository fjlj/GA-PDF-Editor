// ==========================================
// signature.js — tight canvas around ink
// ==========================================

const sigInput = document.getElementById("sigInput"); const sigPreviews = document.getElementById("sigPreviews");
const sigFonts = ["'Great Vibes', cursive", "'Dancing Script', cursive", "'Homemade Apple', cursive", "'Caveat', cursive", "'Pacifico', cursive", "Brush Script MT", "Lucida Handwriting"];
document.getElementById("closeSigBtn").addEventListener("click", () => { APP.DOM.sigModal.style.display = "none"; });

sigInput.addEventListener("input", () => {
    sigPreviews.innerHTML = ""; const text = sigInput.value.trim(); if (!text) return;
    document.fonts.ready.then(() => {
        sigFonts.forEach(font => {
            const canvas = document.createElement("canvas"); 
            const ctx = canvas.getContext("2d");
            
            // 1. Set the font so we can accurately measure it
            ctx.font = `40px ${font}`; 
            
            // 2. measure ink bounds for tight canvas
            const metrics = ctx.measureText(text);
            const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
            const inkAscent = metrics.actualBoundingBoxAscent;
            const inkDescent = metrics.actualBoundingBoxDescent;
            const inkHeight = inkAscent + inkDescent;

            // 3. Size the canvas tightly around the ink (with a tiny 4px safe buffer)
            canvas.width = Math.max(10, inkWidth + 8); 
            canvas.height = Math.max(10, inkHeight + 8); 
            
            // 4. Re-apply the font (resizing a canvas clears its context state!)
            ctx.font = `40px ${font}`; 
            ctx.fillStyle = "#000000"; 
            
            // 5. Draw the text exactly inside our tight new bounds
            ctx.fillText(text, 4 + metrics.actualBoundingBoxLeft, 4 + inkAscent);
            
            const img = document.createElement("img"); 
            img.src = canvas.toDataURL("image/png"); 
            img.className = "sig-preview-img";
            img.title = `Click to stamp using ${font.replace(/'/g, "")}`;
            
            const descentRatio = inkDescent / canvas.height; 
            
            img.addEventListener("click", () => { 
                APP.pendingSignatureSrc = img.src; 
                APP.pendingSignatureDescent = descentRatio; // Save it to the global state!   
                APP.DOM.sigModal.style.display = "none"; 
                APP.DOM.viewer.style.cursor = "crosshair"; 
                window.clearActiveOverlay(); 
            });
            sigPreviews.appendChild(img);
        });
    });
});
