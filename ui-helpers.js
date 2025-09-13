// ui-helpers.js

/**
 * Populates the primary business category dropdown.
 */
function populatePrimaryCategories(selectEl, categoriesData, defaultCategory) {
    selectEl.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.textContent = "Select Business Category";
    selectEl.appendChild(defaultOption);

    for (const categoryName in categoriesData) {
        if (categoryName !== "Select Category") {
            const option = document.createElement('option');
            option.value = categoryName;
            option.textContent = categoryName;
            selectEl.appendChild(option);
        }
    }
    selectEl.value = defaultCategory;
}

/**
 * Populates the sub-category dropdown based on the primary selection.
 */
function populateSubCategories(selectEl, groupEl, selectedCategory, categoriesData) {
    selectEl.innerHTML = '';
    const subCategories = categoriesData[selectedCategory];

    if (subCategories && subCategories.length > 0 && selectedCategory && selectedCategory !== "Other/Custom") {
        groupEl.style.display = 'block';
        subCategories.forEach(subCat => {
            const option = document.createElement('option');
            option.value = subCat;
            option.textContent = subCat === "" ? "Select Sub-Category (Optional)" : subCat;
            selectEl.appendChild(option);
        });
        if (subCategories[0] === "") {
            selectEl.value = "";
        }
    } else {
        groupEl.style.display = 'none';
        selectEl.value = '';
    }
}

/**
 * Handles visibility of sub-category and custom category inputs.
 */
function handleCategoryChange(selectedCategory, subCatGroup, subCatSelect, customCatGroup, customCatInput, categoriesData) {
    if (selectedCategory === "Other/Custom") {
        subCatGroup.style.display = 'none';
        subCatSelect.value = '';
        customCatGroup.style.display = 'block';
        customCatInput.focus();
    } else {
        customCatGroup.style.display = 'none';
        customCatInput.value = '';
        populateSubCategories(subCatSelect, subCatGroup, selectedCategory, categoriesData);
    }
}

/**
 * Renders autocomplete suggestions for an input field.
 */
function renderSuggestions(inputElement, suggestionsContainer, items, displayKey, valueKey, onSelectCallback) {
    suggestionsContainer.innerHTML = '';
    if (items.length === 0 || inputElement.value.trim() === '') {
        suggestionsContainer.style.display = 'none';
        return;
    }

    const ul = document.createElement('ul');
    items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item[displayKey];
        li.dataset.value = item[valueKey];
        li.dataset.original = JSON.stringify(item);
        li.addEventListener('click', () => {
            onSelectCallback(item);
            suggestionsContainer.style.display = 'none';
        });
        ul.appendChild(li);
    });
    suggestionsContainer.appendChild(ul);
    suggestionsContainer.style.display = 'block';
}


/**
 * Sanitizes text for safe display in the UI, removing control characters.
 */
