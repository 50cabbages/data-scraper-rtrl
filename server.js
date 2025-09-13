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

puppeteer.use(StealthPlugin());

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

const PORT = 3000;
const GOOGLE_MAPS_API_KEY = process.env.MAPS_API_KEY;
const PLACEHOLDER_KEY = '%%GOOGLE_MAPS_API_KEY%%';

if (!GOOGLE_MAPS_API_KEY) {
    console.error("ERROR: MAPS_API_KEY not found in .env file!");
    process.exit(1);
}

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    fs.readFile(indexPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading index.html:', err);
            return res.status(500).send('Error loading the application.');
        }
        const modifiedHtml = data.replace(PLACEHOLDER_KEY, GOOGLE_MAPS_API_KEY);
        res.send(modifiedHtml);
    });
});

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit('log', `[Server] Connected to Real-time Scraper.`);

    socket.on('start_scrape', async ({ category, location, postalCode, country, count, businessName }) => {
        const isIndividualSearch = !!businessName;
        const finalCount = isIndividualSearch ? -1 : count;
        const isSearchAll = finalCount === -1;
        const targetCount = isSearchAll ? Infinity : finalCount;
        const areaQuery = [location, postalCode].filter(Boolean).join(' ');

        if (!areaQuery || !country) {
            socket.emit('scrape_error', { error: `Missing location or country data.` });
            return;
        }

        let searchQuery;
        let targetDisplay;
        if (isIndividualSearch) {
            searchQuery = `${businessName}, ${areaQuery}, ${country}`;
            targetDisplay = `all businesses named "${businessName}"`;
            socket.emit('log', `[Server] Starting individual search for ${targetDisplay}`);
        } else {
            searchQuery = `${category} in ${areaQuery}, ${country}`;
            targetDisplay = isSearchAll ? "all available" : `${count}`;
            socket.emit('log', `[Server] Starting search for ${targetDisplay} "${category}" prospects in "${areaQuery}, ${country}"`);
        }
        
        let browser;
        try {
            browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US,en'], protocolTimeout: 120000 });
            const page = await browser.newPage();
            page.setDefaultNavigationTimeout(60000);
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en' });

            const allProcessedBusinesses = [];
            const processedUrlSet = new Set();
            let totalRawUrlsAttemptedDetails = 0;
            let mapsCollectionAttempts = 0;
            
            const MAX_MAPS_COLLECTION_ATTEMPTS = isSearchAll ? 10 : 5;
            const MAX_TOTAL_RAW_URLS_TO_PROCESS = isSearchAll ? 750 : Math.max(count * 5, 50);

            socket.emit('log', `[Server] Target: ${isIndividualSearch ? 'all matching' : targetDisplay} businesses. Max unique URLs to process: ${MAX_TOTAL_RAW_URLS_TO_PROCESS}.`);

            while (allProcessedBusinesses.length < targetCount && mapsCollectionAttempts < MAX_MAPS_COLLECTION_ATTEMPTS && processedUrlSet.size < MAX_TOTAL_RAW_URLS_TO_PROCESS) {
                mapsCollectionAttempts++;
                const remainingToFind = isSearchAll ? 50 : targetCount - allProcessedBusinesses.length;
                const rawUrlsToCollectThisAttempt = Math.max(remainingToFind, 20);
                const availableSlots = MAX_TOTAL_RAW_URLS_TO_PROCESS - processedUrlSet.size;
                const finalRawUrlsTarget = Math.min(rawUrlsToCollectThisAttempt, availableSlots);

                if (finalRawUrlsTarget <= 0) break;

                socket.emit('log', `\nLEVEL 1 (Attempt ${mapsCollectionAttempts}/${MAX_MAPS_COLLECTION_ATTEMPTS}): Collecting up to ${finalRawUrlsTarget} new URLs...`);
                const newlyDiscoveredUrls = await collectGoogleMapsUrlsContinuously(page, searchQuery, socket, finalRawUrlsTarget, processedUrlSet);

                if (newlyDiscoveredUrls.length === 0) {
                    socket.emit('log', `   -> No new unique URLs found. Ending collection attempts.`);
                    break;
                }
                socket.emit('log', `-> Discovered ${newlyDiscoveredUrls.length} new listings. Total unique discovered: ${processedUrlSet.size}.`);

                for (const urlToProcess of newlyDiscoveredUrls) {
                    if (allProcessedBusinesses.length >= targetCount) break;
                    
                    totalRawUrlsAttemptedDetails++;
                    
                    const progressStatus = isSearchAll 
                        ? `Total added: ${allProcessedBusinesses.length}`
                        : `Added: ${allProcessedBusinesses.length}/${finalCount}`;
                    socket.emit('log', `--- Processing business #${totalRawUrlsAttemptedDetails} of ${processedUrlSet.size} discovered | ${progressStatus} ---`);

                    let googleData, websiteData = {};
                    try {
                        googleData = await scrapeGoogleMapsDetails(page, urlToProcess, socket, country);
                        if (googleData.Website) {
                            websiteData = await scrapeWebsiteForGoldData(page, googleData.Website, socket);
                        }
                    } catch (detailError) {
                        socket.emit('log', `Error processing URL (${urlToProcess}): ${detailError.message.split('\n')[0]}. Skipping.`, 'error');
                        continue;
                    }

                    const fullBusinessData = { ...googleData, ...websiteData };

                    if (isIndividualSearch) {
                        fullBusinessData.Category = googleData.ScrapedCategory || 'N/A';
                    } else {
                        fullBusinessData.Category = category;
                    }

                    allProcessedBusinesses.push(fullBusinessData);
                    socket.emit('log', `-> ADDED: ${fullBusinessData.BusinessName || 'N/A'}.`);

                    socket.emit('progress_update', {
                        processed: totalRawUrlsAttemptedDetails,
                        discovered: processedUrlSet.size,
                        added: allProcessedBusinesses.length,
                        target: finalCount
                    });
                }
            }

            if (allProcessedBusinesses.length < count && !isSearchAll && !isIndividualSearch) {
                socket.emit('log', `Warning: Only found ${allProcessedBusinesses.length} prospects out of requested ${count}.`, 'warning');
            }

            socket.emit('log', `Scraping completed. Found and processed a total of ${allProcessedBusinesses.length} businesses.`);
            await browser.close();
            socket.emit('scrape_complete', allProcessedBusinesses);

        } catch (error) {
            console.error('A critical error occurred:', error);
            if (browser) await browser.close();
            socket.emit('scrape_error', { error: `Critical failure: ${error.message.split('\n')[0]}` });
        }
    });

    socket.on('disconnect', () => console.log(`Client disconnected: ${socket.id}`));
});

