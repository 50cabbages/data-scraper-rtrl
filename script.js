// script.js (Real-time with Socket.IO Client - with Excel Styling)
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
    
    // Filter elements
    const filterSocialMediaCheckbox = document.getElementById('filterSocialMedia');

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
        researchInProgressIcon.classList.add('fa-exclamation-triangle');
    });

    socket.on('log', (message) => {
        logMessage(message, 'info');
    });

    socket.on('progress_update', ({ qualifiedFound, qualifiedTarget }) => {
        updateProgressBar(qualifiedFound, qualifiedTarget); 
        
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
        researchInProgressIcon.classList.add('fa-exclamation-triangle');
        updateProgressBar(0, parseInt(countInput.value, 10)); 
    });
    // --- End Socket.IO Event Listeners ---

    startButton.addEventListener('click', startResearch);
    filterSocialMediaCheckbox.addEventListener('change', applyFiltersAndRenderTable);
    
    downloadFullExcelButton.addEventListener('click', () => downloadExcel(displayedData, 'rtrl_full_prospect_list', 'xlsx'));
    downloadNotifyreCSVButton.addEventListener('click', () => downloadExcel(displayedData, 'notifyre_sms_list', 'csv', ["Phone", "Name"]));
    downloadGoogleWorkspaceCSVButton.addEventListener('click', () => downloadExcel(displayedData, 'google_workspace_email_list', 'csv', ["Email", "Name"]));


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
        researchInProgressIcon.classList.remove('fa-check-circle', 'fa-exclamation-triangle');

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
        
        displayedData = filtered;
        resultsTableBody.innerHTML = '';
        
        if (displayedData.length === 0 && allCollectedData.length > 0) {
            logMessage('No results match the current display filter criteria.', 'info');
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
             researchInProgressIcon.classList.remove('fa-exclamation-triangle');
             if (!researchInProgressIcon.classList.contains('fa-spin')) {
                 researchInProgressIcon.classList.add('fa-spinner');
             }
        }
    }

    // --- NEW HELPER FUNCTION FOR COLUMN SIZING ---
    // Improved to handle object keys and direct headers for CSV
    function getColumnWidths(data, headers) {
        if (!data || data.length === 0 || !headers || headers.length === 0) {
            return [];
        }

        const widths = headers.map(header => ({ wch: String(header).length + 2 })); // Start with header length + buffer

        data.forEach(item => {
            headers.forEach((header, colIndex) => {
                const cellValue = String(item[header] || '');
                const effectiveLength = (header.includes('URL') && cellValue.length > 50) ? 50 : cellValue.length; // Limit URL width
                if (effectiveLength + 2 > widths[colIndex].wch) {
                    widths[colIndex].wch = effectiveLength + 2;
                }
            });
        });

        return widths.map(w => ({ wch: Math.max(w.wch, 10) })); // Ensure minimum width
    }
    
    // --- UPDATED Generic Download function to include styling for XLSX ---
    function downloadExcel(data, filenamePrefix, fileType, specificHeaders = null) {
        if (data.length === 0) {
            logMessage('No data to download for this format!', 'error');
            return;
        }

        let exportData;
        let headers;

        if (specificHeaders) { // For CSV exports like Notifyre/Google Workspace
            exportData = data.map(item => {
                const row = {};
                specificHeaders.forEach(h => {
                    // Map generic headers to actual data properties
                    if (h === "Phone") row[h] = item.Phone;
                    else if (h === "Name") row[h] = item.BusinessName;
                    else if (h === "Email") row[h] = item.Email;
                    // Add more mappings if needed
                });
                return row;
            });
            headers = specificHeaders;
        } else { // For full Excel export
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
        ws['!cols'] = getColumnWidths(exportData, headers); // Apply calculated column widths

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Business List");

        if (fileType === 'xlsx') {
            // --- NEW EXCEL STYLING FOR HEADERS AND ZEBRA STRIPING ---
            // Define a simple header style
            const headerStyle = {
                fill: { fgColor: { rgb: "FFE6F0F8" } }, // Light blue background
                font: { bold: true, color: { rgb: "FF003366" } }, // Dark blue bold text
                border: { // Simple border around cells
                    top: { style: "thin", color: { rgb: "FFD1D9E6" } },
                    bottom: { style: "thin", color: { rgb: "FFD1D9E6" } },
                    left: { style: "thin", color: { rgb: "FFD1D9E6" } },
                    right: { style: "thin", color: { rgb: "FFD1D9E6" } }
                }
            };
            // Define alternating row styles
            const rowStyleEven = { fill: { fgColor: { rgb: "FFFDFDFD" } } }; // Very light grey
            const rowStyleOdd = { fill: { fgColor: { rgb: "FFFFFFFF" } } }; // White

            // Apply styles
            XLSX.utils.sheet_add_aoa(ws, [headers], { origin: "A1" }); // Re-add headers to ensure styling
            const range = XLSX.utils.decode_range(ws['!ref']);

            for (let C = range.s.c; C <= range.e.c; ++C) {
                const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: C });
                if (!ws[cellRef]) ws[cellRef] = {};
                ws[cellRef].s = headerStyle;
            }

            for (let R = range.s.r + 1; R <= range.e.r + 1; ++R) { // Start from second row (data rows)
                const rowStyle = (R % 2 === 0) ? rowStyleEven : rowStyleOdd; // Alternating
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                    if (ws[cellRef]) { // Only apply if cell exists
                        if (!ws[cellRef].s) ws[cellRef].s = {}; // Ensure style object exists
                        Object.assign(ws[cellRef].s, rowStyle); // Merge row style
                        // You could add cell borders for data rows here too if desired, e.g.,
                        // if (!ws[cellRef].s.border) ws[cellRef].s.border = {};
                        // Object.assign(ws[cellRef].s.border, headerStyle.border);
                    }
                }
            }
            // --- END NEW EXCEL STYLING ---
            XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.xlsx`);
            logMessage(`\n⬇️ Excel file '${filenamePrefix}.xlsx' generated successfully with styling!`, 'success');
        } else if (fileType === 'csv') {
            XLSX.writeFile(wb, `${filenamePrefix}_${new Date().toISOString().split('T')[0]}.csv`);
            logMessage(`\n⬇️ CSV file '${filenamePrefix}.csv' generated successfully!`, 'success');
        }
    }

    // Previous Notifyre and Google Workspace functions now call the generic downloadExcel
    function downloadNotifyreCSV() {
        const notifyreData = displayedData.filter(item => item.Phone && item.Phone.trim() !== '');
        if (notifyreData.length === 0) {
            logMessage('No valid phone numbers found for Notifyre export in the current display!', 'error');
            return;
        }
        downloadExcel(notifyreData, 'notifyre_sms_list', 'csv', ["Phone", "Name"]);
    }

    function downloadGoogleWorkspaceCSV() {
        const emailData = displayedData.filter(item => item.Email && item.Email.trim() !== '');
        if (emailData.length === 0) {
            logMessage('No valid email addresses found for Google Workspace export in the current display!', 'error');
            return;
        }
        downloadExcel(emailData, 'google_workspace_email_list', 'csv', ["Email", "Name"]);
    }

    applyFiltersAndRenderTable();
});