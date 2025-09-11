// server.js
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// =====================================================================
// ADD THIS UNIQUE LOG TO CONFIRM SERVER.JS VERSION
console.log("SERVER.JS LOADED: DIAGNOSTIC VERSION 2024-05-16-B");
// =====================================================================

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
const GOOGLE_MAPS_API_KEY = process.env.MAPS_API_KEY;
const PLACEHOLDER_KEY = '%%GOOGLE_MAPS_API_KEY%%';

if (!GOOGLE_MAPS_API_KEY) {
    console.error("ERROR: MAPS_API_KEY not found in .env file! Please ensure it's set correctly and restart the server.");
    process.exit(1); 
} else {
    console.log("Server loaded API Key (first 5 and last 5 chars):", GOOGLE_MAPS_API_KEY.substring(0, 5) + "..." + GOOGLE_MAPS_API_KEY.substring(GOOGLE_MAPS_API_KEY.length - 5));
    console.log("Expected placeholder in HTML:", PLACEHOLDER_KEY);
}


app.use(cors());
app.use(express.json());

// <<< CRITICAL CHANGE: MOVE app.get('/') BEFORE app.use(express.static) >>>
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html from path:', indexPath, 'Error:', err);
            return res.status(500).send('Error loading the application.');
        }

        console.log("\n--- HTML FILE READ ---");
        console.log("Checking for placeholder in HTML content...");
        const containsPlaceholder = data.includes(PLACEHOLDER_KEY);
        console.log(`HTML content ${containsPlaceholder ? 'DOES' : 'DOES NOT'} contain the placeholder.`);
        
        let modifiedHtml = data;
        if (containsPlaceholder) {
            modifiedHtml = data.replace(PLACEHOLDER_KEY, GOOGLE_MAPS_API_KEY);
            console.log("Replacement attempted.");
            if (modifiedHtml.includes(PLACEHOLDER_KEY)) {
                console.error("WARNING: Placeholder still found after replacement! Something is wrong with the replace operation.");
            } else {
                console.log("Placeholder replaced successfully in modified HTML string.");
            }
        } else {
            console.warn("WARNING: Placeholder not found in HTML. API key will not be injected. Check index.html for exact placeholder match.");
        }
        console.log("--- END HTML PROCESSING ---\n");
        
        res.send(modifiedHtml);
    });
});

// Serve static files AFTER the custom root route
app.use(express.static(__dirname)); 


