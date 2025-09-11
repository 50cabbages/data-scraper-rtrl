document.addEventListener('DOMContentLoaded', () => {
    const socket = io('http://localhost:3000');

    const startButton = document.getElementById('startButton');
    const downloadFullExcelButton = document.getElementById('downloadFullExcelButton');
    const downloadNotifyreCSVButton = document.getElementById('downloadNotifyreCSVButton');
    const downloadGoogleWorkspaceCSVButton = document.getElementById('downloadGoogleWorkspaceCSVButton');
    
    // Updated category inputs
    const primaryCategorySelect = document.getElementById('primaryCategorySelect');
    const subCategoryGroup = document.getElementById('subCategoryGroup');
    const subCategorySelect = document.getElementById('subCategorySelect');
    const customCategoryGroup = document.getElementById('customCategoryGroup');
    const customCategoryInput = document.getElementById('customCategoryInput');

    const locationInput = document.getElementById('locationInput');
    const locationSuggestionsEl = document.getElementById('locationSuggestions');
    const postalCodeInput = document.getElementById('postalCodeInput');
    const postalCodeSuggestionsEl = document.getElementById('postalCodeSuggestions');
    const countryInput = document.getElementById('countryInput');
    const countrySuggestionsEl = document.getElementById('countrySuggestions');

    const countInput = document.getElementById('count');
    const progressBar = document.getElementById('progressBar');
    const logEl = document.getElementById('log');
    const resultsTableBody = document.getElementById('resultsTableBody');
    const researchStatusIcon = document.getElementById('researchStatusIcon');
    
    const filterEmailOrPhoneCheckbox = document.getElementById('filterEmailOrPhone');

    let allCollectedData = [];
    let displayedData = [];

    document.getElementById('currentYear').textContent = new Date().getFullYear();
    researchStatusIcon.classList.add('fa-hourglass-start');

    const categories = {
        "Select Category": [],
        "Other/Custom": [],
        "Butcher": [],
        "Bakery": [],
        "Café": [],
        "Restaurant": ["", "Thai restaurant", "Italian restaurant", "Japanese restaurant", "Indian restaurant", "Chinese restaurant", "Mexican restaurant", "Fast food restaurant"],
        "Hair salon": [],
        "Florist": [],
        "Fashion designer": ["", "Clothing store", "Boutique", "Men's clothing store", "Women's clothing store", "Children's clothing store"],
        "Grocer": ["", "Organic grocer", "Asian grocer", "Fruit and vegetable store"],
        "Pharmacy": [],
        "Book store": [],
        "Jewellery store": [],
        "Electronics store": []
    };

    const countries = [
        { value: "Australia", text: "Australia" },
        { value: "New Zealand", text: "New Zealand" },
        { value: "United States", text: "USA" },
        { value: "United Kingdom", text: "UK" },
        { value: "Canada", text: "Canada" },
        { value: "Germany", text: "Germany" },
        { value: "France", text: "France" },
        { value: "Spain", text: "Spain" },
        { value: "Italy", text: "Italy" },
        { value: "Japan", text: "Japan" },
        { value: "Singapore", text: "Singapore" },
        { value: "Hong Kong", text: "Hong Kong" }
    ];

    function populatePrimaryCategories() {
        primaryCategorySelect.innerHTML = '';
        const defaultCategoryOption = document.createElement('option');
        defaultCategoryOption.value = "";
        defaultCategoryOption.textContent = "Select Business Category";
        primaryCategorySelect.appendChild(defaultCategoryOption);

        for (const categoryName in categories) {
            if (categoryName !== "Select Category") {
                const option = document.createElement('option');
                option.value = categoryName;
                option.textContent = categoryName;
                primaryCategorySelect.appendChild(option);
            }
        }
        primaryCategorySelect.value = "Butcher";
        handleCategoryChange(primaryCategorySelect.value); // Trigger initial display logic for sub/custom
    }

    function populateSubCategories(selectedCategory) {
        subCategorySelect.innerHTML = '';
        const subCategories = categories[selectedCategory];

        if (subCategories && subCategories.length > 0 && selectedCategory !== "" && selectedCategory !== "Other/Custom") {
            subCategoryGroup.style.display = 'block';
            subCategories.forEach(subCat => {
                const option = document.createElement('option');
                option.value = subCat;
                option.textContent = subCat === "" ? "Select Sub-Category (Optional)" : subCat;
                subCategorySelect.appendChild(option);
            });
            if (subCategories[0] === "") {
                subCategorySelect.value = "";
            }
        } else {
            subCategoryGroup.style.display = 'none';
            subCategorySelect.value = '';
        }
    }

    // FIX: Corrected logic for custom category visibility
    function handleCategoryChange(selectedCategory) {
        if (selectedCategory === "Other/Custom") {
            subCategoryGroup.style.display = 'none';
            subCategorySelect.value = '';
            customCategoryGroup.style.display = 'block';
            customCategoryInput.focus();
        } else {
            customCategoryGroup.style.display = 'none';
            customCategoryInput.value = '';
            populateSubCategories(selectedCategory); // Populate subcategories for non-custom primary categories
        }
    }

    primaryCategorySelect.addEventListener('change', (event) => {
        handleCategoryChange(event.target.value);
    });

    // Initial population on page load
    populatePrimaryCategories();

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

    // NEW: Country Autocomplete
    let countryAutocompleteTimer;
    countryInput.addEventListener('input', () => {
        clearTimeout(countryAutocompleteTimer);
        const query = countryInput.value.toLowerCase();
        if (query.length < 1) { // Show all on empty or short query
            countrySuggestionsEl.style.display = 'none'; // Hide if input is cleared
            return;
        }
        countryAutocompleteTimer = setTimeout(() => {
            const filteredCountries = countries.filter(c => c.text.toLowerCase().includes(query));
            renderSuggestions(countryInput, countrySuggestionsEl, filteredCountries, 'text', 'value', (selectedCountry) => {
                countryInput.value = selectedCountry.text;
            });
        }, 300);
    });

    countryInput.addEventListener('focus', () => {
        // Show all countries when focused and input is empty
        if (countryInput.value.trim() === '') {
            renderSuggestions(countryInput, countrySuggestionsEl, countries, 'text', 'value', (selectedCountry) => {
                countryInput.value = selectedCountry.text;
            });
        } else {
            // Re-trigger input for existing value to show filtered list
            countryInput.dispatchEvent(new Event('input'));
        }
    });


    // Hide suggestions when clicking outside
    document.addEventListener('click', (event) => {
        if (!locationInput.contains(event.target) && !locationSuggestionsEl.contains(event.target)) {
            locationSuggestionsEl.style.display = 'none';
        }
        if (!postalCodeInput.contains(event.target) && !postalCodeSuggestionsEl.contains(event.target)) {
            postalCodeSuggestionsEl.style.display = 'none';
        }
        if (!countryInput.contains(event.target) && !countrySuggestionsEl.contains(event.target)) {
            countrySuggestionsEl.style.display = 'none';
        }
    });

    let service;
    let locationAutocompleteTimer;
    let postalCodeAutocompleteTimer;

    // initMap is now called by the Google Maps script due to `callback=initMap`
    window.initMap = () => {
        if (window.google && google.maps && google.maps.places) {
            service = new google.maps.places.AutocompleteService();
            console.log("Google Places Autocomplete Service initialized.");
            // Optionally trigger a search on initial value if present
            if (locationInput.value) locationInput.dispatchEvent(new Event('input'));
            if (postalCodeInput.value) postalCodeInput.dispatchEvent(new Event('input'));
        } else {
            console.warn("Google Maps Places API not fully loaded. Autocomplete may not function.");
        }
    };

    function fetchPlaceSuggestions(inputElement, suggestionsContainer, types, onSelectCallback) {
        const query = inputElement.value.trim();
        if (!service || query.length < 2) {
            suggestionsContainer.style.display = 'none';
            return;
        }

        service.getPlacePredictions({
            input: query,
            types: types,
            componentRestrictions: countryInput.value ? { country: countries.find(c => c.text === countryInput.value)?.value.toLowerCase() } : {}
        }, (predictions, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                const items = predictions.map(p => ({
                    description: p.description,
                    place_id: p.place_id
                }));
                renderSuggestions(inputElement, suggestionsContainer, items, 'description', 'place_id', async (selectedItem) => {
                    inputElement.value = selectedItem.description;
                    onSelectCallback(selectedItem);
                });
            } else {
                console.warn("Places API Autocomplete status:", status, query);
                suggestionsContainer.style.display = 'none';
            }
        });
    }

    async function getPlaceDetails(placeId) {
        const geocoder = new google.maps.Geocoder();
        return new Promise((resolve, reject) => {
            geocoder.geocode({ placeId: placeId }, (results, status) => {
                if (status === google.maps.GeocoderStatus.OK && results[0]) {
                    resolve(results[0]);
                } else {
                    console.error(`Geocoder failed for placeId ${placeId} with status: ${status}`);
                    reject(new Error(`Geocoder failed with status: ${status}`));
                }
            });
        });
    }

    locationInput.addEventListener('input', () => {
        clearTimeout(locationAutocompleteTimer);
        locationAutocompleteTimer = setTimeout(() => {
            fetchPlaceSuggestions(locationInput, locationSuggestionsEl, ['(cities)', 'regions', 'locality', 'sublocality'], (selectedItem) => {
                locationInput.value = selectedItem.description;
            });
        }, 300);
    });
    // Trigger on focus as well
    locationInput.addEventListener('focus', () => {
        if (locationInput.value.trim() === '') {
            // Do nothing, let user type
        } else {
            locationInput.dispatchEvent(new Event('input'));
        }
    });

    postalCodeInput.addEventListener('input', () => {
        clearTimeout(postalCodeAutocompleteTimer);
        postalCodeAutocompleteTimer = setTimeout(() => {
            fetchPlaceSuggestions(postalCodeInput, postalCodeSuggestionsEl, ['postal_code'], async (selectedItem) => {
                try {
                    const details = await getPlaceDetails(selectedItem.place_id);
                    let postalCode = '';
                    let localityName = '';
                    if (details && details.address_components) {
                        const postalCodeComp = details.address_components.find(comp => comp.types.includes('postal_code'));
                        const localityComp = details.address_components.find(comp => comp.types.includes('locality'));
                        
                        if (postalCodeComp) postalCode = postalCodeComp.long_name;
                        if (localityComp) localityName = localityComp.long_name;
                    }
                    
                    if (postalCode && localityName) {
                        postalCodeInput.value = `${postalCode} - ${localityName}`;
                    } else {
                        postalCodeInput.value = selectedItem.description;
                    }
                } catch (error) {
                    console.error("Error fetching postal code details:", error);
                    postalCodeInput.value = selectedItem.description; // Fallback
                }
            });
        }, 300);
    });
    // Trigger on focus as well
    postalCodeInput.addEventListener('focus', () => {
        if (postalCodeInput.value.trim() === '') {
            // Do nothing, let user type
        } else {
            postalCodeInput.dispatchEvent(new Event('input'));
        }
    });


    socket.on('connect', () => {
        logMessage('Connected to the real-time server!', 'success');
        researchStatusIcon.classList.remove('fa-spin', 'fa-spinner', 'fa-check-circle', 'fa-exclamation-triangle');
        researchStatusIcon.classList.add('fa-hourglass-start');
    });

    socket.on('disconnect', () => {
        logMessage('Disconnected from the real-time server.', 'error');
        setUiState(false);
        progressBar.classList.remove('pulsing');
        researchStatusIcon.classList.remove('fa-spin', 'fa-spinner', 'fa-check-circle', 'fa-hourglass-start');
        researchStatusIcon.classList.add('fa-exclamation-triangle');
    });

    socket.on('log', (message) => {
        logMessage(message, 'info');
    });

    socket.on('progress_update', ({ qualifiedFound, qualifiedTarget }) => {
        updateProgressBar(qualifiedFound, qualifiedTarget); 
    });

    socket.on('scrape_complete', (businesses) => {
        logMessage(`Scraping process finished by server. Received ${businesses.length} qualified prospects.`, 'success');
        
        allCollectedData = []; 
        resultsTableBody.innerHTML = '';
        
        businesses.forEach((business) => {
            let finalCategoryForDisplay = "";
            if (primaryCategorySelect.value === "Other/Custom") {
                finalCategoryForDisplay = customCategoryInput.value;
            } else if (subCategorySelect.value && subCategorySelect.value !== "") {
                finalCategoryForDisplay = subCategorySelect.value;
            } else {
                finalCategoryForDisplay = primaryCategorySelect.value;
            }

            const fullBusinessData = {
                OwnerName: '',
                ...business,
                Category: finalCategoryForDisplay, 
                SuburbArea: locationInput.value.split(',')[0].trim(), 
                LastVerifiedDate: new Date().toISOString().split('T')[0]
            };
            allCollectedData.push(fullBusinessData);
        });

        displayedData = allCollectedData;
        displayedData.forEach(business => addTableRow(business));
        updateProgressBar(allCollectedData.length, parseInt(countInput.value, 10)); 
        logMessage(`All ${allCollectedData.length} qualified prospects displayed below.`, 'success');
        setUiState(false);
    });

    socket.on('scrape_error', (error) => {
        logMessage(`SCRAPE ERROR: ${error.error || 'An unknown error occurred on the server.'}`, 'error');
        logMessage(`Please check server console for details and ensure all inputs are valid.`, 'error');
        setUiState(false);
        progressBar.classList.remove('pulsing');
        researchStatusIcon.classList.remove('fa-spin', 'fa-spinner', 'fa-check-circle', 'fa-hourglass-start');
        researchStatusIcon.classList.add('fa-exclamation-triangle');
        updateProgressBar(0, parseInt(countInput.value, 10)); 
    });

    startButton.addEventListener('click', startResearch);
    
    downloadFullExcelButton.addEventListener('click', () => downloadExcel(displayedData, 'rtrl_full_prospect_list', 'xlsx'));
    downloadNotifyreCSVButton.addEventListener('click', () => downloadExcel(displayedData, 'notifyre_sms_list', 'csv', ["Phone", "OwnerName", "BusinessName", "SuburbArea", "Category", "Website"]));
    downloadGoogleWorkspaceCSVButton.addEventListener('click', () => downloadExcel(displayedData, 'google_workspace_email_list', 'csv', ["Email", "OwnerName", "BusinessName", "StreetAddress", "SuburbArea", "Website", "InstagramURL", "FacebookURL", "GoogleMapsURL", "Category"]));

    async function startResearch() {
        setUiState(true);
        allCollectedData = [];
        displayedData = [];
        logEl.textContent = '';
        resultsTableBody.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        progressBar.classList.add('pulsing');
        researchStatusIcon.classList.remove('fa-hourglass-start', 'fa-check-circle', 'fa-exclamation-triangle');
        researchStatusIcon.classList.add('fa-spin', 'fa-spinner');

        const primaryCategory = primaryCategorySelect.value;
        const subCategory = subCategorySelect.value;
        const customCategory = customCategoryInput.value;
        
        let categorySearchTerm;
        if (primaryCategory === "Other/Custom") {
            categorySearchTerm = customCategory;
        } else if (subCategory && subCategory !== "") {
            categorySearchTerm = subCategory;
        } else {
            categorySearchTerm = primaryCategory;
        }

        const location = locationInput.value.split('-')[0].trim();
        const postalCode = postalCodeInput.value.split('-')[0].trim();
        const country = countryInput.value;
        const count = parseInt(countInput.value, 10);
        const allowEmailOrPhone = filterEmailOrPhoneCheckbox.checked;

        if (!categorySearchTerm || categorySearchTerm === "" || primaryCategory === "" || (!location && !postalCode) || country === "" || count < 1 || count > 50) {
            logMessage(`Input Error: Please select/enter a valid category, provide at least a Suburb/Area OR Postal Code, select a Country, and enter a number between 1-50 for 'Number of Businesses to Find'.`, 'error');
            setUiState(false);
            progressBar.classList.remove('pulsing');
            researchStatusIcon.classList.remove('fa-spin', 'fa-spinner');
            researchStatusIcon.classList.add('fa-exclamation-triangle');
            return;
        }

        logMessage(`Sending request to server to start scraping for ${count} qualified prospects...`, 'info');
        socket.emit('start_scrape', { category: categorySearchTerm, location, postalCode, country, count, allowEmailOrPhone });
    }

function cleanDisplayValue(text) {
    if (!text) return '';

    let cleaned = text.replace(/^[^a-zA-Z0-9\s.,'#\-+/&_]+/u, ''); 
    cleaned = cleaned.replace(/\p{Z}/gu, ' ');
    cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, '');
    return cleaned.replace(/\s+/g, ' ').trim();
}

    function addTableRow(data) {
        const row = document.createElement('tr');
        const truncate = (str, len) => (str && str.length > len) ? str.slice(0, len) + '...' : str || '';
        
        row.innerHTML = `
            <td>${cleanDisplayValue(data.BusinessName)}</td>
            <td>${cleanDisplayValue(data.Category)}</td>
            <td>${cleanDisplayValue(data.SuburbArea)}</td>
            <td>${cleanDisplayValue(data.StreetAddress)}</td>
            <td><a href="${data.Website || '#'}" target="_blank" title="${cleanDisplayValue(data.Website || '')}">${truncate(cleanDisplayValue(data.Website), 25)}</a></td>
            <td>${cleanDisplayValue(data.OwnerName)}</td>
            <td>${cleanDisplayValue(data.Email)}</td>
            <td>${cleanDisplayValue(data.Phone)}</td>
            <td><a href="${data.InstagramURL || '#'}" target="_blank" title="${cleanDisplayValue(data.InstagramURL || '')}">${truncate(cleanDisplayValue(data.InstagramURL), 20)}</a></td>
            <td><a href="${data.FacebookURL || '#'}" target="_blank" title="${cleanDisplayValue(data.FacebookURL || '')}">${truncate(cleanDisplayValue(data.FacebookURL), 20)}</a></td>
            <td><a href="${data.GoogleMapsURL || '#'}" target="_blank" title="${cleanDisplayValue(data.GoogleMapsURL || '')}"><i class="fas fa-map-marker-alt"></i> View</a></td>
        `;
        resultsTableBody.appendChild(row);
    }
    
    function setUiState(isBusy) {
        startButton.disabled = isBusy;
        primaryCategorySelect.disabled = isBusy;
        subCategorySelect.disabled = isBusy;
        customCategoryInput.disabled = isBusy;
        locationInput.disabled = isBusy;
        postalCodeInput.disabled = isBusy;
        countryInput.disabled = isBusy;
        countInput.disabled = isBusy;
        filterEmailOrPhoneCheckbox.disabled = isBusy;
        setDownloadButtonStates(isBusy);
    }

    function setDownloadButtonStates(isBusy) {
        const hasDisplayedData = displayedData.length > 0;
        downloadFullExcelButton.disabled = isBusy || !hasDisplayedData;
        downloadNotifyreCSVButton.disabled = isBusy || !hasDisplayedData || !displayedData.some(item => item.Phone && item.Phone.trim() !== '');
        downloadGoogleWorkspaceCSVButton.disabled = isBusy || !hasDisplayedData || !displayedData.some(item => item.Email && item.Email.trim() !== '');
    }
    
    function logMessage(message, type = 'default') {
        const timestamp = new Date().toLocaleTimeString();
        let formattedMessage = `[${timestamp}] ${message}`;
        
        const span = document.createElement('span');
        span.textContent = formattedMessage;
        span.classList.add('log-entry', `log-${type}`);

        logEl.appendChild(span);
        logEl.appendChild(document.createTextNode('\n'));

        logEl.scrollTop = logEl.scrollHeight;
    }

    function updateProgressBar(current, total) {
        let percentage = (current / total) * 100;
        if (total === 0) percentage = 0;
        if (percentage > 100) percentage = 100;

        progressBar.style.width = `${percentage}%`;
        progressBar.textContent = `${Math.round(percentage)}%`;
        
        if (percentage === 100) {
            researchStatusIcon.classList.remove('fa-spin', 'fa-spinner', 'fa-exclamation-triangle', 'fa-hourglass-start');
            researchStatusIcon.classList.add('fa-check-circle');
            logEl.scrollTop = logEl.scrollHeight;
        } else {
            researchStatusIcon.classList.remove('fa-check-circle', 'fa-exclamation-triangle', 'fa-hourglass-start');
            researchStatusIcon.classList.add('fa-spin', 'fa-spinner');
        }
    }

    function getColumnWidths(data, headers) {
        if (!data || data.length === 0 || !headers || headers.length === 0) {
            return [];
        }

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
    
    function downloadExcel(data, filenamePrefix, fileType, specificHeaders = null) {
        if (data.length === 0) {
            logMessage('No data to download for this format!', 'error');
            return;
        }

        let exportData;
        let headers;

        if (specificHeaders) {
            exportData = data.map(item => {
                const row = {};
                specificHeaders.forEach(h => {
                    if (h === "Phone") row[h] = item.Phone;
                    else if (h === "Email") row[h] = item.Email;
                    else if (h === "OwnerName") row[h] = item.OwnerName;
                    else if (h === "BusinessName") row[h] = item.BusinessName;
                    else if (h === "StreetAddress") row[h] = item.StreetAddress;
                    else if (h === "SuburbArea") row[h] = item.SuburbArea;
                    else if (h === "Website") row[h] = item.Website;
                    else if (h === "InstagramURL") row[h] = item.InstagramURL;
                    else if (h === "FacebookURL") row[h] = item.FacebookURL;
                    else if (h === "GoogleMapsURL") row[h] = item.GoogleMapsURL;
                    else if (h === "Category") row[h] = item.Category;
                });
                return row;
            });
            headers = specificHeaders;
        } else {
            exportData = data.map(item => ({
                BusinessName: item.BusinessName,
                Category: item.Category,
                'Suburb/Area': item.SuburbArea,
                StreetAddress: item.StreetAddress,
                Website: item.Website,
                OwnerName: item.OwnerName,
                Email: item.Email,
                Phone: item.Phone,
                InstagramURL: item.InstagramURL,
                FacebookURL: item.FacebookURL,
                GoogleMapsURL: item.GoogleMapsURL,
                SourceURLs: [item.GoogleMapsURL, item.Website].filter(Boolean).join(';'),
                LastVerifiedDate: item.LastVerifiedDate
            }));
            headers = [
                "BusinessName", "Category", "Suburb/Area", "StreetAddress", "Website", 
                "OwnerName", "Email", "Phone", "InstagramURL", "FacebookURL", 
                "GoogleMapsURL", "SourceURLs", "LastVerifiedDate"
            ];
        }

        const ws = XLSX.utils.json_to_sheet(exportData, { header: headers });
        ws['!cols'] = getColumnWidths(exportData, headers);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Business List");

        if (fileType === 'xlsx') {
            const headerStyle = {
                fill: { fgColor: { rgb: "FFE6F0F8" } },
                font: { bold: true, color: { rgb: "FF003366" } },
                border: {
                    top: { style: "thin", color: { rgb: "FFD1D9E6" } },
                    bottom: { style: "thin", color: { rgb: "FFD1D9E6" } },
                    left: { style: "thin", color: { rgb: "FFD1D9E6" } },
                    right: { style: "thin", color: { rgb: "FFD1D9E6" } }
                }
            };
            const rowStyleEven = { fill: { fgColor: { rgb: "FFFDFDFD" } } };
            const rowStyleOdd = { fill: { fgColor: { rgb: "FFFFFFFF" } } };

            XLSX.utils.sheet_add_aoa(ws, [headers], { origin: "A1" });
            const range = XLSX.utils.decode_range(ws['!ref']);

            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: C });
                if (!ws[cellRef]) ws[cellRef] = {};
                ws[cellRef].s = headerStyle;
            }

            for (let R = range.s.r + 1; R <= range.e.r + 1; ++R) {
                const rowStyle = (R % 2 === 0) ? rowStyleEven : rowStyleOdd;
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                    if (ws[cellRef]) {
                        if (!ws[cellRef].s) ws[cellRef].s = {};
                        Object.assign(ws[cellRef].s, rowStyle);
                    }
                }
            }
            XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.xlsx`);
            logMessage(`Excel file '${filenamePrefix}.xlsx' generated successfully with styling!`, 'success');
        } else if (fileType === 'csv') {
            XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.csv`);
            logMessage(`CSV file '${filenamePrefix}.csv' generated successfully!`, 'success');
        }
    }
});