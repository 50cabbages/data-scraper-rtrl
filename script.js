document.addEventListener('DOMContentLoaded', () => {
    const socket = io('http://localhost:3000');

    const startButton = document.getElementById('startButton');
    const downloadFullExcelButton = document.getElementById('downloadFullExcelButton');
    const downloadNotifyreCSVButton = document.getElementById('downloadNotifyreCSVButton');
    const downloadGoogleWorkspaceCSVButton = document.getElementById('downloadGoogleWorkspaceCSVButton');
    const categoryInput = document.getElementById('category');
    const locationInput = document.getElementById('location');
    const postalCodeInput = document.getElementById('postalCode');
    const countryInput = document.getElementById('country');
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
            const fullBusinessData = {
                OwnerName: '',
                ...business,
                Category: categoryInput.value.replace(/s$/, ''),
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

        const category = categoryInput.value;
        const location = locationInput.value;
        const postalCode = postalCodeInput.value;
        const country = countryInput.value;
        const count = parseInt(countInput.value, 10);
        const allowEmailOrPhone = filterEmailOrPhoneCheckbox.checked;

        if (!category || (!location && !postalCode) || !country || count < 1 || count > 50) {
            logMessage(`Input Error: Please provide a category, at least a Suburb/Area OR Postal Code, a Country, and a number between 1-50 for count.`, 'error');
            setUiState(false);
            progressBar.classList.remove('pulsing');
            researchStatusIcon.classList.remove('fa-spin', 'fa-spinner');
            researchStatusIcon.classList.add('fa-exclamation-triangle');
            return;
        }

        logMessage(`Sending request to server to start scraping for ${count} qualified prospects...`, 'info');
        socket.emit('start_scrape', { category, location, postalCode, country, count, allowEmailOrPhone });
    }

    function cleanDisplayValue(text) {
        if (!text) return '';
        // Aggressively remove all non-printable ASCII characters, zero-width spaces, newlines, and other common invisible/control Unicode chars
        return text.replace(/[\u0000-\u001F\u007F-\u009F\u00A0\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\n\r]/g, '').trim();
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
        categoryInput.disabled = isBusy;
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