io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit('log', `[Server] Connected to Real-time Scraper.`);

    socket.on('start_scrape', async ({ category, location, postalCode, country, count, allowEmailOrPhone }) => {
        let areaQueryParts = [];
        if (location) areaQueryParts.push(location);
        if (postalCode) areaQueryParts.push(postalCode);
        const areaQuery = areaQueryParts.join(' ');

        if (!areaQuery) {
            socket.emit('log', `Error: Please provide either a Suburb/Area or a Postal Code.`, 'error');
            socket.emit('scrape_error', { error: `Missing location data.` });
            return;
        }
        if (!country) {
            socket.emit('log', `Error: Please provide a Country for the search.`, 'error');
            socket.emit('scrape_error', { error: `Missing country data.` });
            return;
        }

        const searchQuery = `${category} in ${areaQuery}, ${country}`;
        socket.emit('log', `[Server] Starting search for ${count} *qualified* "${category}" prospects in "${areaQuery}, ${country}"`);
        if (allowEmailOrPhone) {
            socket.emit('log', `[Server] Qualification: Requiring at least an email OR a phone number.`);
        } else {
            socket.emit('log', `[Server] Qualification: Requiring BOTH an email AND a phone number.`);
        }
        
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US,en'],
                protocolTimeout: 120000,
            });
            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en' });

            const qualifiedBusinesses = [];
            const processedUrlSet = new Set();
            let totalRawUrlsAttemptedDetails = 0;
            let mapsCollectionAttempts = 0;
            const MAX_MAPS_COLLECTION_ATTEMPTS = 5; 
            const MAX_TOTAL_RAW_URLS_TO_PROCESS = Math.max(count * 15, 50); 
            
            socket.emit('log', `[Server] Target: ${count} qualified prospects. Max unique raw URLs to gather & process: ${MAX_TOTAL_RAW_URLS_TO_PROCESS}.`);

            while (qualifiedBusinesses.length < count && mapsCollectionAttempts < MAX_MAPS_COLLECTION_ATTEMPTS && processedUrlSet.size < MAX_TOTAL_RAW_URLS_TO_PROCESS) {
                mapsCollectionAttempts++;
                const remainingToQualify = count - qualifiedBusinesses.length;
                const rawUrlsToCollectThisAttempt = Math.max(remainingToQualify * 5, 20); 
                
                const availableSlotsForRawUrls = MAX_TOTAL_RAW_URLS_TO_PROCESS - processedUrlSet.size;
                const finalRawUrlsTargetThisAttempt = Math.min(rawUrlsToCollectThisAttempt, availableSlotsForRawUrls);

                if (finalRawUrlsTargetThisAttempt <= 0) {
                    socket.emit('log', `   -> No more slots available for new raw URLs (Total unique discovered: ${processedUrlSet.size}/${MAX_TOTAL_RAW_URLS_TO_PROCESS}). Breaking Maps collection loop.`);
                    break;
                }

                socket.emit('log', `\nLEVEL 1, Maps Collection Attempt ${mapsCollectionAttempts}/${MAX_MAPS_COLLECTION_ATTEMTS}: Collecting up to ${finalRawUrlsTargetThisAttempt} *new* unique Google Maps URLs... (Total unique discovered so far: ${processedUrlSet.size})`);
                const newlyDiscoveredUrls = await collectGoogleMapsUrlsContinuously(page, searchQuery, socket, finalRawUrlsTargetThisAttempt, processedUrlSet);
                
                if (newlyDiscoveredUrls.length === 0) {
                    socket.emit('log', `   -> No new unique URLs found from Google Maps in this attempt. Total unique discovered: ${processedUrlSet.size}.`);
                    if (mapsCollectionAttempts === MAX_MAPS_COLLECTION_ATTEMPTS && qualifiedBusinesses.length < count) {
                         socket.emit('log', `   -> Max Maps collection attempts reached and still need qualified leads. Ending collection.`, 'warning');
                    }
                    continue; 
                } else {
                    socket.emit('log', `-> Discovered ${newlyDiscoveredUrls.length} new raw listings. Total unique discovered: ${processedUrlSet.size}.`);
                }

                socket.emit('log', `LEVEL 2: Starting detailed scraping and qualification for this batch of ${newlyDiscoveredUrls.length} raw listings...`);

                for (const urlToProcess of newlyDiscoveredUrls) {
                    if (qualifiedBusinesses.length >= count || totalRawUrlsAttemptedDetails >= MAX_TOTAL_RAW_URLS_TO_PROCESS) {
                        socket.emit('log', `   -> Target (${count}) met or max raw URLs processed (${MAX_TOTAL_RAW_URLS_TO_PROCESS}) reached. Stopping further detailed processing.`);
                        break; 
                    }
                    
                    totalRawUrlsAttemptedDetails++;
                    socket.emit('log', `\n--- Processing Raw Business ${totalRawUrlsAttemptedDetails} (Qualified: ${qualifiedBusinesses.length}/${count}) ---`);
                    
                    let googleData = null;
                    try {
                        googleData = await scrapeGoogleMapsDetails(page, urlToProcess, socket, country);
                        socket.emit('log', `-> Business: ${googleData.BusinessName || 'N/A'}`);
                    } catch (detailError) {
                        socket.emit('log', `Error getting details from Maps page (${urlToProcess}): ${detailError.message.split('\n')[0]}. Skipping this URL.`, 'error');
                        socket.emit('progress_update', { qualifiedFound: qualifiedBusinesses.length, qualifiedTarget: count }); 
                        continue;
                    }

                    let websiteData = {};
                    if (googleData.Website) {
                        socket.emit('log', `LEVEL 3: Visiting website (${googleData.Website}) for contact details...`);
                        websiteData = await scrapeWebsiteForGoldData(page, googleData.Website, socket);
                        socket.emit('log', `-> Owner: ${websiteData.OwnerName || 'Not found'}, Email: ${websiteData.Email || 'None'}`);
                    } else {
                        socket.emit('log', `LEVEL 3: Skipped, no website found (from Google Maps).`);
                    }

                    const fullBusinessData = { ...googleData, ...websiteData };

                    const hasEmail = fullBusinessData.Email && fullBusinessData.Email.trim() !== '';
                    const hasPhone = fullBusinessData.Phone && fullBusinessData.Phone.trim() !== '';

                    let isQualified = false;
                    if (allowEmailOrPhone) {
                        isQualified = hasEmail || hasPhone;
                    } else {
                        isQualified = hasEmail && hasPhone;
                    }

                    if (isQualified) {
                        qualifiedBusinesses.push(fullBusinessData);
                        socket.emit('log', `✅ QUALIFIED: Business meets email/phone criteria! (${qualifiedBusinesses.length}/${count})`);
                    } else {
                        socket.emit('log', `   SKIPPED: Business does not meet email/phone criteria.`);
                    }

                    socket.emit('progress_update', { 
                        qualifiedFound: qualifiedBusinesses.length,
                        qualifiedTarget: count
                    });
                }
            }
            
            if (qualifiedBusinesses.length < count) {
                socket.emit('log', `Warning: Could only find ${qualifiedBusinesses.length} qualified prospects out of requested ${count} within the search limits (processed ${totalRawUrlsAttemptedDetails} raw URLs, discovered ${processedUrlSet.size} unique raw URLs).`, 'warning');
            }
            
            socket.emit('log', `Scraping session completed. Found ${qualifiedBusinesses.length} qualified prospects (Target: ${count}). Closing browser.`);
            await browser.close();
            socket.emit('scrape_complete', qualifiedBusinesses);

        } catch (error) {
            socket.emit('log', `A critical error occurred during scraping: ${error.message}`);
            console.error('A critical error occurred:', error);
            if (browser) await browser.close();
            socket.emit('scrape_error', { error: `Failed to scrape data: ${error.message.split('\n')[0]}` });
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

async function collectGoogleMapsUrlsContinuously(page, searchQuery, socket, maxUrlsToCollectThisBatch, processedUrlSet) {
    const newlyDiscoveredUrls = [];
    const resultsContainerSelector = 'div[role="feed"]';
    
    await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2', timeout: 60000 });
    try {
        await page.waitForSelector('form[action^="https://consent.google.com"] button[aria-label="Accept all"]', { timeout: 15000 });
        await page.click('form[action^="https://consent.google.com"] button[aria-label="Accept all"]');
        socket.emit('log', '   -> Accepted Google consent dialog.');
    } catch (e) { }

    await page.type('#searchboxinput', searchQuery);
    await page.click('#searchbox-searchbutton');

    try {
        await page.waitForSelector(resultsContainerSelector, { timeout: 45000 });
        socket.emit('log', `   -> Initial search results container loaded.`);
    } catch (error) {
        socket.emit('log', `Error: Google Maps results container not found after search. Cannot collect URLs.`, 'error');
        return [];
    }

    let lastScrollHeight = 0;
    let consecutiveNoProgressAttempts = 0;
    const MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS = 7; 
    const MAX_TOTAL_SCROLL_ATTEMPTS = 150; 
    let totalScrollsMade = 0;
    let urlsDiscoveredInThisBatch = 0;

    while (totalScrollsMade < MAX_TOTAL_SCROLL_ATTEMPTS && urlsDiscoveredInThisBatch < maxUrlsToCollectThisBatch && consecutiveNoProgressAttempts < MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS) {
        const initialProcessedSetSize = processedUrlSet.size;

        const currentVisibleUrls = await page.$$eval(`${resultsContainerSelector} a[href*="https://www.google.com/maps/place/"]`, links => links.map(link => link.href));
        currentVisibleUrls.forEach(url => {
            if (!processedUrlSet.has(url)) { 
                processedUrlSet.add(url);
                newlyDiscoveredUrls.push(url); 
                urlsDiscoveredInThisBatch++;
            }
        });

        const newUniqueUrlsAddedInThisIteration = processedUrlSet.size - initialProcessedSetSize;
        
        const containerHandle = await page.$(resultsContainerSelector);
        if (!containerHandle) {
            socket.emit('log', `Error: Google Maps results container disappeared during scroll check. Stopping collection.`);
            break;
        }

        await page.evaluate(selector => {
            const el = document.querySelector(selector);
            if (el) el.scrollTop = el.scrollHeight;
        }, resultsContainerSelector);
        await new Promise(r => setTimeout(r, 3000));

        totalScrollsMade++;
        const newScrollHeight = await page.evaluate(selector => document.querySelector(selector)?.scrollHeight || 0, resultsContainerSelector);
        
        const hasNewUrls = newUniqueUrlsAddedInThisIteration > 0;
        const hasScrolledFurther = newScrollHeight > lastScrollHeight;

        if (hasNewUrls || hasScrolledFurther) {
            consecutiveNoProgressAttempts = 0; 
            if (hasNewUrls) {
                 socket.emit('log', `   -> Discovered ${newUniqueUrlsAddedInThisIteration} new unique URLs. Total in batch: ${urlsDiscoveredInThisBatch}/${maxUrlsToCollectThisBatch}.`);
            } else {
                 socket.emit('log', `   -> Scrolled further, but no *new* unique URLs in this section. Total in batch: ${urlsDiscoveredInThisBatch}/${maxUrlsToCollectThisBatch}.`);
            }
        } else {
            consecutiveNoProgressAttempts++;
            socket.emit('log', `   -> No new unique URLs and no scroll progress. Consecutive attempts: ${consecutiveNoProgressAttempts}/${MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS}. (Total scrolls: ${totalScrollsMade}, Total in batch: ${urlsDiscoveredInThisBatch}/${maxUrlsToCollectThisBatch})`);
        }
        lastScrollHeight = newScrollHeight;

        if (consecutiveNoProgressAttempts >= MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS) {
            socket.emit('log', `   -> Max consecutive attempts without any progress (new URLs or scroll) reached. Assuming end of results in this area. Breaking.`);
            break; 
        }
    }
    socket.emit('log', `   -> Finished Maps collection for this attempt. Found ${urlsDiscoveredInThisBatch} new unique URLs for processing batch after ${totalScrollsMade} scrolls.`);
    if (urlsDiscoveredInThisBatch >= maxUrlsToCollectThisBatch) {
        socket.emit('log', `Warning: Reached requested limit of ${maxUrlsToCollectThisBatch} raw URLs for this Maps batch.`, 'warning');
    } else if (totalScrollsMade >= MAX_TOTAL_SCROLL_ATTEMPTS) {
        socket.emit('log', `Warning: Reached maximum total scroll attempts (${MAX_TOTAL_SCROLL_ATTEMPTS}) during Maps collection.`, 'warning');
    }
    return newlyDiscoveredUrls; 
}


async function scrapeGoogleMapsDetails(page, url, socket, country) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        await page.waitForSelector('h1', {timeout: 60000});
    } catch (error) {
        throw new Error(`Failed to load Google Maps page or find H1 for URL: ${url}. Error: ${error.message.split('\n')[0]}`);
    }
    
    return page.evaluate((countryCode) => {
        const cleanText = (text) => {
            if (!text) return '';

            let cleaned = text.replace(/^[^a-zA-Z0-9\s.,'#\-+/&_]+/u, ''); 
            cleaned = cleaned.replace(/\p{Z}/gu, ' ');
            cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF\n\r]/g, '');
            return cleaned.replace(/\s+/g, ' ').trim();
        };

        const cleanPhoneNumber = (numberText, currentCountry) => {
            if (!numberText) return '';
            let cleaned = String(numberText).trim().replace(/\D/g, '');

            if (currentCountry && currentCountry.toLowerCase() === 'australia') {
                if (cleaned.startsWith('0')) {
                    cleaned = '61' + cleaned.substring(1);
                } else if (cleaned.startsWith('61')) {
                } else { 
                    if (cleaned.length >= 8 && cleaned.length <= 10) {
                        cleaned = '61' + cleaned;
                    }
                }
                if (cleaned.startsWith('610') && cleaned.length > 10) {
                     cleaned = '61' + cleaned.substring(3);
                }
            }
            return cleaned.startsWith('+') ? cleaned.substring(1) : cleaned; 
        };

        return {
            BusinessName: cleanText(document.querySelector('h1')?.innerText),
            StreetAddress: cleanText(document.querySelector('button[data-item-id="address"]')?.innerText),
            Website: document.querySelector('a[data-item-id="authority"]')?.href || '',
            Phone: cleanPhoneNumber(document.querySelector('button[data-item-id*="phone"]')?.innerText, countryCode),
            GoogleMapsURL: window.location.href,
        };
    }, country);
}

