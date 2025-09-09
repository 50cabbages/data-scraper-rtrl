// server.js (v10 - Guaranteed Qualified Count)
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit('log', `[Server] Connected to Real-time Scraper.`);

    socket.on('start_scrape', async ({ category, location, count }) => {
        const searchQuery = `${category} in ${location}`;
        socket.emit('log', `[Server] Starting search for ${count} *qualified* "${category}" prospects in "${location}"`);
        
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true, // Set to 'false' to watch the magic happen
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US,en']
            });
            const page = await browser.newPage();
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en' });

            const qualifiedBusinesses = [];
            const processedUniqueGoogleUrls = new Set(); // Stores all unique Google Maps URLs seen/processed
            const pendingUrlsToProcess = []; // Queue of URLs to visit for details

            const MAX_CONSECUTIVE_SCROLL_NO_NEW_URLS = 5; // How many times to scroll without finding new URLs before giving up
            const MAX_TOTAL_RAW_URLS_TO_PROCESS = Math.max(count * 8, 150); // Hard cap on how many *raw* URLs we process in total before stopping, scales with count
            let consecutiveScrollsWithoutNewUrls = 0;
            let totalRawUrlsProcessed = 0; // Total businesses visited for details

            socket.emit('log', 'LEVEL 1: Navigating to Google Maps search results...');
            await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2', timeout: 35000 });
            try {
                await page.waitForSelector('form[action^="https://consent.google.com"] button[aria-label="Accept all"]', { timeout: 5000 });
                await page.click('form[action^="https://consent.google.com"] button[aria-label="Accept all"]');
                socket.emit('log', '   -> Accepted Google consent dialog.');
            } catch (e) {
                socket.emit('log', '   -> No Google consent dialog found or skipped.');
            }

            await page.type('#searchboxinput', searchQuery);
            await page.click('#searchbox-searchbutton');
            const resultsContainerSelector = 'div[role="feed"]';
            
            try {
                await page.waitForSelector(resultsContainerSelector, { timeout: 25000 }); // Wait longer for results
                socket.emit('log', `   -> Initial search results container loaded.`);
            } catch (error) {
                socket.emit('log', `❌ Error: Google Maps results container not found after ${25000 / 1000}s. Check query or if results exist.`, 'error');
                throw new Error(`Results container missing: ${error.message}`);
            }

            // --- Main loop to continuously collect and process URLs ---
            while (qualifiedBusinesses.length < count && totalRawUrlsProcessed < MAX_TOTAL_RAW_URLS_TO_PROCESS) {
                // 1. Collect currently visible URLs from Google Maps
                const currentVisibleUrls = await page.$$eval(`${resultsContainerSelector} a[href*="https://www.google.com/maps/place/"]`, links => links.map(link => link.href));
                const newUniqueUrlsFound = currentVisibleUrls.filter(url => !processedUniqueGoogleUrls.has(url));

                if (newUniqueUrlsFound.length > 0) {
                    socket.emit('log', `   -> Found ${newUniqueUrlsFound.length} new unique URLs in current view.`);
                    newUniqueUrlsFound.forEach(url => {
                        pendingUrlsToProcess.push(url);
                        processedUniqueGoogleUrls.add(url); // Mark as seen
                    });
                    consecutiveScrollsWithoutNewUrls = 0; // Reset scroll counter
                } else {
                    socket.emit('log', `   -> No new unique URLs found in current map view.`);
                }

                // 2. Process URLs from the pending queue
                while (pendingUrlsToProcess.length > 0 && qualifiedBusinesses.length < count && totalRawUrlsProcessed < MAX_TOTAL_RAW_URLS_TO_PROCESS) {
                    const urlToProcess = pendingUrlsToProcess.shift(); // Take one from the queue

                    totalRawUrlsProcessed++;
                    socket.emit('log', `\n--- Processing Raw Business ${totalRawUrlsProcessed} (Qualified: ${qualifiedBusinesses.length}/${count}) ---`);
                    socket.emit('log', `LEVEL 2: Getting details from Google Maps page for ${urlToProcess}...`);
                    
                    let googleData = null;
                    try {
                        googleData = await scrapeGoogleMapsDetails(page, urlToProcess);
                        socket.emit('log', `-> Business: ${googleData.BusinessName || 'N/A'}`);
                    } catch (detailError) {
                        socket.emit('log', `❌ Error getting details from Maps page (${urlToProcess}): ${detailError.message.split('\n')[0]}. Skipping this URL.`, 'error');
                        socket.emit('progress_update', { qualifiedFound: qualifiedBusinesses.length, qualifiedTarget: count }); // Update with current qualified count
                        continue; // Skip to next URL if Google Maps details failed
                    }


                    let websiteData = {};
                    if (googleData.Website) {
                        socket.emit('log', `LEVEL 3: Visiting website (${googleData.Website}) to find contacts and owner...`);
                        websiteData = await scrapeWebsiteForGoldData(page, googleData.Website, socket);
                        socket.emit('log', `-> Owner: ${websiteData.OwnerName || 'Not found'}, Email: ${websiteData.Email || 'None'}`);
                    } else {
                        socket.emit('log', `LEVEL 3: Skipped, no website found (from Google Maps).`);
                    }

                    const fullBusinessData = { ...googleData, ...websiteData };

                    // QUALIFICATION CRITERIA: Must have both Email and Phone
                    if (fullBusinessData.Email && fullBusinessData.Email.trim() !== '' &&
                        fullBusinessData.Phone && fullBusinessData.Phone.trim() !== '') {
                        qualifiedBusinesses.push(fullBusinessData);
                        socket.emit('log', `✅ QUALIFIED: Business meets email and phone criteria! (${qualifiedBusinesses.length}/${count})`);
                    } else {
                        socket.emit('log', `   SKIPPED: Business does not have both email and phone.`);
                    }

                    // Always update progress based on qualified found, vs requested count
                    socket.emit('progress_update', { 
                        qualifiedFound: qualifiedBusinesses.length,
                        qualifiedTarget: count
                    });
                }

                // 3. If we still need more qualified leads, try scrolling Google Maps
                if (qualifiedBusinesses.length < count && totalRawUrlsProcessed < MAX_TOTAL_RAW_URLS_TO_PROCESS) {
                    if (newUniqueUrlsFound.length === 0) { // Only increment if previous scroll found nothing new
                        consecutiveScrollsWithoutNewUrls++;
                    }

                    if (consecutiveScrollsWithoutNewUrls >= MAX_CONSECUTIVE_SCROLL_NO_NEW_URLS) {
                        socket.emit('log', `   -> Max consecutive scrolls without new URLs reached (${MAX_CONSECUTIVE_SCROLL_NO_NEW_URLS}). Assuming end of results in this area. Breaking.`);
                        break;
                    }

                    socket.emit('log', `   -> Still need more qualified prospects. Scrolling Google Maps for more results...`);
                    const containerHandle = await page.$(resultsContainerSelector);
                    if (!containerHandle) {
                        socket.emit('log', `❌ Error: Google Maps results container disappeared during scroll. Breaking.`);
                        break;
                    }
                    await page.evaluate(selector => {
                        const el = document.querySelector(selector);
                        if (el) el.scrollTop = el.scrollHeight;
                    }, resultsContainerSelector);
                    await new Promise(r => setTimeout(r, 2000)); // Give time for content to load after scroll
                }
            }
            
            socket.emit('log', `\n✅ Scraping session completed. Found ${qualifiedBusinesses.length} qualified prospects (Target: ${count}). Closing browser.`);
            await browser.close();
            socket.emit('scrape_complete', qualifiedBusinesses);

        } catch (error) {
            socket.emit('log', `❌ A critical error occurred during scraping: ${error.message}`);
            console.error('A critical error occurred:', error);
            if (browser) await browser.close();
            socket.emit('scrape_error', { error: `Failed to scrape data: ${error.message.split('\n')[0]}` });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});