async function collectGoogleMapsUrlsContinuously(page, searchQuery, socket, maxUrlsToCollectThisBatch, processedUrlSet) {
    const newlyDiscoveredUrls = [];
    const resultsContainerSelector = 'div[role="feed"]';
    
    await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2', timeout: 60000 });
    try {
        await page.waitForSelector('form[action^="https://consent.google.com"] button[aria-label="Accept all"]', { timeout: 15000 });
        await page.click('form[action^="https://consent.google.com"] button[aria-label="Accept all"]');
        socket.emit('log', '   -> Accepted Google consent dialog.');
    } catch (e) { /* Consent dialog may not appear */ }

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
        const currentVisibleUrls = await page.$$eval(`${resultsContainerSelector} a[href*="https://www.google.com/maps/place/"]`, links => links.map(link => link.href));
        let newUrlsFoundInIteration = 0;
        currentVisibleUrls.forEach(url => {
            if (!processedUrlSet.has(url)) { 
                processedUrlSet.add(url);
                newlyDiscoveredUrls.push(url); 
                urlsDiscoveredInThisBatch++;
                newUrlsFoundInIteration++;
            }
        });

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
        
        const hasNewUrls = newUrlsFoundInIteration > 0;
        const hasScrolledFurther = newScrollHeight > lastScrollHeight;

        if (hasNewUrls || hasScrolledFurther) {
            consecutiveNoProgressAttempts = 0; 
            if (hasNewUrls) {
                 socket.emit('log', `   -> Discovered ${newUrlsFoundInIteration} new URLs. Total in batch: ${urlsDiscoveredInThisBatch}/${maxUrlsToCollectThisBatch}.`);
            }
        } else {
            consecutiveNoProgressAttempts++;
            socket.emit('log', `   -> No new URLs or scroll progress. Attempt ${consecutiveNoProgressAttempts}/${MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS}.`);
        }
        lastScrollHeight = newScrollHeight;

        if (consecutiveNoProgressAttempts >= MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS) {
            socket.emit('log', `   -> Max consecutive attempts without progress reached. Assuming end of results.`);
            break; 
        }
    }
    socket.emit('log', `   -> Finished Maps collection attempt. Found ${urlsDiscoveredInThisBatch} new URLs after ${totalScrollsMade} scrolls.`);
    return newlyDiscoveredUrls; 
}


