// server.js (v21 - On-the-Fly Deduplication)
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

// --- NEW/UPDATED HELPER FUNCTIONS FOR SERVER-SIDE VALIDATION ---

function cleanPhoneNumberServer(rawPhone) {
    if (!rawPhone) return '';
    const digits = rawPhone.replace(/\D/g, ''); 
    if (rawPhone.startsWith('+')) {
        return '+' + digits; 
    }
    return digits;
}

function isValidAUMobile(phoneNumber) {
    const cleaned = cleanPhoneNumberServer(phoneNumber);
    if ((cleaned.startsWith('+614') && cleaned.length === 12) || 
        (cleaned.startsWith('04') && cleaned.length === 10)) {    
        return true;
    }
    return false;
}

const GENERIC_EMAIL_PREFIXES = ['info', 'contact', 'hello', 'support', 'enquiries', 'sales', 'admin', 'customerservice'];
const EXCLUDE_EMAIL_DOMAINS = [
    'wix.com', 'squarespace.com', 'shopify.com', 'wordpress.com', 
    'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com',       
    // Add known shopping centre/market operator domains here if you have them:
    // 'westfield.com.au', 'vicinity.com.au', 'spt.com.au', 'jll.com', 'cbre.com'
];

function isBusinessEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const lowerEmail = email.toLowerCase().trim();

    if (!/\S+@\S+\.\S+/.test(lowerEmail)) {
        return false;
    }

    const [prefix, domain] = lowerEmail.split('@');

    if (GENERIC_EMAIL_PREFIXES.some(p => prefix === p || prefix.startsWith(p + '.'))) {
        if (EXCLUDE_EMAIL_DOMAINS.some(d => domain.includes(d.toLowerCase()))) {
             return false; 
        }
    }

    if (EXCLUDE_EMAIL_DOMAINS.some(d => domain.includes(d.toLowerCase()))) {
        return false;
    }

    return true;
}


