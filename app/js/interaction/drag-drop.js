// ==========================================
// drag-drop.js: NATIVE & TAURI FILE DROPS
// ==========================================


let dragCounter = 0;
const dragOverlay = document.getElementById("dragOverlay"); 
const dragOverlayText = document.getElementById("dragOverlayText");

window.addEventListener("dragenter", e => {
    e.preventDefault(); dragCounter++;
    let isImage = false;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        for (let i = 0; i < e.dataTransfer.items.length; i++) { if (e.dataTransfer.items[i].type.startsWith("image/")) { isImage = true; break; } }
    }
    if (e.dataTransfer.types.includes("Files") && !isImage) dragOverlay.style.display = "flex";
});

window.addEventListener("dragover", e => {
    e.preventDefault();
    const pageCount = (window.GaWorkspace && window.GaWorkspace.activePageCount)
        ? window.GaWorkspace.activePageCount()
        : document.querySelectorAll(".pageWrapper").length;
    if (e.target.closest("#historySidebar") && pageCount > 0) {
        dragOverlay.style.background = "rgba(40, 167, 69, 0.15)"; dragOverlay.style.borderColor = "#28a745"; dragOverlayText.innerText = "Drop to Append to Pages"; dragOverlayText.style.color = "#28a745";
    } else {
        dragOverlay.style.background = "rgba(0, 170, 255, 0.15)"; dragOverlay.style.borderColor = "#0af"; dragOverlayText.innerText = pageCount === 0 ? "Drop PDF to Open" : "Drop Files Here"; dragOverlayText.style.color = "#0af";
    }
});

window.addEventListener("dragleave", e => {
    e.preventDefault(); dragCounter--;
    if (dragCounter === 0) dragOverlay.style.display = "none";
});

window.addEventListener("drop", async e => {
    e.preventDefault(); dragCounter = 0; dragOverlay.style.display = "none";

    // Prefer FileSystemFileHandle from the drop (session restore + better OS integration)
    const items = e.dataTransfer && e.dataTransfer.items
        ? Array.from(e.dataTransfer.items)
        : [];
    const handlePairs = [];
    if (items.length && items[0].getAsFileSystemHandle) {
        for (const item of items) {
            if (item.kind !== "file") continue;
            try {
                const handle = await item.getAsFileSystemHandle();
                if (handle && handle.kind === "file" && typeof handle.getFile === "function") {
                    const file = await handle.getFile();
                    const lower = (file.name || "").toLowerCase();
                    if (file.type === "application/pdf" || lower.endsWith(".pdf") || lower.endsWith(".gapdf")) {
                        handlePairs.push({ file, handle });
                    }
                }
            } catch (_) { /* not supported / denied */ }
        }
    }

    if (handlePairs.length > 0) {
        // Sidebar drop → force append path; otherwise always ask Append vs New tab(s)
        const isSidebarDrop = !!e.target.closest("#historySidebar");
        await window.processPdfFiles(handlePairs.map((p) => p.file), isSidebarDrop, {
            handles: handlePairs.map((p) => p.handle)
        });
        return;
    }

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    const pdfFiles = files.filter(f => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".gapdf"));

    // Process PDFs via our new unified engine!
    if (pdfFiles.length > 0) {
        const isSidebarDrop = !!e.target.closest("#historySidebar");
        await window.processPdfFiles(pdfFiles, isSidebarDrop);
        return;
    }

    // Process Images
    if (imageFiles.length > 0) {
        const targetContainer = e.target.closest(".pageContainer");
        if (!targetContainer) return window.customAlert("Please drop images directly onto a specific PDF page.");
        const rect = targetContainer.getBoundingClientRect(); const reader = new FileReader();
        reader.onload = () => { const img = new Image(); img.onload = () => window.addOverlayImage(img, targetContainer, (e.clientX - rect.left) / window.currentZoom, (e.clientY - rect.top) / window.currentZoom, "Add Dropped Image"); img.src = reader.result; };
        reader.readAsDataURL(imageFiles[0]); return; 
    }
});
// Native host drag-drop path (when available)
if (window.__TAURI__) {
    const { listen } = window.__TAURI__.event;
    const { readFile } = window.__TAURI__.fs;

    const dragOverlay = document.getElementById("dragOverlay");
    const dragOverlayText = document.getElementById("dragOverlayText");

    // 1. Mouse enters the window with a file
    listen('tauri://drag-enter', (e) => {
        dragOverlay.style.display = "flex";
        
        const pageCount = (window.GaWorkspace && window.GaWorkspace.activePageCount)
            ? window.GaWorkspace.activePageCount()
            : document.querySelectorAll(".pageWrapper").length;
        if (pageCount === 0) {
            dragOverlay.style.background = "rgba(0, 170, 255, 0.15)";
            dragOverlay.style.borderColor = "#0af";
            dragOverlayText.innerText = "Drop PDF to Open";
            dragOverlayText.style.color = "#0af";
        } else {
            dragOverlay.style.background = "rgba(40, 167, 69, 0.15)";
            dragOverlay.style.borderColor = "#28a745";
            dragOverlayText.innerText = "Drop to Append to Pages";
            dragOverlayText.style.color = "#28a745";
        }
    });

    // 2. Mouse leaves the window without dropping
    listen('tauri://drag-leave', (e) => {
        dragOverlay.style.display = "none";
    });

    // 3. User drops the file!
    const handleTauriDrop = async (event) => {
        dragOverlay.style.display = "none";
        
        // Tauri passes an array of file paths in the payload
        // (Handling both Tauri v1 and v2 payload structures safely)
        const filePaths = event.payload.paths || event.payload; 
        if (!Array.isArray(filePaths)) return;

        const filesArray = [];

        for (const filePath of filePaths) {
            try {
                // Read the file bytes directly from the hard drive using Rust
                const fileBytes = await readFile(filePath);
                const fileName = filePath.split(/[/\\]/).pop();
                
                const file = new File([fileBytes], fileName, { 
                    type: fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' 
                });

                // Filter for our formats (Images dropped OS-level don't have mouse coordinates, 
                // so we restrict Tauri drops to PDFs/GAPDFs for now!)
                if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".gapdf")) {
                    filesArray.push(file);
                }
            } catch (error) {
                console.error("Failed to load dropped Tauri file:", filePath, error);
            }
        }

        // Send the reconstructed files to your processor!
        if (filesArray.length > 0) {
            window.processPdfFiles(filesArray);
        }
    };

    // Listen for both v1 and v2 event names just to be bulletproof
    listen('tauri://drag-drop', handleTauriDrop);
    listen('tauri://file-drop', handleTauriDrop);
}
