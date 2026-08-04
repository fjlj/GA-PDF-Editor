// ==========================================
// tables.js: GRID GENERATOR & CONTROLS
// ==========================================


window.renderTableGrid = function(shapeEl) {
    const rows = parseInt(shapeEl.dataset.rows) || 3;
    const cols = parseInt(shapeEl.dataset.cols) || 3;
    
    // Outer vs inner border colors
    const outerColor = shapeEl.dataset.outerColor || "#000000";
    const innerColor = shapeEl.dataset.innerColor || "#000000";
    
    const outerWidth = shapeEl.dataset.outerWidth || "2"; 
    const innerWidth = shapeEl.dataset.innerWidth || "1"; 
    const outerStyle = shapeEl.dataset.outerStyle || "solid"; 
    const innerStyle = shapeEl.dataset.innerStyle || "solid"; 
    const borderRadius = shapeEl.dataset.borderRadius || "0"; 

    Array.from(shapeEl.children).forEach(c => {
        if (c.classList.contains("table-cell")) c.remove();
    });

    let gridContainer = shapeEl.querySelector('.grid-container');
    if (!gridContainer) {
        gridContainer = document.createElement("div");
        gridContainer.className = "grid-container";
        gridContainer.style.position = "absolute";
        gridContainer.style.top = "0";
        gridContainer.style.left = "0";
        gridContainer.style.width = "100%";
        gridContainer.style.height = "100%";
        gridContainer.style.boxSizing = "border-box";
        shapeEl.insertBefore(gridContainer, shapeEl.firstChild);
    }

    shapeEl.style.border = "none"; 
    shapeEl.style.display = "block";
    shapeEl.style.overflow = "visible"; 
    
    // outer stroke on the container
    gridContainer.style.border = outerStyle !== "hidden" ? `${outerWidth}px ${outerStyle} ${outerColor}` : "none";
    gridContainer.style.borderRadius = `${borderRadius}px`;
    gridContainer.style.overflow = "hidden"; 
    
    gridContainer.style.display = "grid";
    gridContainer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridContainer.innerHTML = ""; 

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement("div");
            cell.className = "table-cell";
            cell.style.boxSizing = "border-box";
            
            if (innerStyle !== "hidden") {
                // inner grid stroke
                if (c < cols - 1) cell.style.borderRight = `${innerWidth}px ${innerStyle} ${innerColor}`;
                if (r < rows - 1) cell.style.borderBottom = `${innerWidth}px ${innerStyle} ${innerColor}`;
            }
            gridContainer.appendChild(cell);
        }
    }
};

