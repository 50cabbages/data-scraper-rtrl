document.addEventListener('DOMContentLoaded', () => {
    const socket = io('http://localhost:3000');
    const elements = { startButton: document.getElementById('startButton'), downloadFullExcelButton: document.getElementById('downloadFullExcelButton'), downloadNotifyreCSVButton: document.getElementById('downloadNotifyreCSVButton'), downloadGoogleWorkspaceCSVButton: document.getElementById('downloadGoogleWorkspaceCSVButton'), primaryCategorySelect: document.getElementById('primaryCategorySelect'), subCategoryGroup: document.getElementById('subCategoryGroup'), subCategorySelect: document.getElementById('subCategorySelect'), customCategoryGroup: document.getElementById('customCategoryGroup'), customCategoryInput: document.getElementById('customCategoryInput'), locationInput: document.getElementById('locationInput'), locationSuggestionsEl: document.getElementById('locationSuggestions'), postalCodeInput: document.getElementById('postalCodeInput'), postalCodeSuggestionsEl: document.getElementById('postalCodeSuggestions'), countryInput: document.getElementById('countryInput'), countrySuggestionsEl: document.getElementById('countrySuggestions'), countInput: document.getElementById('count'), findAllBusinessesCheckbox: document.getElementById('findAllBusinesses'), progressBar: document.getElementById('progressBar'), logEl: document.getElementById('log'), resultsTableBody: document.getElementById('resultsTableBody'), researchStatusIcon: document.getElementById('researchStatusIcon'), progressPercentage: document.getElementById('progressPercentage'), collectedDataCard: document.getElementById('collectedDataCard') };
    let allCollectedData = [], displayedData = [], service, geocoder, locationAutocompleteTimer, postalCodeAutocompleteTimer, countryAutocompleteTimer;
    const categories = { "Select Category": [], "Other/Custom": [], "Café": ["Café", "Coffee shop"], "Bakery": ["Bakery", "Patisserie", "Cake shop", "Donut shop"], "Restaurant": ["Restaurant", "Thai restaurant", "Italian restaurant", "Japanese restaurant", "Indian restaurant", "Chinese restaurant", "Mexican restaurant", "Vietnamese restaurant", "Sushi", "Kebab shop", "Fish and chips", "Pizza takeaway"], "Fast Food": ["Fast food restaurant", "Burger restaurant", "Fried chicken takeaway"], "Grocer": ["Supermarket", "Grocer", "Butcher", "Seafood shop", "Fruit and vegetable store", "Deli", "Health food store", "Gourmet grocery store"], "Specialty Drinks": ["Bubble tea shop", "Juice bar", "Liquor store", "Bottle shop"], "Fashion": ["Clothing store", "Women's clothing store", "Men's clothing store", "Boutique", "Lingerie store", "Swimwear store", "Surf shop"], "Footwear & Bags": ["Shoe store", "Handbag store", "Luggage store"], "Jewellery & Accessories": ["Jewellery store", "Watch shop", "Accessory store"], "Children & Babies": ["Children's clothing store", "Toy store", "Baby store"], "Department & Discount": ["Department store", "Discount store", "Variety store"], "Homewares & Gifts": ["Homewares store", "Kitchenware store", "Gift shop", "Florist", "Stationery store"], "Electronics & Entertainment": ["Electronics store", "Mobile phone store", "Phone repair shop", "Video game store", "Book store", "Newsagent"], "Sport & Fitness": ["Sporting goods store", "Sportswear store", "Bicycle shop", "Gym"], "Hobbies & Lifestyle": ["Pet store", "Craft store", "Tobacconist", "Vape shop"], "Health Services": ["Pharmacy", "Chemist", "Optometrist", "Dentist", "Medical Centre", "Audiology clinic", "Massage therapist", "Physiotherapist", "Chiropractor"], "Beauty & Hair": ["Hair salon", "Barber shop", "Nail salon", "Beauty salon", "Cosmetics store", "Perfumery", "Tanning salon"], "Financial & Professional": ["Bank", "Post Office", "Travel agent", "Real estate agent", "Accountant", "Law firm"], "Personal Services": ["Dry cleaner", "Laundry service", "Shoe repair", "Key cutting service", "Alterations service", "Tattoo shop"] };
    const countries = [ { value: "AU", text: "Australia" }, { value: "NZ", text: "New Zealand" }, { value: "US", text: "United States" }, { value: "GB", text: "United Kingdom" }, { value: "CA", text: "Canada" }, { value: "DE", text: "Germany" }, { value: "FR", text: "France" }, { value: "ES", text: "Spain" }, { value: "IT", "text": "Italy" }, { value: "JP", text: "Japan" }, { value: "SG", text: "Singapore" }, { value: "HK", text: "Hong Kong" } ];
    
    function initializeApp() { document.getElementById('currentYear').textContent = new Date().getFullYear(); if (elements.researchStatusIcon) elements.researchStatusIcon.className = 'fas fa-check-circle'; const defaultCategory = "Bakery"; populatePrimaryCategories(elements.primaryCategorySelect, categories, defaultCategory); handleCategoryChange(defaultCategory, elements.subCategoryGroup, elements.subCategorySelect, elements.customCategoryGroup, elements.customCategoryInput, categories); setupEventListeners(); }
    function findPostalCodeInResults(results) { for (const result of results) { for (const component of result.address_components) { if (component.types.includes('postal_code')) return component.long_name; } } return ''; }
    async function reverseGeocode(location) { return new Promise((resolve, reject) => { if (!geocoder) return reject(new Error("Geocoder service not initialized.")); geocoder.geocode({ location }, (results, status) => { if (status === google.maps.GeocoderStatus.OK && results) resolve(results); else reject(new Error(`Reverse geocoder failed with status: ${status}`)); }); }); }
    async function populateFieldsFromPlaceDetails(details) { const components = {}; details.address_components.forEach(component => { components[component.types[0]] = { long_name: component.long_name, short_name: component.short_name }; }); const suburbName = (components.locality || components.sublocality_level_1 || components.administrative_area_level_2 || {}).long_name || details.formatted_address.split(',')[0]; const stateName = (components.administrative_area_level_1 || {}).short_name; let postalCode = (components.postal_code || {}).long_name || ''; const countryName = (components.country || {}).long_name || ''; elements.locationInput.value = [suburbName, stateName].filter(Boolean).join(', '); elements.countryInput.value = countryName; if (!postalCode && details.geometry && details.geometry.location) { try { const reverseResults = await reverseGeocode(details.geometry.location); postalCode = findPostalCodeInResults(reverseResults); } catch (error) { console.error("Reverse geocoding fallback failed:", error); } } elements.postalCodeInput.value = postalCode; }

    function setupEventListeners() {
        elements.primaryCategorySelect.addEventListener('change', (event) => { handleCategoryChange(event.target.value, elements.subCategoryGroup, elements.subCategorySelect, elements.customCategoryGroup, elements.customCategoryInput, categories); });
        elements.findAllBusinessesCheckbox.addEventListener('change', (e) => { elements.countInput.disabled = e.target.checked; elements.countInput.value = e.target.checked ? '' : '10'; });
        elements.countryInput.addEventListener('input', () => { clearTimeout(countryAutocompleteTimer); countryAutocompleteTimer = setTimeout(() => { const query = elements.countryInput.value.toLowerCase(); if (query.length < 1) { elements.countrySuggestionsEl.style.display = 'none'; return; } const filteredCountries = countries.filter(c => c.text.toLowerCase().includes(query)); renderSuggestions(elements.countryInput, elements.countrySuggestionsEl, filteredCountries, 'text', 'value', (c) => { elements.countryInput.value = c.text; }); }, 300); });
        const handleSelection = async (item) => { try { const details = await getPlaceDetails(item.place_id); await populateFieldsFromPlaceDetails(details); } catch (error) { console.error("Could not get place details:", error); elements.locationInput.value = item.description.split(',')[0]; } };
        elements.locationInput.addEventListener('input', () => { clearTimeout(locationAutocompleteTimer); locationAutocompleteTimer = setTimeout(() => fetchPlaceSuggestions(elements.locationInput, elements.locationSuggestionsEl, ['geocode'], handleSelection), 300); });
        elements.postalCodeInput.addEventListener('input', () => { clearTimeout(postalCodeAutocompleteTimer); postalCodeAutocompleteTimer = setTimeout(() => fetchPlaceSuggestions(elements.postalCodeInput, elements.postalCodeSuggestionsEl, ['(regions)'], handleSelection), 300); });
        document.addEventListener('click', (event) => { if (!elements.locationInput.contains(event.target)) elements.locationSuggestionsEl.style.display = 'none'; if (!elements.postalCodeInput.contains(event.target)) elements.postalCodeSuggestionsEl.style.display = 'none'; if (!elements.countryInput.contains(event.target)) elements.countrySuggestionsEl.style.display = 'none'; });
        elements.startButton.addEventListener('click', startResearch);
        elements.downloadFullExcelButton.addEventListener('click', () => downloadExcel(displayedData, 'rtrl_full_prospect_list', 'xlsx', elements.logEl));
        elements.downloadNotifyreCSVButton.addEventListener('click', () => downloadExcel(displayedData.filter(d => d.Phone), 'notifyre_sms_list', 'csv', elements.logEl, ["Phone", "OwnerName", "BusinessName", "SuburbArea", "Category", "Website"]));
        elements.downloadGoogleWorkspaceCSVButton.addEventListener('click', () => downloadExcel(displayedData.filter(d => d.Email), 'google_workspace_email_list', 'csv', elements.logEl, ["Email", "OwnerName", "BusinessName", "StreetAddress", "SuburbArea", "Website", "InstagramURL", "FacebookURL", "GoogleMapsURL", "Category"]));
    }
    
    // --- FIXED: Progress Bar Update Logic ---
    function updateProgressBar(isComplete = false) {
        if (isComplete) {
            elements.progressBar.style.width = '100%';
            elements.progressPercentage.textContent = '100%';
            elements.researchStatusIcon.className = 'fas fa-check-circle';
        }
    }

    socket.on('progress_update', ({ added, target }) => {
        const isSearchAll = target === -1;
        if (!isSearchAll && target > 0) {
            let percentage = (added / target) * 100;
            if (percentage > 100) percentage = 100;
            const roundedPercentage = Math.round(percentage);
            
            elements.progressBar.style.width = `${roundedPercentage}%`;
            elements.progressPercentage.textContent = `${roundedPercentage}%`;
        }
    });

    window.rtrlApp.initializeMapServices = () => { if (window.google && google.maps && google.maps.places) { service = new google.maps.places.AutocompleteService(); geocoder = new google.maps.Geocoder(); console.log("Google Places Autocomplete Service initialized."); } else { console.warn("Google Maps Places API not fully loaded. Autocomplete may not function."); } };
    if (window.google && google.maps && google.maps.places && !service) { window.rtrlApp.initializeMapServices(); }
    function fetchPlaceSuggestions(inputEl, suggestionsEl, types, onSelect) { if (!service || inputEl.value.trim().length < 2) { suggestionsEl.style.display = 'none'; return; } const countryIsoCode = countries.find(c => c.text.toLowerCase() === elements.countryInput.value.toLowerCase())?.value; const request = { input: inputEl.value, types }; if (countryIsoCode) request.componentRestrictions = { country: countryIsoCode }; service.getPlacePredictions(request, (predictions, status) => { if (status === google.maps.places.PlacesServiceStatus.OK && predictions) { const items = predictions.map(p => ({ description: p.description, place_id: p.place_id })); renderSuggestions(inputEl, suggestionsEl, items, 'description', 'place_id', onSelect); } else { suggestionsEl.style.display = 'none'; } }); }
    async function getPlaceDetails(placeId) { return new Promise((resolve, reject) => { if (!geocoder) return reject(new Error("Geocoder service not initialized.")); geocoder.geocode({ placeId }, (results, status) => { if (status === google.maps.GeocoderStatus.OK && results[0]) resolve(results[0]); else reject(new Error(`Geocoder failed with status: ${status}`)); }); }); }
    
    socket.on('connect', () => { logMessage(elements.logEl, 'Connected to the real-time server!', 'success'); if (elements.researchStatusIcon) elements.researchStatusIcon.className = 'fas fa-check-circle'; });
    socket.on('disconnect', () => { logMessage(elements.logEl, 'Disconnected from the real-time server.', 'error'); setUiState(false, getUiElementsForStateChange()); if (elements.researchStatusIcon) elements.researchStatusIcon.className = 'fas fa-exclamation-triangle'; });
    socket.on('log', (message) => logMessage(elements.logEl, message, 'info'));
    socket.on('scrape_error', (error) => handleScrapeError(error));

    socket.on('scrape_complete', (businesses) => {
        logMessage(elements.logEl, `Scraping process finished. Received ${businesses.length} total businesses.`, 'success');
        allCollectedData = [];
        elements.resultsTableBody.innerHTML = '';
        businesses.forEach((business) => { let finalCategoryForDisplay = elements.primaryCategorySelect.value === "Other/Custom" ? elements.customCategoryInput.value : (elements.subCategorySelect.value || elements.primaryCategorySelect.value); const fullBusinessData = { OwnerName: '', ...business, Category: finalCategoryForDisplay, SuburbArea: elements.locationInput.value.split(',')[0].trim(), LastVerifiedDate: new Date().toISOString().split('T')[0] }; allCollectedData.push(fullBusinessData); });
        displayedData = allCollectedData;
        
        if (displayedData.length > 0) {
            elements.collectedDataCard.classList.add('has-results');
            displayedData.forEach(business => addTableRow(elements.resultsTableBody, business));
        }
        
        updateProgressBar(true); // Signal completion
        logMessage(elements.logEl, `Displaying all ${allCollectedData.length} businesses found.`, 'success');
        setUiState(false, getUiElementsForStateChange());
    });

    function startResearch() {
        setUiState(true, getUiElementsForStateChange());
        allCollectedData = [];
        displayedData = [];
        elements.logEl.textContent = 'Waiting to start research...';
        elements.resultsTableBody.innerHTML = '';
        elements.progressBar.style.width = '0%';
        elements.progressPercentage.textContent = '0%';
        elements.collectedDataCard.classList.remove('has-results');
        if(elements.researchStatusIcon) elements.researchStatusIcon.className = 'fas fa-spinner fa-spin';

        let categorySearchTerm = elements.primaryCategorySelect.value === "Other/Custom" ? elements.customCategoryInput.value : (elements.subCategorySelect.value || elements.primaryCategorySelect.value);
        const location = elements.locationInput.value.trim();
        const postalCode = elements.postalCodeInput.value.trim();
        const country = elements.countryInput.value;
        const countValue = parseInt(elements.countInput.value, 10);
        const find_all = elements.findAllBusinessesCheckbox.checked || !countValue || countValue <= 0;
        const count = find_all ? -1 : countValue;

        const cleanedLocation = location.replace(/\sDC$/, '').split(',')[0].trim();
        if (!categorySearchTerm || (!cleanedLocation && !postalCode) || !country) { logMessage(elements.logEl, `Input Error: Please provide a category, location/postal code, and country.`, 'error'); handleScrapeError({ error: "Invalid input" }); return; }
        const targetDisplay = count === -1 ? "all available" : count;
        logMessage(elements.logEl, `Sending request to server to find ${targetDisplay} businesses in '${cleanedLocation}'...`, 'info');
        socket.emit('start_scrape', { category: categorySearchTerm, location: cleanedLocation, postalCode, country, count });
    }

    function handleScrapeError(error) { logMessage(elements.logEl, `SCRAPE ERROR: ${error.error || 'An unknown server error occurred.'}`, 'error'); setUiState(false, getUiElementsForStateChange()); if (elements.researchStatusIcon) elements.researchStatusIcon.className = 'fas fa-exclamation-triangle'; elements.progressBar.style.width = '0%'; elements.progressPercentage.textContent = 'Error'; }
    function getUiElementsForStateChange() { return { startButton: elements.startButton, primaryCategorySelect: elements.primaryCategorySelect, subCategorySelect: elements.subCategorySelect, customCategoryInput: elements.customCategoryInput, locationInput: elements.locationInput, postalCodeInput: elements.postalCodeInput, countryInput: elements.countryInput, countInput: elements.countInput, findAllBusinessesCheckbox: elements.findAllBusinessesCheckbox, downloadButtons: { fullExcel: elements.downloadFullExcelButton, notifyre: elements.downloadNotifyreCSVButton, googleWorkspace: elements.downloadGoogleWorkspaceCSVButton }, displayedData: displayedData }; }
    
    initializeApp();
});