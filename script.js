// script.js (Real-time with Socket.IO Client - with enhanced filtering and progress)
document.addEventListener('DOMContentLoaded', () => {
    const socket = io('http://localhost:3000');

    const startButton = document.getElementById('startButton');
    const downloadFullExcelButton = document.getElementById('downloadFullExcelButton');
    const downloadNotifyreCSVButton = document.getElementById('downloadNotifyreCSVButton');
    const downloadGoogleWorkspaceCSVButton = document.getElementById('downloadGoogleWorkspaceCSVButton');
    const categoryInput = document.getElementById('category');
    const locationInput = document.getElementById('location');
    const countInput = document.getElementById('count');
    const progressBar = document.getElementById('progressBar');
    const logEl = document.getElementById('log');
    const resultsTableBody = document.getElementById('resultsTableBody');
    const researchInProgressIcon = document.querySelector('.progress-section h2 i.fas');
    
    // New filter elements
    const filterSocialMediaCheckbox = document.getElementById('filterSocialMedia');
    const filterEmailPhoneCheckbox = document.getElementById('filterEmailPhone');

    let allCollectedData = [];
    let displayedData = [];

    document.getElementById('currentYear').textContent = new Date().getFullYear();

    // --- Socket.IO Event Listeners ---
    socket.on('connect', () => {
        logMessage('🚀 Connected to the real-time server!', 'success');
    });

    socket.on('disconnect', () => {
        logMessage('💔 Disconnected from the real-time server.', 'error');
        setUiState(false);
        progressBar.classList.remove('pulsing');
        researchInProgressIcon.classList.remove('fa-spin');
        researchInProgressIcon.classList.add('fa-exclamation-triangle'); // Show warning icon on disconnect
    });

    socket.on('log', (message) => {
        logMessage(message, 'info');
    });

    socket.on('progress_update', ({ qualifiedFound, qualifiedTarget, totalRawProcessed, maxRawToProcess }) => {
        // Update progress bar based on QUALIFIED results found vs. requested target
        // If no qualified target, use the total raw processed as a fallback for visual movement
        const progressBasis = qualifiedTarget > 0 ? qualifiedFound : totalRawProcessed;
        const progressTotal = qualifiedTarget > 0 ? qualifiedTarget : maxRawToProcess; // Base total on target or max raw
        
        updateProgressBar(progressBasis, progressTotal);
        
        if (qualifiedFound > 0 && progressBar.classList.contains('pulsing')) {
            progressBar.classList.remove('pulsing');
            researchInProgressIcon.classList.remove('fa-spin');
            researchInProgressIcon.classList.add('fa-spinner');
        }
    });

    socket.on('scrape_complete', (businesses) => {
        logMessage(`\n✅ Scraping process finished by server. Received ${businesses.length} qualified prospects.`, 'success');
        
        allCollectedData = []; 
        resultsTableBody.innerHTML = '';
        
        businesses.forEach((business) => {
            const fullBusinessData = {
                OwnerName: '',
                ...business,
                Category: categoryInput.value.replace(/s$/, ''),
                SuburbArea: locationInput.value.split(',')[0].trim(),
                LastVerifiedDate: new Date().toISOString().split('T')[0]
            };
            allCollectedData.push(fullBusinessData);
        });

        applyFiltersAndRenderTable();
        // Ensure progress bar shows 100% based on the count of QUALIFIED items successfully found
        updateProgressBar(allCollectedData.length, parseInt(countInput.value, 10)); 
        logMessage(`   All ${allCollectedData.length} qualified prospects displayed below.`, 'success');
        setUiState(false);
    });

    socket.on('scrape_error', (error) => {
        logMessage(`\n❌ SCRAPE ERROR: ${error.error || 'An unknown error occurred on the server.'}`, 'error');
        logMessage(`   Please check server console for details and ensure all inputs are valid.`, 'error');
        setUiState(false);
        progressBar.classList.remove('pulsing');
        researchInProgressIcon.classList.remove('fa-spin');
        researchInProgressIcon.classList.add('fa-exclamation-triangle'); // Show warning icon on error
        updateProgressBar(0, parseInt(countInput.value, 10)); // Reset progress on error
    });
    // --- End Socket.IO Event Listeners ---

    startButton.addEventListener('click', startResearch);
    filterSocialMediaCheckbox.addEventListener('change', applyFiltersAndRenderTable);
    filterEmailPhoneCheckbox.addEventListener('change', applyFiltersAndRenderTable);
    
    downloadFullExcelButton.addEventListener('click', () => downloadExcel(displayedData, 'rtrl_full_prospect_list'));
    downloadNotifyreCSVButton.addEventListener('click', downloadNotifyreCSV);
    downloadGoogleWorkspaceCSVButton.addEventListener('click', downloadGoogleWorkspaceCSV);


    async function startResearch() {
        setUiState(true);
        allCollectedData = [];
        displayedData = [];
        logEl.textContent = '';
        resultsTableBody.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        progressBar.classList.add('pulsing');
        researchInProgressIcon.classList.add('fa-spin');
        researchInProgressIcon.classList.remove('fa-check-circle', 'fa-exclamation-triangle'); // Clear previous icons

        const category = categoryInput.value;
        const location = locationInput.value;
        const count = parseInt(countInput.value, 10);

        if (!category || !location || !count || count < 1 || count > 50) {
            logMessage(`❌ Input Error: Please provide valid category, location, and a number between 1-50 for count.`, 'error');
            setUiState(false);
            progressBar.classList.remove('pulsing');
            researchInProgressIcon.classList.remove('fa-spin');
            return;
        }

        logMessage(`Sending request to server to start scraping for ${count} qualified prospects...`, 'info');
        socket.emit('start_scrape', { category, location, count });
    }

    function applyFiltersAndRenderTable() {
        let filtered = [...allCollectedData];

        if (filterSocialMediaCheckbox.checked) {
            filtered = filtered.filter(business => 
                (business.InstagramURL && business.InstagramURL !== '#') || 
                (business.FacebookURL && business.FacebookURL !== '#')
            );
        }

        if (filterEmailPhoneCheckbox.checked) {
            filtered = filtered.filter(business => 
                (business.Email && business.Email.trim() !== '') && 
                (business.Phone && business.Phone.trim() !== '')
            );
        }

        displayedData = filtered;
        resultsTableBody.innerHTML = '';
        
        if (displayedData.length === 0 && allCollectedData.length > 0) {
            logMessage('No results match the current filter criteria.', 'info');
        } else if (displayedData.length === 0 && allCollectedData.length === 0 && !startButton.disabled) {
             // Do nothing if no data and not actively scraping
        }
        
        displayedData.forEach(business => addTableRow(business));
        setDownloadButtonStates(startButton.disabled);
    }


    function addTableRow(data) {
        const row = document.createElement('tr');
        const truncate = (str, len) => (str && str.length > len) ? str.slice(0, len) + '...' : str || '';
        
        row.innerHTML = `
            <td>${data.BusinessName || ''}</td>
            <td>${data.Category || ''}</td>
            <td>${data.SuburbArea || ''}</td>
            <td>${data.StreetAddress || ''}</td>
            <td><a href="${data.Website || '#'}" target="_blank" title="${data.Website || ''}">${truncate(data.Website, 25)}</a></td>
            <td>${data.OwnerName || ''}</td>
            <td>${data.Email || ''}</td>
            <td>${data.Phone || ''}</td>
            <td><a href="${data.InstagramURL || '#'}" target="_blank" title="${data.InstagramURL || ''}">${truncate(data.InstagramURL, 20)}</a></td>
            <td><a href="${data.FacebookURL || '#'}" target="_blank" title="${data.FacebookURL || ''}">${truncate(data.FacebookURL, 20)}</a></td>
            <td><a href="${data.GoogleMapsURL || '#'}" target="_blank" title="${data.GoogleMapsURL || ''}"><i class="fas fa-map-marker-alt"></i> View</a></td>
        `;
        resultsTableBody.appendChild(row);
    }
    
    function setUiState(isBusy) {
        startButton.disabled = isBusy;
        categoryInput.disabled = isBusy;
        locationInput.disabled = isBusy;
        countInput.disabled = isBusy;
        filterSocialMediaCheckbox.disabled = isBusy;
        filterEmailPhoneCheckbox.disabled = isBusy;
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
            researchInProgressIcon.classList.remove('fa-spin');
            researchInProgressIcon.classList.remove('fa-spinner');
            researchInProgressIcon.classList.add('fa-check-circle');
            logEl.scrollTop = logEl.scrollHeight;
        } else {
             researchInProgressIcon.classList.remove('fa-check-circle');
             researchInProgressIcon.classList.remove('fa-exclamation-triangle'); // Clear error icon if progress starts
             if (!researchInProgressIcon.classList.contains('fa-spin')) { // Only add if not already spinning
                 researchInProgressIcon.classList.add('fa-spinner');
             }
        }
    }
    
    function downloadExcel(data, filenamePrefix) {
        if (data.length === 0) {
            logMessage('No data to download for this format!', 'error');
            return;
        }

        const exportData = data.map(item => ({
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

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Business List");
        XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.xlsx`);
        logMessage(`\n⬇️ Excel file '${filenamePrefix}.xlsx' generated successfully!`, 'success');
    }

    function downloadNotifyreCSV() {
        const notifyreData = displayedData.filter(item => item.Phone && item.Phone.trim() !== '')
                                           .map(item => ({
                                               Phone: item.Phone,
                                               Name: item.BusinessName
                                           }));
        if (notifyreData.length === 0) {
            logMessage('No valid phone numbers found for Notifyre export in the current display!', 'error');
            return;
        }

        const ws = XLSX.utils.json_to_sheet(notifyreData, { header: ["Phone", "Name"] });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Notifyre SMS List");
        XLSX.writeFile(wb, `notifyre_sms_list_${new Date().toISOString().split('T')[0]}.csv`);
        logMessage(`\n⬇️ Notifyre SMS list generated successfully!`, 'success');
    }

    function downloadGoogleWorkspaceCSV() {
        const emailData = displayedData.filter(item => item.Email && item.Email.trim() !== '')
                                        .map(item => ({
                                            Email: item.Email,
                                            Name: item.BusinessName
                                        }));
        if (emailData.length === 0) {
            logMessage('No valid email addresses found for Google Workspace export in the current display!', 'error');
            return;
        }
        
        const ws = XLSX.utils.json_to_sheet(emailData, { header: ["Email", "Name"] });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Google Workspace Email List");
        XLSX.writeFile(wb, `google_workspace_email_list_${new Date().toISOString().split('T')[0]}.csv`);
        logMessage(`\n⬇️ Google Workspace email list generated successfully!`, 'success');
    }

    applyFiltersAndRenderTable();
});