window.buildTableControls = function(shapeEl) {
    const controls = document.createElement("div");
    controls.className = "textControls";
    controls.style.flexDirection = "column"; controls.style.alignItems = "flex-start"; controls.style.gap = "6px";
    controls.addEventListener("mousedown", e => e.stopPropagation());

    const createInput = (type, val, title, width) => {
        const input = document.createElement("input");
        input.type = type; input.value = val; input.title = title;
        if(width) input.style.width = width;
        
        // Make color pickers look like clean little squares
        if(type === "color") { 
            input.style.padding = "0"; input.style.border = "none"; 
            input.style.background = "transparent"; input.style.cursor = "pointer"; 
            input.style.width = "22px"; input.style.height = "22px"; 
        }
        return input;
    };

    const rowInput = createInput("number", shapeEl.dataset.rows, "Rows", "35px"); rowInput.min = "1";
    const colInput = createInput("number", shapeEl.dataset.cols, "Columns", "35px"); colInput.min = "1";

    // color pickers
    const outerColorInput = createInput("color", shapeEl.dataset.outerColor || "#000000", "Box Border Color");
    const innerColorInput = createInput("color", shapeEl.dataset.innerColor || "#000000", "Grid Line Color");

    const outerWidthInput = createInput("number", shapeEl.dataset.outerWidth, "Box Thickness", "35px"); outerWidthInput.min = "0";
    const innerWidthInput = createInput("number", shapeEl.dataset.innerWidth, "Grid Thickness", "35px"); innerWidthInput.min = "0";
    const radiusInput = createInput("number", shapeEl.dataset.borderRadius, "Corner Radius", "35px"); radiusInput.min = "0";

    const createStyleDropdown = (title, currentVal) => {
        const sel = document.createElement("select"); sel.title = title;
        sel.style.cssText = "padding: 2px; border-radius: 4px; border: 1px solid #ccc; outline: none; font-size: 12px; margin: 0 4px;";
        ["solid", "dashed", "dotted", "double","groove","ridge","inset","outset"].forEach(opt => {
            const el = document.createElement("option"); el.value = opt; el.innerText = opt.charAt(0).toUpperCase() + opt.slice(1);
            if ((currentVal || "solid") === opt) el.selected = true; sel.appendChild(el);
        });
        return sel;
    };

    const outerStyleSelect = createStyleDropdown("Box Style", shapeEl.dataset.outerStyle);
    const innerStyleSelect = createStyleDropdown("Grid Style", shapeEl.dataset.innerStyle);

    const row1 = document.createElement("div");
    row1.style.cssText = "display: flex; align-items: center; gap: 6px; width: 100%;";
    row1.append(document.createTextNode("R:"), rowInput, document.createTextNode("C:"), colInput);

    const row2 = document.createElement("div");
    row2.style.cssText = "display: flex; align-items: center; width: 100%;";

    const outerWrap = document.createElement("div"); 
    outerWrap.style.cssText = "display: flex; align-items: center; gap: 4px;";
    outerWrap.innerHTML = "<b>Box:</b>"; 
    // outer color picker
    outerWrap.append(outerStyleSelect, outerWidthInput, outerColorInput, document.createTextNode("Rad:"), radiusInput);

    const innerWrap = document.createElement("div"); 
    innerWrap.style.cssText = "display: flex; align-items: center; gap: 4px; margin-left: 6px; padding-left: 6px; border-left: 1px solid #ccc;";
    innerWrap.innerHTML = "<b>Grid:</b>"; 
    // inner color picker
    innerWrap.append(innerStyleSelect, innerWidthInput, innerColorInput);
    
    row2.append(outerWrap, innerWrap);
    controls.append(row1, row2);

    const updateTable = () => {
        shapeEl.dataset.rows = rowInput.value;
        shapeEl.dataset.cols = colInput.value;
        shapeEl.dataset.outerColor = outerColorInput.value; // Save
        shapeEl.dataset.innerColor = innerColorInput.value; // Save
        shapeEl.dataset.outerWidth = outerWidthInput.value;
        shapeEl.dataset.innerWidth = innerWidthInput.value;
        shapeEl.dataset.borderRadius = radiusInput.value; 
        shapeEl.dataset.outerStyle = outerStyleSelect.value;
        shapeEl.dataset.innerStyle = innerStyleSelect.value;
        window.renderTableGrid(shapeEl);
    };

    [rowInput, colInput, outerColorInput, innerColorInput, outerWidthInput, innerWidthInput, radiusInput].forEach(el => el.addEventListener("input", updateTable));
    [outerStyleSelect, innerStyleSelect].forEach(el => el.addEventListener("change", updateTable));

    const dragHandle = document.createElement("div"); dragHandle.className = "textDragHandle"; dragHandle.innerHTML = "⠿";
	const rotateHandle = document.createElement("div"); rotateHandle.className = "rotateHandle"; rotateHandle.innerHTML = "&#8635;"; rotateHandle.style.cursor = "grab";
    const deleteHandle = window.createDeleteHandle(shapeEl);
    
    let startDataset = "";
    controls.addEventListener("mousedown", () => startDataset = JSON.stringify(shapeEl.dataset));
    controls.addEventListener("change", () => {
        const endDataset = JSON.stringify(shapeEl.dataset);
        if (startDataset !== endDataset) {
            const before = JSON.parse(startDataset); const after = JSON.parse(endDataset);
            if (window.GaProcessor) {
                window.GaProcessor.commit(
                    window.GaProcessor.build.dataset(shapeEl, before, after, "Edit Table Specs", "replace")
                );
            }
        }
    });

    shapeEl.append(controls, dragHandle, rotateHandle, deleteHandle);
};