function cleanDisplayValue(text) {
    if (!text) return '';
    let cleaned = String(text).replace(/^[^a-zA-Z0-9\s.,'#\-+/&_]+/u, ''); 
    cleaned = cleaned.replace(/\p{Z}/gu, ' ');
    cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, '');
    return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Adds a new row to the results table.
 */
function addTableRow(gridBody, data, index) {
    const row = document.createElement('div');
    row.className = 'grid-row';

    const createCell = (content = '', title = '') => {
        const cell = document.createElement('span');
        if (typeof content === 'object') {
            cell.appendChild(content);
        } else {
            cell.textContent = content;
        }
        if (title) {
            cell.title = title;
        }
        return cell;
    };

    const createLinkCell = (url, text, len) => {
        const cell = document.createElement('span');
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.textContent = (text && text.length > len) ? text.slice(0, len) + '...' : text;
            link.title = url;
            cell.appendChild(link);
        }
        return cell;
    };

    // Checkbox Cell
    const checkboxContainer = document.createElement('span');
    checkboxContainer.className = 'checkbox-column';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'row-checkbox';
    checkbox.dataset.index = index;
    checkbox.checked = true;
    checkboxContainer.appendChild(checkbox);
    
    // Maps Icon Cell
    const mapsLink = document.createElement('a');
    mapsLink.href = data.GoogleMapsURL || '#';
    mapsLink.target = '_blank';
    mapsLink.title = data.GoogleMapsURL || '';
    mapsLink.innerHTML = `<i class="fas fa-map-marker-alt"></i> View`;

    const cells = [
        checkboxContainer,
        createCell(cleanDisplayValue(data.BusinessName), cleanDisplayValue(data.BusinessName)),
        createCell(cleanDisplayValue(data.Category), cleanDisplayValue(data.Category)),
        createCell(cleanDisplayValue(data.SuburbArea), cleanDisplayValue(data.SuburbArea)),
        createCell(cleanDisplayValue(data.StreetAddress), cleanDisplayValue(data.StreetAddress)),
        createLinkCell(data.Website, cleanDisplayValue(data.Website), 25),
        createCell(cleanDisplayValue(data.OwnerName), cleanDisplayValue(data.OwnerName)),
        createCell(cleanDisplayValue(data.Email), cleanDisplayValue(data.Email)),
        createCell(cleanDisplayValue(data.Phone), cleanDisplayValue(data.Phone)),
        createLinkCell(data.InstagramURL, cleanDisplayValue(data.InstagramURL), 20),
        createLinkCell(data.FacebookURL, cleanDisplayValue(data.FacebookURL), 20),
        createCell(mapsLink)
    ];
    
    cells.forEach(cell => row.appendChild(cell));
    gridBody.appendChild(row);
}

/**
 * Enables or disables UI controls based on application state.
 */
function setUiState(isBusy, elements) {
    const isIndividualSearch = elements.businessNameInput.value.trim().length > 0;
    
    for (const key in elements) {
        if (elements.hasOwnProperty(key) && key !== 'downloadButtons' && key !== 'displayedData' && key !== 'bulkSearchContainer') {
            elements[key].disabled = isBusy;
        }
    }
    
    if (!isBusy) {
        elements.countInput.disabled = elements.findAllBusinessesCheckbox.checked || isIndividualSearch;
        document.getElementById('bulkSearchContainer').querySelectorAll('input, select').forEach(el => {
            if (el.id !== 'countryInput' && el.id !== 'locationInput' && el.id !== 'postalCodeInput') {
                 el.disabled = isIndividualSearch;
            }
        });
    }

    setDownloadButtonStates(isBusy, elements.downloadButtons, elements.displayedData);
}


/**
 * Manages the enabled/disabled state of the download buttons.
 */
function setDownloadButtonStates(isBusy, buttons, displayedData) {
    const hasData = displayedData.length > 0;
    buttons.fullExcel.disabled = isBusy || !hasData;
    buttons.notifyre.disabled = isBusy || !hasData || !displayedData.some(item => item.Phone && item.Phone.trim() !== '');
    buttons.googleWorkspace.disabled = isBusy || !hasData || !displayedData.some(item => item.Email && item.Email.trim() !== '');
}

/**
 * Logs a message to the on-screen console.
 */
function logMessage(logEl, message, type = 'default') {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    
    const span = document.createElement('span');
    span.textContent = formattedMessage;
    span.classList.add('log-entry', `log-${type}`);

    logEl.appendChild(span);
    logEl.appendChild(document.createTextNode('\n'));
    logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Updates the progress bar and status icon based on the new, clearer logic.
 */
function updateProgressBar(progressBarEl, statusIconEl, processed, discovered, added, target) {
    let percentage = 0;
    let isSearchAll = target === -1;

    if (isSearchAll) {
        if (discovered > 0) {
            percentage = (processed / discovered) * 100;
        }
    } else {
        if (target > 0) {
            percentage = (added / target) * 100;
        }
    }
    
    if (percentage > 100) percentage = 100;

    progressBarEl.style.width = `${percentage}%`;
    progressBarEl.textContent = `${Math.round(percentage)}%`;
    
    const isComplete = !isSearchAll ? (added >= target) : (processed === discovered && discovered > 0);

    if (isComplete) {
        statusIconEl.className = 'fas fa-check-circle';
    } else {
        statusIconEl.className = 'fas fa-spinner fa-spin';
    }
}

/**
 * Calculates appropriate column widths for the Excel export.
 */
function getColumnWidths(data, headers) {
    if (!data || data.length === 0 || !headers || headers.length === 0) return [];
    const widths = headers.map(header => ({ wch: String(header).length + 2 }));

    data.forEach(item => {
        headers.forEach((header, colIndex) => {
            const cellValue = String(item[header] || '');
            const effectiveLength = (header.includes('URL') && cellValue.length > 50) ? 50 : cellValue.length;
            if (effectiveLength + 2 > widths[colIndex].wch) {
                widths[colIndex].wch = effectiveLength + 2;
            }
        });
    });
    return widths.map(w => ({ wch: Math.max(w.wch, 10) }));
}

/**
 * Generates and triggers the download of an Excel or CSV file.
 */
function downloadExcel(data, filenamePrefix, fileType, logEl, specificHeaders = null) {
    if (data.length === 0) {
        logMessage(logEl, 'No data to download for this format!', 'error');
        return;
    }

    let exportData;
    let headers;

    if (specificHeaders) {
        exportData = data.map(item => {
            const row = {};
            specificHeaders.forEach(h => { row[h] = item[h] || ''; });
            return row;
        });
        headers = specificHeaders;
    } else {
        exportData = data.map(item => ({
            BusinessName: item.BusinessName, Category: item.Category, 'Suburb/Area': item.SuburbArea,
            StreetAddress: item.StreetAddress, Website: item.Website, OwnerName: item.OwnerName,
            Email: item.Email, Phone: item.Phone, InstagramURL: item.InstagramURL,
            FacebookURL: item.FacebookURL, GoogleMapsURL: item.GoogleMapsURL,
            SourceURLs: [item.GoogleMapsURL, item.Website].filter(Boolean).join(';'),
            LastVerifiedDate: item.LastVerifiedDate
        }));
        headers = Object.keys(exportData[0] || {});
    }

    const ws = XLSX.utils.json_to_sheet(exportData, { header: headers });
    ws['!cols'] = getColumnWidths(exportData, headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Business List");

    const fileExtension = fileType === 'xlsx' ? 'xlsx' : 'csv';
    const fullFilename = `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.${fileExtension}`;

    XLSX.writeFile(wb, fullFilename);
    logMessage(logEl, `${data.length} records exported to '${fullFilename}' successfully!`, 'success');
}