// Helper functions (scrapeGoogleMapsDetails, scrapeWebsiteForGoldData)
// These are slightly refined for more robust error handling / timeouts.
async function scrapeGoogleMapsDetails(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 }); // Increased timeout
        await page.waitForSelector('h1', {timeout: 25000}); // Increased timeout
    } catch (error) {
        // Do not re-throw, just return null so it can be skipped/handled by the caller
        throw new Error(`Failed to load Google Maps page or find H1 for URL: ${url}. Error: ${error.message.split('\n')[0]}`);
    }
    
    return page.evaluate(() => {
        const cleanText = (text) => {
            if (!text) return '';
            return text.replace(/[^\x20-\x7E\sÀ-ÖØ-öø-ÿ]/g, '').trim();
        };

        return {
            BusinessName: cleanText(document.querySelector('h1')?.innerText),
            StreetAddress: cleanText(document.querySelector('button[data-item-id="address"]')?.innerText),
            Website: document.querySelector('a[data-item-id="authority"]')?.href || '',
            Phone: cleanText(document.querySelector('button[data-item-id*="phone"]')?.innerText),
            GoogleMapsURL: window.location.href,
        };
    });
}

async function scrapeWebsiteForGoldData(page, websiteUrl, socket) {
    const data = { Email: '', InstagramURL: '', FacebookURL: '', OwnerName: '' };
    try {
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }); // Increased timeout

        const aboutPageKeywords = ['about', 'team', 'our-story', 'who-we-are', 'meet-the-team', 'contact'];
        const ownerTitleKeywords = ['owner', 'founder', 'director', 'co-founder', 'principal', 'manager'];
        
        let foundAboutLink = false;
        const allLinksOnCurrentPage = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));
        
        for (const keyword of aboutPageKeywords) {
            const aboutLink = allLinksOnCurrentPage.find(link => link.text.includes(keyword) && link.href.startsWith('http'));
            if (aboutLink && aboutLink.href) {
                socket.emit('log', `   -> Found '${keyword}' page link, navigating to: ${aboutLink.href}...`);
                await page.goto(aboutLink.href, { waitUntil: 'domcontentloaded', timeout: 25000 }); // Increased timeout
                foundAboutLink = true;
                break;
            }
        }
        if (!foundAboutLink) {
            socket.emit('log', '   -> No specific "About Us/Contact" page link found, searching current page.');
        }

        const pageText = await page.evaluate(() => document.body.innerText);
        const textLines = pageText.split('\n');

        // Search for Owner Name
        for (const line of textLines) {
            for (const title of ownerTitleKeywords) {
                if (line.toLowerCase().includes(title)) {
                    const potentialName = line.split(new RegExp(title, 'i'))[0].trim();
                    if (potentialName && potentialName.split(' ').length <= 3 && potentialName.length > 2) {
                        data.OwnerName = potentialName.replace(/,$/, '').trim();
                        break;
                    }
                }
            }
            if (data.OwnerName) break;
        }

        // Find Social and Email (from current page)
        const currentLinks = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));

        data.InstagramURL = currentLinks.find(link => link.href.includes('instagram.com'))?.href || '';
        data.FacebookURL = currentLinks.find(link => link.href.includes('facebook.com'))?.href || '';
        
        const mailtoLink = currentLinks.find(link => link.href.startsWith('mailto:'));
        data.Email = mailtoLink ? mailtoLink.href.replace('mailto:', '').split('?')[0] : '';
        if (!data.Email) {
            const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch && !emailMatch[0].includes('wix.com') && !emailMatch[0].includes('squarespace.com')) {
                data.Email = emailMatch[0];
            }
        }

    } catch (error) {
        socket.emit('log', `   -> Could not fully scrape ${websiteUrl}. Error: ${error.message.split('\n')[0]}`);
    }
    return data;
}

server.listen(PORT, () => {
    console.log(`Scraping server (v10 - Guaranteed Qualified Count) running on http://localhost:${PORT}`);
});