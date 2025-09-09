// script.js (v2 - Corrected Data Handling and Improved UI)
document.addEventListener('DOMContentLoaded', () => {
    // --- (DOM Elements are the same) ---
    const startButton = document.getElementById('startButton');
    const downloadButton = document.getElementById('downloadButton');
    const categoryInput = document.getElementById('category');
    const locationInput = document.getElementById('location');
    const countInput = document.getElementById('count');
    const progressBar = document.getElementById('progressBar');
    const logEl = document.getElementById('log');
    const resultsTableBody = document.getElementById('resultsTableBody');

    let collectedData = [];

    startButton.addEventListener('click', startResearch);
    downloadButton.addEventListener('click', downloadExcel);

    async function startResearch() {
        setUiState(true);
        collectedData = [];
        logEl.textContent = '';
        resultsTableBody.innerHTML = '';
        progressBar.style.width = '0%';
        
        const category = categoryInput.value;
        const location = locationInput.value;
        const count = parseInt(countInput.value, 10);

        logMessage(`Sending request to server for ${count} ${category} in ${location}...`);
        logMessage(`This may take a few minutes as it's performing a multi-level scrape...`);
        
        try {
            const response = await fetch('http://localhost:3000/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category, location, count }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Server responded with status: ${response.status}`);
            }

            const businesses = await response.json();
            logMessage(`\n✅ Server responded with ${businesses.length} results.`);
            
            businesses.forEach((business, index) => {
                // *** THE FIX IS HERE ***
                // We now correctly merge the scraped data with the front-end data
                // without overwriting the fields we worked so hard to scrape.
                const fullBusinessData = {
                    OwnerName: '', // This is a placeholder as we don't scrape it
                    ...business,   // All the data from the server (Name, Address, Phone, Email, etc.)
                    Category: category.slice(0, -1),
                    SuburbArea: location.split(',')[0].trim(),
                    LastVerifiedDate: new Date().toISOString().split('T')[0]
                };
                collectedData.push(fullBusinessData);
                addTableRow(fullBusinessData);
                updateProgressBar(index + 1, businesses.length);
            });
            logMessage(`\nResearch Complete! Data displayed below.`);

        } catch (error) {
            logMessage(`\n❌ ERROR: ${error.message}`);
            logMessage(`   Please ensure the server.js is running in the terminal.`);
        } finally {
            setUiState(false);
        }
    }

    function addTableRow(data) {
        // *** UI IMPROVEMENT HERE ***
        // This function is updated to show truncated URLs instead of just "Link"
        // which is much more useful for the user.
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
            <td><a href="${data.InstagramURL || '#'}" target="_blank" title="${data.InstagramURL || ''}">${truncate(data.InstagramURL, 25)}</a></td>
            <td><a href="${data.FacebookURL || '#'}" target="_blank" title="${data.FacebookURL || ''}">${truncate(data.FacebookURL, 25)}</a></td>
            <td><a href="${data.GoogleMapsURL || '#'}" target="_blank" title="${data.GoogleMapsURL || ''}">View on Maps</a></td>
        `;
        resultsTableBody.appendChild(row);
    }
    
    // --- All other functions (setUiState, logMessage, updateProgressBar, downloadExcel) remain the same ---

    function setUiState(isBusy) {
        startButton.disabled = isBusy;
        categoryInput.disabled = isBusy;
        locationInput.disabled = isBusy;
        countInput.disabled = isBusy;
        downloadButton.disabled = isBusy || collectedData.length === 0;
    }
    
    function logMessage(message) {
        logEl.textContent += message + '\n';
        logEl.scrollTop = logEl.scrollHeight;
    }

    function updateProgressBar(current, total) {
        const percentage = (current / total) * 100;
        progressBar.style.width = `${percentage}%`;
    }
    
    function downloadExcel() {
        if (collectedData.length === 0) {
            alert('No data to download!');
            return;
        }

        const exportData = collectedData.map(item => ({
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
            SourceURLs: `${item.GoogleMapsURL};${item.Website}`,
            LastVerifiedDate: item.LastVerifiedDate
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Business List");
        XLSX.writeFile(wb, "trial_business_list.xlsx");
        logMessage("\n⬇️ Excel file generated successfully!");
    }
});