async function scrapeGoogleMapsDetails(page, url, socket, country) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
        await page.waitForSelector('h1', {timeout: 60000});
        
        // --- START: NEW WAITING LOGIC ---
        // Explicitly wait for the category element to appear on the page before trying to scrape.
        // Use a try-catch block so if a business has no category, it won't crash the scrape.
        try {
            await page.waitForSelector('[jsaction*="category"]', { timeout: 5000 }); // Wait up to 5 seconds
        } catch (e) {
            socket.emit('log', '   -> Warning: Could not find category element for this business.');
        }
        // --- END: NEW WAITING LOGIC ---

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
                } else if (!cleaned.startsWith('61') && cleaned.length >= 8 && cleaned.length <= 10) {
                    cleaned = '61' + cleaned;
                }
            }
            return cleaned.startsWith('+') ? cleaned.substring(1) : cleaned; 
        };

        return {
            BusinessName: cleanText(document.querySelector('h1')?.innerText),
            ScrapedCategory: cleanText(document.querySelector('[jsaction*="category"]')?.innerText),
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
            socket.emit('log', '   -> No specific "About Us/Contact" page found, searching current page.');
        }

        const pageText = await page.evaluate(() => document.body.innerText);
        const textLines = pageText.split('\n');

        for (const line of textLines) {
            for (const title of ownerTitleKeywords) {
                if (line.toLowerCase().includes(title)) {
                    let potentialName = line.split(new RegExp(title, 'i'))[0].trim().replace(/,$/, '');
                    potentialName = potentialName.replace(/^(the|a|an)\s+/i, '').trim();
                    const wordsInName = potentialName.split(' ').filter(word => word.length > 0);
                    const looksLikeName = wordsInName.length >= 2 && wordsInName.length <= 4 && potentialName.length > 3 && wordsInName.every(word => word[0] === word[0].toUpperCase() || word.length <= 3);
                    const isGeneric = genericWords.some(word => potentialName.toLowerCase().includes(word));
                    
                    if (looksLikeName && !isGeneric) {
                        data.OwnerName = potentialName;
                        break;
                    }
                }
            }
            if (data.OwnerName) break;
        }

        const currentLinks = await page.$$eval('a', (links) => links.map(a => a.href));
        data.InstagramURL = currentLinks.find(href => href.includes('instagram.com')) || '';
        data.FacebookURL = currentLinks.find(href => href.includes('facebook.com')) || '';
        
        const mailtoLink = currentLinks.find(href => href.startsWith('mailto:'));
        data.Email = mailtoLink ? mailtoLink.replace('mailto:', '').split('?')[0] : '';
        if (!data.Email) {
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const emailsInText = pageText.match(emailRegex) || [];
            const personalEmail = emailsInText.find(email => !['info@', 'contact@', 'support@', 'sales@', 'admin@'].some(prefix => email.startsWith(prefix)) && !email.includes('wix.com') && !email.includes('squarespace.com'));
            data.Email = personalEmail || emailsInText[0] || '';
        }

    } catch (error) {
        socket.emit('log', `   -> Could not fully scrape ${websiteUrl}. Error: ${error.message.split('\n')[0]}`);
    }
    return data;
}

server.listen(PORT, () => {
    console.log(`Scraping server running on http://localhost:${PORT}`);
});