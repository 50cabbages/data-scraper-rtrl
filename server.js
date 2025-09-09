// server.js (v16 - Critical Fix for Endless Loop in URL Collection)
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
            let totalRawUrlsProcessed = 0; 
            const MAX_RAW_URLS_TO_PROCESS_SAFETY_LIMIT = Math.max(count * 25, 600); // Increased safety limit for raw URLs

            socket.emit('log', `LEVEL 1: Collecting all unique Google Maps business URLs by continuous scrolling...`);
            const allUniqueGoogleMapsUrls = await collectGoogleMapsUrlsContinuously(page, searchQuery, socket);
            socket.emit('log', `-> Finished collecting initial URLs from Google Maps. Found ${allUniqueGoogleMapsUrls.length} unique raw listings.`);

            if (allUniqueGoogleMapsUrls.length === 0) {
                socket.emit('log', `⚠️ Warning: No initial business listings found for "${searchQuery}". Cannot proceed with detailed scraping.`, 'warning');
                await browser.close();
                socket.emit('scrape_complete', []); 
                return;
            }

            socket.emit('log', `LEVEL 2: Starting detailed scraping and qualification of ${allUniqueGoogleMapsUrls.length} raw listings...`);
            
            for (const urlToProcess of allUniqueGoogleMapsUrls) {
                if (qualifiedBusinesses.length >= count || totalRawUrlsProcessed >= MAX_RAW_URLS_TO_PROCESS_SAFETY_LIMIT) {
                    socket.emit('log', `   -> Target (${count}) met or max raw URLs processed (${MAX_RAW_URLS_TO_PROCESS_SAFETY_LIMIT}) reached. Stopping further processing.`);
                    break;
                }

                totalRawUrlsProcessed++;
                socket.emit('log', `\n--- Processing Raw Business ${totalRawUrlsProcessed} (Qualified: ${qualifiedBusinesses.length}/${count}) ---`);
                
                let googleData = null;
                try {
                    googleData = await scrapeGoogleMapsDetails(page, urlToProcess, socket);
                    socket.emit('log', `-> Business: ${googleData.BusinessName || 'N/A'}`);
                } catch (detailError) {
                    socket.emit('log', `❌ Error getting details from Maps page (${urlToProcess}): ${detailError.message.split('\n')[0]}. Skipping this URL.`, 'error');
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

                if (fullBusinessData.Email && fullBusinessData.Email.trim() !== '' &&
                    fullBusinessData.Phone && fullBusinessData.Phone.trim() !== '') {
                    qualifiedBusinesses.push(fullBusinessData);
                    socket.emit('log', `✅ QUALIFIED: Business meets email and phone criteria! (${qualifiedBusinesses.length}/${count})`);
                } else {
                    socket.emit('log', `   SKIPPED: Business does not have both email and phone.`);
                }

                socket.emit('progress_update', { 
                    qualifiedFound: qualifiedBusinesses.length,
                    qualifiedTarget: count
                });
            }
            
            if (qualifiedBusinesses.length < count) {
                socket.emit('log', `⚠️ Warning: Could only find ${qualifiedBusinesses.length} qualified prospects out of requested ${count} within the search limits.`, 'warning');
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

// --- REWORKED HELPER FUNCTION: Collects URLs by continuously scrolling Google Maps ---
async function collectGoogleMapsUrlsContinuously(page, searchQuery, socket) {
    const allUniqueUrls = new Set();
    const resultsContainerSelector = 'div[role="feed"]';
    
    await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2', timeout: 60000 }); // Increased timeout
    try {
        await page.waitForSelector('form[action^="https://consent.google.com"] button[aria-label="Accept all"]', { timeout: 15000 }); // Increased timeout
        await page.click('form[action^="https://consent.google.com"] button[aria-label="Accept all"]');
        socket.emit('log', '   -> Accepted Google consent dialog.');
    } catch (e) { /* ignore */ }

    await page.type('#searchboxinput', searchQuery);
    await page.click('#searchbox-searchbutton');

    try {
        await page.waitForSelector(resultsContainerSelector, { timeout: 45000 }); // Increased timeout
        socket.emit('log', `   -> Initial search results container loaded.`);
    } catch (error) {
        socket.emit('log', `❌ Error: Google Maps results container not found after search. Cannot collect URLs.`, 'error');
        return [];
    }

    let lastScrollHeight = 0;
    let consecutiveNoProgressAttempts = 0; // Counts iterations with no new URLs AND no scroll height change
    const MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS = 7; // Max attempts to try scrolling without any content/height change
    const MAX_TOTAL_SCROLL_ATTEMPTS = 150; // Absolute max scrolls to prevent infinite loop
    let totalScrollsMade = 0;
    const MAX_URLS_TO_COLLECT_FROM_MAPS_FEED = 1000; // Hard cap on total URLs to collect

    while (totalScrollsMade < MAX_TOTAL_SCROLL_ATTEMPTS && allUniqueUrls.size < MAX_URLS_TO_COLLECT_FROM_MAPS_FEED && consecutiveNoProgressAttempts < MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS) {
        const initialUniqueUrlCount = allUniqueUrls.size;

        // Extract all currently visible URLs
        const currentVisibleUrls = await page.$$eval(`${resultsContainerSelector} a[href*="https://www.google.com/maps/place/"]`, links => links.map(link => link.href));
        currentVisibleUrls.forEach(url => allUniqueUrls.add(url));

        const newUniqueUrlsAddedInThisIteration = allUniqueUrls.size - initialUniqueUrlCount;
        
        const containerHandle = await page.$(resultsContainerSelector);
        if (!containerHandle) {
            socket.emit('log', `❌ Error: Google Maps results container disappeared during scroll check. Stopping collection.`);
            break;
        }

        // --- Perform scroll and check for height change ---
        await page.evaluate(selector => {
            const el = document.querySelector(selector);
            if (el) el.scrollTop = el.scrollHeight;
        }, resultsContainerSelector);
        await new Promise(r => setTimeout(r, 3000)); // Increased time after scroll for content to load

        totalScrollsMade++;
        const newScrollHeight = await page.evaluate(selector => document.querySelector(selector)?.scrollHeight || 0, resultsContainerSelector);
        
        // --- Determine if any progress was made this iteration ---
        const hasNewUrls = newUniqueUrlsAddedInThisIteration > 0;
        const hasScrolledFurther = newScrollHeight > lastScrollHeight;

        if (hasNewUrls || hasScrolledFurther) {
            consecutiveNoProgressAttempts = 0; // Reset counter if any progress was made
            socket.emit('log', `   -> Progress: Found ${hasNewUrls ? newUniqueUrlsAddedInThisIteration + ' new URLs' : 'no new URLs'}. Scroll height ${hasScrolledFurther ? 'increased.' : 'unchanged.'}. Total unique: ${allUniqueUrls.size}.`);
        } else {
            consecutiveNoProgressAttempts++;
            socket.emit('log', `   -> No new unique URLs and no scroll height change detected. Consecutive attempts: ${consecutiveNoProgressAttempts}/${MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS}. (Total scrolls: ${totalScrollsMade}/${MAX_TOTAL_SCROLL_ATTEMPTS})`);
        }
        lastScrollHeight = newScrollHeight;

        if (consecutiveNoProgressAttempts >= MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS) {
            socket.emit('log', `   -> Max consecutive attempts without any progress (new URLs or scroll) reached. Assuming end of results in this area. Breaking.`);
            break; 
        }
    }
    socket.emit('log', `   -> Final URL collection phase complete. Found ${allUniqueUrls.size} unique raw listings after ${totalScrollsMade} scrolls.`);
    if (totalScrollsMade >= MAX_TOTAL_SCROLL_ATTEMPTS) {
        socket.emit('log', `⚠️ Warning: Reached maximum total scroll attempts (${MAX_TOTAL_SCROLL_ATTEMPTS}). There might be more results than collected.`, 'warning');
    }
    if (allUniqueUrls.size >= MAX_URLS_TO_COLLECT_FROM_MAPS_FEED) {
        socket.emit('log', `⚠️ Warning: Reached maximum URL collection limit (${MAX_URLS_TO_COLLECT_FROM_MAPS_FEED}) from Google Maps feed.`, 'warning');
    }
    return Array.from(allUniqueUrls);
}


async function scrapeGoogleMapsDetails(page, url, socket) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Increased timeout
        await page.waitForSelector('h1', {timeout: 45000}); // Increased timeout
    } catch (error) {
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
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }); // Increased timeout

        const aboutPageKeywords = ['about', 'team', 'our-story', 'who-we-are', 'meet-the-team', 'contact'];
        const ownerTitleKeywords = ['owner', 'founder', 'director', 'co-founder', 'principal', 'manager'];
        
        let foundAboutLink = false;
        const allLinksOnCurrentPage = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));
        
        for (const keyword of aboutPageKeywords) {
            const aboutLink = allLinksOnCurrentPage.find(link => link.text.includes(keyword) && link.href.startsWith('http'));
            if (aboutLink && aboutLink.href) {
                socket.emit('log', `   -> Found '${keyword}' page link, navigating to: ${aboutLink.href}...`);
                await page.goto(aboutLink.href, { waitUntil: 'domcontentloaded', timeout: 45000 }); // Increased timeout
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
    console.log(`Scraping server (v16 - Guaranteed Qualified Count) running on http://localhost:${PORT}`);
});