async function scrapeWebsiteForGoldData(page, websiteUrl, socket) {
    const data = { Email: '', InstagramURL: '', FacebookURL: '', OwnerName: '' };
    try {
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

        const aboutPageKeywords = ['about', 'team', 'our-story', 'who-we-are', 'meet-the-team', 'contact', 'people'];
        const ownerTitleKeywords = ['owner', 'founder', 'director', 'co-founder', 'principal', 'manager', 'proprietor', 'ceo', 'president'];
        const genericWords = ['project', 'business', 'team', 'contact', 'support', 'admin', 'office', 'store', 'shop', 'sales', 'info', 'general', 'us', 'our', 'hello', 'get in touch', 'enquiries', 'email', 'phone', 'location', 'locations', 'company', 'services', 'trading', 'group', 'ltd', 'pty', 'inc', 'llc', 'customer', 'relations', 'marketing', 'welcome', 'home', 'privacy', 'terms', 'cookies', 'copyright', 'all rights reserved', 'headquarters', 'menu', 'products', 'delivery', 'online'];
        
        let foundAboutLink = false;
        const allLinksOnCurrentPage = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));
        
        for (const keyword of aboutPageKeywords) {
            const aboutLink = allLinksOnCurrentPage.find(link => link.text.includes(keyword) && link.href.startsWith('http'));
            if (aboutLink && aboutLink.href) {
                socket.emit('log', `   -> Found '${keyword}' page link, navigating to: ${aboutLink.href}...`);
                await page.goto(aboutLink.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
                foundAboutLink = true;
                break;
            }
        }
        if (!foundAboutLink) {
            socket.emit('log', '   -> No specific "About Us/Contact" page link found, searching current page.');
        }

        const pageText = await page.evaluate(() => document.body.innerText);
        const textLines = pageText.split('\n');

        for (const line of textLines) {
            for (const title of ownerTitleKeywords) {
                if (line.toLowerCase().includes(title)) {
                    let potentialName = line.split(new RegExp(title, 'i'))[0].trim().replace(/,$/, '');
                    
                    potentialName = potentialName.replace(/^(the|a|an)\s+/i, '').trim();
                    potentialName = potentialName.replace(/\s+(of|and|inc|ltd|pty|group|llc)\s*$/i, '').trim();

                    const wordsInName = potentialName.split(' ').filter(word => word.length > 0);
                    
                    const looksLikeName = wordsInName.length >= 2 && wordsInName.length <= 4 && potentialName.length > 3 &&
                                          wordsInName.every(word => word[0] === word[0].toUpperCase() || word.length <= 3);

                    const isGeneric = genericWords.some(word => potentialName.toLowerCase().includes(word));
                    
                    if (looksLikeName && !isGeneric) {
                        data.OwnerName = potentialName;
                        break;
                    }
                }
            }
            if (data.OwnerName) break;
        }

        const currentLinks = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));

        data.InstagramURL = currentLinks.find(link => link.href.includes('instagram.com'))?.href || '';
        data.FacebookURL = currentLinks.find(link => link.href.includes('facebook.com'))?.href || '';
        
        const mailtoLink = currentLinks.find(link => link.href.startsWith('mailto:'));
        data.Email = mailtoLink ? mailtoLink.href.replace('mailto:', '').split('?')[0] : '';
        if (!data.Email) {
            const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch && !emailMatch[0].includes('wix.com') && !emailMatch[0].includes('squarespace.com') && !emailMatch[0].includes('mail.ru') && !emailMatch[0].includes('noreply') && !emailMatch[0].includes('info@') && !emailMatch[0].includes('contact@')) { 
                data.Email = emailMatch[0];
            }
        }

    } catch (error) {
        socket.emit('log', `   -> Could not fully scrape ${websiteUrl}. Error: ${error.message.split('\n')[0]}`);
    }
    return data;
}

server.listen(PORT, () => {
    console.log(`Scraping server (v23 - Timeout & Cleaning Refinements) running on http://localhost:${PORT}`);
});