io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.emit('log', `[Server] Connected to Real-time Scraper.`);

    socket.on('start_scrape', async ({ category, location, count }) => {
        const searchQuery = `${category} in ${location}`;
        socket.emit('log', `[Server] Starting search for ${count} *qualified* "${category}" prospects in "${location}"`);
        
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true, 
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US,en']
            });
            const page = await browser.newPage();
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en' });

            let qualifiedBusinesses = []; // Final list of unique qualified businesses
            const allUniqueRawUrlsCollected = new Set(); // Stores all unique raw URLs found from Maps across all batches
            const seenQualifiedBusinessIdentifiers = new Set(); // Stores identifiers of already qualified+deduplicated businesses
            let totalRawUrlsProcessedForQualification = 0; // Total count of raw URLs that went through detailed scraping
            
            const MAX_TOTAL_RAW_URLS_OVERALL_PROCESSING_LIMIT = Math.max(count * 60, 1500); 
            const MAX_SCROLL_BATCH_SIZE_PER_ATTEMPT = Math.max(count * 5, 50); 

            // Navigate to Google Maps search page once at the start
            await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2', timeout: 60000 });
            try {
                await page.waitForSelector('form[action^="https://consent.google.com"] button[aria-label="Accept all"]', { timeout: 15000 });
                await page.click('form[action^="https://consent.google.com"] button[aria-label="Accept all"]');
                socket.emit('log', '   -> Accepted Google consent dialog.');
            } catch (e) { /* ignore */ }
            await page.type('#searchboxinput', searchQuery);
            await page.click('#searchbox-searchbutton');
            try {
                await page.waitForSelector('div[role="feed"]', { timeout: 45000 });
                socket.emit('log', `   -> Initial Google Maps search results container loaded for "${searchQuery}".`);
            } catch (error) {
                socket.emit('log', `❌ Error: Google Maps results container not found after search for "${searchQuery}". Cannot proceed.`, 'error');
                await browser.close();
                socket.emit('scrape_complete', []); 
                return;
            }

            let searchAttempts = 0;
            const MAX_SEARCH_ATTEMPTS = 20; 
            
            while (qualifiedBusinesses.length < count && totalRawUrlsProcessedForQualification < MAX_TOTAL_RAW_URLS_OVERALL_PROCESSING_LIMIT && searchAttempts < MAX_SEARCH_ATTEMPTS) {
                searchAttempts++;
                socket.emit('log', `\nLEVEL 1: Attempt ${searchAttempts} - Collecting new batch of raw Google Maps URLs (targeting ~${MAX_SCROLL_BATCH_SIZE_PER_ATTEMPT} unique listings)...`);
                
                const newRawUrlsInBatch = await collectGoogleMapsUrlsBatch(
                    page, 
                    socket, 
                    MAX_SCROLL_BATCH_SIZE_PER_ATTEMPT, 
                    allUniqueRawUrlsCollected 
                );
                
                if (newRawUrlsInBatch.length === 0) {
                    socket.emit('log', `   -> No NEW raw listings found in this batch after scrolling. Assuming end of results in this area.`);
                    break; 
                }
                
                socket.emit('log', `LEVEL 2: Starting detailed scraping and qualification of ${newRawUrlsInBatch.length} new raw listings from this batch...`);
                
                for (const urlToProcess of newRawUrlsInBatch) {
                    // Increment raw URLs processed regardless of outcome, before potential break
                    totalRawUrlsProcessedForQualification++;

                    // Check if we've met the target BEFORE processing the current URL in detail
                    if (qualifiedBusinesses.length >= count || totalRawUrlsProcessedForQualification >= MAX_TOTAL_RAW_URLS_OVERALL_PROCESSING_LIMIT) {
                        socket.emit('log', `   -> Target qualified prospects (${count}) met OR overall raw URL processing limit (${MAX_TOTAL_RAW_URLS_OVERALL_PROCESSING_LIMIT}) reached. Stopping further detailed processing in this batch.`);
                        break; // Break out of the for loop
                    }

                    socket.emit('log', `\n--- Processing Raw Business (Overall: ${totalRawUrlsProcessedForQualification}/${MAX_TOTAL_RAW_URLS_OVERALL_PROCESSING_LIMIT}) (Qualified: ${qualifiedBusinesses.length}/${count}) ---`);
                    
                    let googleData = null;
                    try {
                        googleData = await scrapeGoogleMapsDetails(page, urlToProcess, socket);
                        socket.emit('log', `-> Business: ${googleData.BusinessName || 'N/A'}`);
                    } catch (detailError) {
                        socket.emit('log', `❌ Error getting details from Maps page (${urlToProcess}): ${detailError.message.split('\n')[0]}. Skipping this URL.`, 'error');
                        // Do not call progress_update here, as it's not a qualified business
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
                    
                    const cleanedPhone = cleanPhoneNumberServer(fullBusinessData.Phone);
                    const cleanedEmail = fullBusinessData.Email ? fullBusinessData.Email.trim() : '';

                    let qualificationMessages = [];
                    const isPhoneValid = isValidAUMobile(cleanedPhone);
                    const isEmailValid = isBusinessEmail(cleanedEmail);

                    // A business is 'qualified' if it has AT LEAST ONE valid contact method
                    if (isPhoneValid || isEmailValid) { 
                        fullBusinessData.Phone = cleanedPhone; // Always store cleaned phone for consistency

                        // --- ON-THE-FLY DEDUPLICATION ---
                        const identifier = `${(fullBusinessData.BusinessName || '').toLowerCase().trim()}_${(fullBusinessData.Website || '').toLowerCase().trim()}`;
                        if (identifier && !seenQualifiedBusinessIdentifiers.has(identifier)) { // Check if not seen before
                            seenQualifiedBusinessIdentifiers.add(identifier);
                            qualifiedBusinesses.push(fullBusinessData);
                            socket.emit('log', `✅ QUALIFIED: Business meets AU mobile OR business email criteria! (Unique Qualified: ${qualifiedBusinesses.length}/${count})`);
                        } else if (identifier) { // This is a duplicate (same name+website)
                            socket.emit('log', `   -> Duplicate detected (BusinessName+Website): ${fullBusinessData.BusinessName}. Skipping adding to qualified list.`);
                        } else { // Business data missing critical info for unique identification
                            socket.emit('log', `   -> Qualified, but missing BusinessName/Website for unique identification. Skipping.`);
                        }
                    } else { // Not qualified at all
                        if (!isPhoneValid) qualificationMessages.push('no valid AU mobile (04 prefix, 10 digits)');
                        if (!isEmailValid) qualificationMessages.push('no valid business email (e.g., generic or free email)');
                        socket.emit('log', `   SKIPPED: Business does not meet ANY primary contact criteria (${qualificationMessages.join(' and ')}).`);
                    }

                    // Update progress bar after processing each raw business (whether qualified or skipped)
                    socket.emit('progress_update', { 
                        qualifiedFound: qualifiedBusinesses.length, // This is now always the *unique* qualified count
                        qualifiedTarget: count
                    });
                } // End of for loop for newRawUrlsInBatch
            } // End of while loop for batch processing
            
            // --- Final Deduplication is NO LONGER NEEDED here, as it's done on-the-fly ---
            // qualifiedBusinesses already contains only unique qualified entries

            if (qualifiedBusinesses.length < count) {
                socket.emit('log', `⚠️ Warning: Could only find ${qualifiedBusinesses.length} qualified prospects out of requested ${count} within the search limits.`, 'warning');
            } else if (totalRawUrlsProcessedForQualification >= MAX_TOTAL_RAW_URLS_OVERALL_PROCESSING_LIMIT) {
                socket.emit('log', `⚠️ Warning: Reached overall raw URL processing limit (${MAX_TOTAL_RAW_URLS_OVERALL_PROCESSING_LIMIT}) before finding all ${count} qualified prospects. Found ${qualifiedBusinesses.length}.`, 'warning');
            }
            
            socket.emit('log', `\n✅ Scraping session completed. Found ${qualifiedBusinesses.length} qualified prospects (Target: ${count}). Closing browser.`);
            await browser.close();
    
            const finalCleanedQualifiedBusinesses = qualifiedBusinesses.map(b => ({
                ...b,
                Phone: cleanPhoneNumberServer(b.Phone)
            }));

            socket.emit('scrape_complete', finalCleanedQualifiedBusinesses);

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

// --- UNCHANGED HELPER FUNCTIONS (collectGoogleMapsUrlsBatch, scrapeGoogleMapsDetails, scrapeWebsiteForGoldData) ---
async function collectGoogleMapsUrlsBatch(page, socket, batchTargetSize, existingUniqueUrls) {
    const resultsContainerSelector = 'div[role="feed"]';
    const newUrlsFoundInThisBatch = []; 
    
    let lastScrollHeight = 0;
    let consecutiveNoProgressAttempts = 0;
    const MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS = 12; 
    const MAX_TOTAL_SCROLL_ATTEMPTS_PER_BATCH = 30; 
    let scrollsMadeInBatch = 0;

    socket.emit('log', `   -> Current unique raw URLs found so far: ${existingUniqueUrls.size}.`);

    while (newUrlsFoundInThisBatch.length < batchTargetSize && scrollsMadeInBatch < MAX_TOTAL_SCROLL_ATTEMPTS_PER_BATCH && consecutiveNoProgressAttempts < MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS) {
        const initialTotalUniqueUrlCount = existingUniqueUrls.size;

        const currentVisibleUrls = await page.$$eval(`${resultsContainerSelector} a[href*="https://www.google.com/maps/place/"]`, links => links.map(link => link.href));
        
        currentVisibleUrls.forEach(url => {
            if (!existingUniqueUrls.has(url)) {
                existingUniqueUrls.add(url);
                newUrlsFoundInThisBatch.push(url);
            }
        });

        const newUniqueUrlsAddedInThisIteration = existingUniqueUrls.size - initialTotalUniqueUrlCount;
        
        const containerHandle = await page.$(resultsContainerSelector);
        if (!containerHandle) {
            socket.emit('log', `❌ Error: Google Maps results container disappeared during scroll check. Stopping batch collection.`);
            break;
        }

        await page.evaluate(selector => {
            const el = document.querySelector(selector);
            if (el) el.scrollTop = el.scrollHeight;
        }, resultsContainerSelector);
        await new Promise(r => setTimeout(r, 3000)); 

        scrollsMadeInBatch++;
        const newScrollHeight = await page.evaluate(selector => document.querySelector(selector)?.scrollHeight || 0, resultsContainerSelector);
        
        const hasNewUrls = newUniqueUrlsAddedInThisIteration > 0;
        const hasScrolledFurther = newScrollHeight > lastScrollHeight;

        if (hasNewUrls || hasScrolledFurther) {
            consecutiveNoProgressAttempts = 0;
            socket.emit('log', `   -> Batch Progress: Found ${newUniqueUrlsAddedInThisIteration} NEW URLs. Total NEW in batch: ${newUrlsFoundInThisBatch.length}/${batchTargetSize}. Scroll height ${hasScrolledFurther ? 'increased.' : 'unchanged.'}. Total unique overall: ${existingUniqueUrls.size}.`);
        } else {
            consecutiveNoProgressAttempts++;
            socket.emit('log', `   -> No new unique URLs and no scroll height change detected in this scroll. Consecutive attempts: ${consecutiveNoProgressAttempts}/${MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS}. (Scrolls in batch: ${scrollsMadeInBatch}/${MAX_TOTAL_SCROLL_ATTEMPTS_PER_BATCH})`);
        }
        lastScrollHeight = newScrollHeight;

        if (consecutiveNoProgressAttempts >= MAX_CONSECUTIVE_NO_PROGRESS_ATTEMPTS) {
            socket.emit('log', `   -> Max consecutive attempts without any progress in this batch reached. Assuming no more results for now. Breaking batch collection.`);
            break; 
        }
    }
    socket.emit('log', `   -> Batch collection complete. Collected ${newUrlsFoundInThisBatch.length} NEW unique raw listings. Total unique overall: ${existingUniqueUrls.size}.`);
    if (scrollsMadeInBatch >= MAX_TOTAL_SCROLL_ATTEMPTS_PER_BATCH) {
        socket.emit('log', `⚠️ Warning: Reached maximum scroll attempts for this batch (${MAX_TOTAL_SCROLL_ATTEMPTS_PER_BATCH}). There might be more results than collected in this batch.`, 'warning');
    }
    return newUrlsFoundInThisBatch;
}


async function scrapeGoogleMapsDetails(page, url, socket) {
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('h1', {timeout: 45000});
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
        await page.goto(websiteUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        const aboutPageKeywords = ['about', 'team', 'our-story', 'who-we-are', 'meet-the-team', 'contact'];
        const ownerTitleKeywords = ['owner', 'founder', 'director', 'co-founder', 'principal', 'manager', 'proprietor']; 
        
        let foundAboutLink = false;
        const allLinksOnCurrentPage = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));
        
        for (const keyword of aboutPageKeywords) {
            const aboutLink = allLinksOnCurrentPage.find(link => link.text.includes(keyword) && link.href.startsWith('http'));
            if (aboutLink && aboutLink.href) {
                socket.emit('log', `   -> Found '${keyword}' page link, navigating to: ${aboutLink.href}...`);
                await page.goto(aboutLink.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
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
                const potentialNameMatch = line.match(new RegExp(`([A-Z][a-z]+(?:\\s[A-Z][a-z]+){0,2})\\s*(?:[-,(])?\\s*${title}`, 'i'));
                if (potentialNameMatch && potentialNameMatch[1]) {
                    const potentialName = potentialNameMatch[1].trim();
                    if (potentialName.length > 2 && potentialName.split(' ').length <= 3) {
                         data.OwnerName = potentialName.replace(/,$/, '').trim(); 
                         break;
                    }
                }
            }
            if (data.OwnerName) break;
        }

        const currentLinks = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));

        data.InstagramURL = currentLinks.find(link => link.href.includes('instagram.com') && !link.href.includes('/feed/') && !link.href.includes('/share/'))?.href || '';
        data.FacebookURL = currentLinks.find(link => link.href.includes('facebook.com') && !link.href.includes('/sharer.php') && !link.href.includes('/plugins/'))?.href || '';
        
        const mailtoLink = currentLinks.find(link => link.href.startsWith('mailto:'));
        data.Email = mailtoLink ? mailtoLink.href.replace('mailto:', '').split('?')[0] : '';
        if (!data.Email) {
            const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g);
            if (emailMatch && emailMatch.length > 0) {
                const filteredEmails = emailMatch.filter(em => 
                    !em.includes('wix.com') && !em.includes('squarespace.com') &&
                    !em.includes('shopify.com') && !em.includes('wordpress.com') 
                );
                data.Email = filteredEmails[0] || ''; 
            }
        }

    } catch (error) {
        socket.emit('log', `   -> Could not fully scrape ${websiteUrl}. Error: ${error.message.split('\n')[0]}`);
    }
    return data;
}

server.listen(PORT, () => {
    console.log(`Scraping server (v21 - On-the-Fly Deduplication) running on http://localhost:${PORT}`);
});