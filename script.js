document.addEventListener('DOMContentLoaded', () => {
    // --- Socket Initialization ---
    const socket = io('http://localhost:3000');

    // --- DOM Element References ---
    const elements = {
        startButton: document.getElementById('startButton'),
        downloadFullExcelButton: document.getElementById('downloadFullExcelButton'),
        downloadNotifyreCSVButton: document.getElementById('downloadNotifyreCSVButton'),
        downloadGoogleWorkspaceCSVButton: document.getElementById('downloadGoogleWorkspaceCSVButton'),
        primaryCategorySelect: document.getElementById('primaryCategorySelect'),
        subCategoryGroup: document.getElementById('subCategoryGroup'),
        subCategorySelect: document.getElementById('subCategorySelect'),
        customCategoryGroup: document.getElementById('customCategoryGroup'),
        customCategoryInput: document.getElementById('customCategoryInput'),
        locationInput: document.getElementById('locationInput'),
        locationSuggestionsEl: document.getElementById('locationSuggestions'),
        postalCodeInput: document.getElementById('postalCodeInput'),
        postalCodeSuggestionsEl: document.getElementById('postalCodeSuggestions'),
        countryInput: document.getElementById('countryInput'),
        countrySuggestionsEl: document.getElementById('countrySuggestions'),
        countInput: document.getElementById('count'),
        findAllBusinessesCheckbox: document.getElementById('findAllBusinesses'),
        progressBar: document.getElementById('progressBar'),
        logEl: document.getElementById('log'),
        resultsTableBody: document.getElementById('resultsTableBody'),
        researchStatusIcon: document.getElementById('researchStatusIcon'),
    };

    // --- Application State ---
    let allCollectedData = [];
    let displayedData = [];
    let service, geocoder; // Google Maps services
    let locationAutocompleteTimer, postalCodeAutocompleteTimer, countryAutocompleteTimer;

    // --- Data Definitions ---
    const categories = {
        "Select Category": [], "Other/Custom": [], "Butcher": [], "Bakery": [], "Café": [],
        "Restaurant": ["", "Thai restaurant", "Italian restaurant", "Japanese restaurant", "Indian restaurant", "Chinese restaurant", "Mexican restaurant", "Fast food restaurant"],
        "Hair salon": [], "Florist": [], "Fashion designer": ["", "Clothing store", "Boutique", "Men's clothing store", "Women's clothing store", "Children's clothing store"],
        "Grocer": ["", "Organic grocer", "Asian grocer", "Fruit and vegetable store"],
        "Pharmacy": [], "Book store": [], "Jewellery store": [], "Electronics store": []
    };
    const countries = [
        { value: "AU", text: "Australia" }, { value: "NZ", text: "New Zealand" }, { value: "US", text: "United States" },
        { value: "GB", text: "United Kingdom" }, { value: "CA", text: "Canada" }, { value: "DE", text: "Germany" },
        { value: "FR", text: "France" }, { value: "ES", text: "Spain" }, { value: "IT", text: "Italy" },
        { value: "JP", text: "Japan" }, { value: "SG", text: "Singapore" }, { value: "HK", text: "Hong Kong" }
    ];

    // --- Initial Setup ---
    function initializeApp() {
        document.getElementById('currentYear').textContent = new Date().getFullYear();
        elements.researchStatusIcon.className = 'fas fa-hourglass-start';

        populatePrimaryCategories(elements.primaryCategorySelect, categories, "Butcher");
        handleCategoryChange("Butcher", elements.subCategoryGroup, elements.subCategorySelect, elements.customCategoryGroup, elements.customCategoryInput, categories);

        setupEventListeners();
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        elements.primaryCategorySelect.addEventListener('change', (event) => {
            handleCategoryChange(event.target.value, elements.subCategoryGroup, elements.subCategorySelect, elements.customCategoryGroup, elements.customCategoryInput, categories);
        });

        elements.findAllBusinessesCheckbox.addEventListener('change', (e) => {
            elements.countInput.disabled = e.target.checked;
            if (e.target.checked) {
                elements.countInput.value = '';
            }
        });
        
        // Autocomplete Listeners
        elements.countryInput.addEventListener('input', () => {
            clearTimeout(countryAutocompleteTimer);
            countryAutocompleteTimer = setTimeout(() => {
                const query = elements.countryInput.value.toLowerCase();
                if (query.length < 1) { elements.countrySuggestionsEl.style.display = 'none'; return; }
                const filteredCountries = countries.filter(c => c.text.toLowerCase().includes(query));
                renderSuggestions(elements.countryInput, elements.countrySuggestionsEl, filteredCountries, 'text', 'value', (c) => { elements.countryInput.value = c.text; });
            }, 300);
        });
        
        elements.locationInput.addEventListener('input', () => {
            clearTimeout(locationAutocompleteTimer);
            locationAutocompleteTimer = setTimeout(() => fetchPlaceSuggestions(elements.locationInput, elements.locationSuggestionsEl, ['geocode'], item => { elements.locationInput.value = item.description; }), 300);
        });

        elements.postalCodeInput.addEventListener('input', () => {
            clearTimeout(postalCodeAutocompleteTimer);
            postalCodeAutocompleteTimer = setTimeout(() => fetchPlaceSuggestions(elements.postalCodeInput, elements.postalCodeSuggestionsEl, ['postal_code'], async (item) => {
                try {
                    const details = await getPlaceDetails(item.place_id);
                    const postCodeComp = details.address_components.find(c => c.types.includes('postal_code'));
                    const localityComp = details.address_components.find(c => c.types.includes('locality')) || details.address_components.find(c => c.types.includes('sublocality_level_1'));
                    const postCode = postCodeComp ? postCodeComp.long_name : '';
                    const locality = localityComp ? localityComp.long_name : '';
                    elements.postalCodeInput.value = (postCode && locality) ? `${postCode} - ${locality}` : postCode || item.description;
                } catch (error) {
                    elements.postalCodeInput.value = item.description;
                }
            }), 300);
        });
        
        // Hide suggestions on click outside
        document.addEventListener('click', (event) => {
            if (!elements.locationInput.contains(event.target)) elements.locationSuggestionsEl.style.display = 'none';
            if (!elements.postalCodeInput.contains(event.target)) elements.postalCodeSuggestionsEl.style.display = 'none';
            if (!elements.countryInput.contains(event.target)) elements.countrySuggestionsEl.style.display = 'none';
        });

        // Action Buttons
        elements.startButton.addEventListener('click', startResearch);
        elements.downloadFullExcelButton.addEventListener('click', () => downloadExcel(displayedData, 'rtrl_full_prospect_list', 'xlsx', elements.logEl));
        elements.downloadNotifyreCSVButton.addEventListener('click', () => downloadExcel(displayedData.filter(d => d.Phone), 'notifyre_sms_list', 'csv', elements.logEl, ["Phone", "OwnerName", "BusinessName", "SuburbArea", "Category", "Website"]));
        elements.downloadGoogleWorkspaceCSVButton.addEventListener('click', () => downloadExcel(displayedData.filter(d => d.Email), 'google_workspace_email_list', 'csv', elements.logEl, ["Email", "OwnerName", "BusinessName", "StreetAddress", "SuburbArea", "Website", "InstagramURL", "FacebookURL", "GoogleMapsURL", "Category"]));
    }

    // --- Google Maps API ---
    window.rtrlApp.initializeMapServices = () => {
        if (window.google && google.maps && google.maps.places) {
            service = new google.maps.places.AutocompleteService();
            geocoder = new google.maps.Geocoder();
            console.log("Google Places Autocomplete Service initialized.");
        } else {
            console.warn("Google Maps Places API not fully loaded. Autocomplete may not function.");
        }
    };
    if (window.google && google.maps && google.maps.places && !service) {
        window.rtrlApp.initializeMapServices();
    }

    function fetchPlaceSuggestions(inputEl, suggestionsEl, types, onSelect) {
        if (!service || inputEl.value.trim().length < 2) { suggestionsEl.style.display = 'none'; return; }
        const countryIsoCode = countries.find(c => c.text === elements.countryInput.value)?.value;
        service.getPlacePredictions({ input: inputEl.value, types, componentRestrictions: { country: countryIsoCode } }, (predictions, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
                const items = predictions.map(p => ({ description: p.description, place_id: p.place_id }));
                renderSuggestions(inputEl, suggestionsEl, items, 'description', 'place_id', onSelect);
            } else {
                suggestionsEl.style.display = 'none';
            }
        });
    }

    async function getPlaceDetails(placeId) {
        return new Promise((resolve, reject) => {
            if (!geocoder) return reject(new Error("Geocoder service not initialized."));
            geocoder.geocode({ placeId }, (results, status) => {
                if (status === google.maps.GeocoderStatus.OK && results[0]) resolve(results[0]);
                else reject(new Error(`Geocoder failed with status: ${status}`));
            });
        });
    }

    // --- Socket Event Handlers ---
    socket.on('connect', () => {
        logMessage(elements.logEl, 'Connected to the real-time server!', 'success');
        elements.researchStatusIcon.className = 'fas fa-hourglass-start';
    });

    socket.on('disconnect', () => {
        logMessage(elements.logEl, 'Disconnected from the real-time server.', 'error');
        const uiElementsToManage = getUiElementsForStateChange();
        setUiState(false, uiElementsToManage);
        elements.progressBar.classList.remove('pulsing');
        elements.researchStatusIcon.className = 'fas fa-exclamation-triangle';
    });

    socket.on('log', (message) => logMessage(elements.logEl, message, 'info'));
    
    // --- UPDATED SOCKET HANDLER ---
    socket.on('progress_update', ({ processed, discovered, added, target }) => {
        updateProgressBar(elements.progressBar, elements.researchStatusIcon, processed, discovered, added, target);
    });
    
    socket.on('scrape_error', (error) => handleScrapeError(error));

    socket.on('scrape_complete', (businesses) => {
        logMessage(elements.logEl, `Scraping process finished. Received ${businesses.length} total businesses.`, 'success');
        
        allCollectedData = [];
        elements.resultsTableBody.innerHTML = '';
        
        const countValue = parseInt(elements.countInput.value, 10);
        const find_all = elements.findAllBusinessesCheckbox.checked || !countValue || countValue <= 0;
        const targetCount = find_all ? businesses.length : countValue;

        businesses.forEach((business) => {
            let finalCategoryForDisplay = elements.primaryCategorySelect.value === "Other/Custom" ? elements.customCategoryInput.value : (elements.subCategorySelect.value || elements.primaryCategorySelect.value);
            const fullBusinessData = {
                OwnerName: '', ...business, Category: finalCategoryForDisplay,
                SuburbArea: elements.locationInput.value.includes('-') ? elements.locationInput.value.split('-')[1].trim() : elements.locationInput.value.trim(),
                LastVerifiedDate: new Date().toISOString().split('T')[0]
            };
            allCollectedData.push(fullBusinessData);
        });

        displayedData = allCollectedData;
        displayedData.forEach(business => addTableRow(elements.resultsTableBody, business));
        
        // Final progress bar update to 100%
        updateProgressBar(elements.progressBar, elements.researchStatusIcon, targetCount, targetCount, businesses.length, find_all ? -1 : targetCount);

        logMessage(elements.logEl, `Displaying all ${allCollectedData.length} businesses found.`, 'success');
        const uiElementsToManage = getUiElementsForStateChange();
        setUiState(false, uiElementsToManage);
    });

    // --- Main Application Logic ---
    function startResearch() {
        const uiElementsToManage = getUiElementsForStateChange();
        setUiState(true, uiElementsToManage);

        allCollectedData = [];
        displayedData = [];
        elements.logEl.textContent = '';
        elements.resultsTableBody.innerHTML = '';
        elements.progressBar.style.width = '0%';
        elements.progressBar.textContent = '0%';
        elements.progressBar.classList.add('pulsing');
        elements.researchStatusIcon.className = 'fas fa-spinner fa-spin';

        let categorySearchTerm = elements.primaryCategorySelect.value === "Other/Custom" ? elements.customCategoryInput.value : (elements.subCategorySelect.value || elements.primaryCategorySelect.value);
        const location = elements.locationInput.value.trim();
        const postalCode = elements.postalCodeInput.value.trim();
        const country = elements.countryInput.value;
        
        const countValue = parseInt(elements.countInput.value, 10);
        const find_all = elements.findAllBusinessesCheckbox.checked || !countValue || countValue <= 0;
        const count = find_all ? -1 : countValue;

        if (!categorySearchTerm || (!location && !postalCode) || !country) {
            logMessage(elements.logEl, `Input Error: Please provide a category, location/postal code, and country.`, 'error');
            handleScrapeError({ error: "Invalid input" });
            return;
        }

        const targetDisplay = count === -1 ? "all available" : count;
        logMessage(elements.logEl, `Sending request to server to find ${targetDisplay} businesses...`, 'info');
        socket.emit('start_scrape', { category: categorySearchTerm, location, postalCode, country, count });
    }

    function handleScrapeError(error) {
        logMessage(elements.logEl, `SCRAPE ERROR: ${error.error || 'An unknown server error occurred.'}`, 'error');
        const uiElementsToManage = getUiElementsForStateChange();
        setUiState(false, uiElementsToManage);
        elements.progressBar.classList.remove('pulsing');
        elements.researchStatusIcon.className = 'fas fa-exclamation-triangle';
        const target = elements.findAllBusinessesCheckbox.checked ? 0 : parseInt(elements.countInput.value, 10);
        updateProgressBar(elements.progressBar, elements.researchStatusIcon, 0, 0, 0, target);
    }

    function getUiElementsForStateChange() {
        return {
            startButton: elements.startButton,
            primaryCategorySelect: elements.primaryCategorySelect,
            subCategorySelect: elements.subCategorySelect,
            customCategoryInput: elements.customCategoryInput,
            locationInput: elements.locationInput,
            postalCodeInput: elements.postalCodeInput,
            countryInput: elements.countryInput,
            countInput: elements.countInput,
            findAllBusinessesCheckbox: elements.findAllBusinessesCheckbox,
            downloadButtons: {
                fullExcel: elements.downloadFullExcelButton,
                notifyre: elements.downloadNotifyreCSVButton,
                googleWorkspace: elements.downloadGoogleWorkspaceCSVButton
            },
            displayedData: displayedData
        };
    }
    
    // --- Run Initialization ---
    initializeApp();
});