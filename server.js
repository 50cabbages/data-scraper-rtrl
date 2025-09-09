// server.js (v5 - Final Version with Data Cleaning and Owner Search)
const express = require('express');
const puppeteer =require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.post('/api/scrape', async (req, res) => {
    const { category, location, count } = req.body;
    const searchQuery = `${category} in ${location}`;
    console.log(`Starting final scrape for: ${searchQuery}`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, // Set to 'false' to watch the magic happen
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=en-US,en']
        });
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en' });

        console.log('LEVEL 1: Getting business URLs from search results...');
        const businessUrls = await getBusinessListingURLs(page, searchQuery, count);
        console.log(`-> Found ${businessUrls.length} potential business URLs.`);

        const allBusinessData = [];
        for (let i = 0; i < businessUrls.length; i++) {
            const url = businessUrls[i];
            console.log(`\n--- Processing Business ${i + 1} of ${businessUrls.length} ---`);

            console.log(`LEVEL 2: Getting details from Google Maps page...`);
            const googleData = await scrapeGoogleMapsDetails(page, url);
            console.log(`-> Found Business: ${googleData.BusinessName}`);

            let websiteData = {};
            if (googleData.Website) {
                console.log(`LEVEL 3: Visiting website (${googleData.Website}) to find contacts and owner...`);
                websiteData = await scrapeWebsiteForGoldData(page, googleData.Website);
                console.log(`-> Owner: ${websiteData.OwnerName || 'Not found'}, Email: ${websiteData.Email || 'None'}`);
            } else {
                console.log(`LEVEL 3: Skipped, no website found.`);
            }

            allBusinessData.push({ ...googleData, ...websiteData });
        }

        console.log(`\n✅ Scraping complete. Closing browser.`);
        await browser.close();
        res.json(allBusinessData);

    } catch (error) {
        console.error('A critical error occurred:', error);
        if (browser) await browser.close();
        res.status(500).json({ error: 'Failed to scrape data.' });
    }
});

async function getBusinessListingURLs(page, searchQuery, maxCount) {
    // This function remains largely the same
    await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2' });
    try {
        await page.waitForSelector('button[aria-label="Accept all"]', { timeout: 5000 });
        await page.click('button[aria-label="Accept all"]');
    } catch (e) { /* ignore */ }
    await page.type('#searchboxinput', searchQuery);
    await page.click('#searchbox-searchbutton');
    const resultsContainerSelector = 'div[role="feed"]';
    await page.waitForSelector(resultsContainerSelector, { timeout: 20000 });
    let urls = new Set();
    let lastHeight = 0;
    while (urls.size < maxCount) {
        const newUrls = await page.$$eval(`${resultsContainerSelector} a[href*="https://www.google.com/maps/place/"]`, links => links.map(link => link.href));
        newUrls.forEach(url => urls.add(url));
        await page.evaluate(`document.querySelector('${resultsContainerSelector}').scrollTop = document.querySelector('${resultsContainerSelector}').scrollHeight`);
        await new Promise(r => setTimeout(r, 2000));
        const currentHeight = await page.evaluate(`document.querySelector('${resultsContainerSelector}').scrollHeight`);
        if (currentHeight === lastHeight) break;
        lastHeight = currentHeight;
    }
    return Array.from(urls).slice(0, maxCount);
}

async function scrapeGoogleMapsDetails(page, url) {
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('h1');
    
    return page.evaluate(() => {
        // *** UPGRADE 1: DATA CLEANING ***
        // This helper function removes icon characters and trims whitespace.
        const cleanText = (text) => {
            if (!text) return '';
            // This regex removes most non-printable characters and icon fonts.
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

async function scrapeWebsiteForGoldData(page, websiteUrl) {
    const data = { Email: '', InstagramURL: '', FacebookURL: '', OwnerName: '' };
    try {
        await page.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 25000 });

        // *** UPGRADE 2: INTELLIGENT OWNER SEARCH ***
        const aboutPageKeywords = ['about', 'team', 'our-story', 'who-we-are', 'meet-the-team'];
        const ownerTitleKeywords = ['owner', 'founder', 'director', 'co-founder', 'principal', 'manager'];
        
        let foundAboutLink = false;
        const allLinks = await page.$$eval('a', (links) => links.map(a => ({ href: a.href, text: a.innerText.toLowerCase() })));

        for (const keyword of aboutPageKeywords) {
            const aboutLink = allLinks.find(link => link.text.includes(keyword));
            if (aboutLink && aboutLink.href) {
                console.log(`   -> Found '${keyword}' page, navigating...`);
                await page.goto(aboutLink.href, { waitUntil: 'networkidle2' });
                foundAboutLink = true;
                break;
            }
        }
        if (!foundAboutLink) {
            console.log('   -> No specific "About Us" page found, searching homepage.');
        }

        const pageText = await page.evaluate(() => document.body.innerText);
        const textLines = pageText.split('\n');

        for (const line of textLines) {
            for (const title of ownerTitleKeywords) {
                if (line.toLowerCase().includes(title)) {
                    // This is a heuristic: assumes the name is on the same line, before the title.
                    const potentialName = line.split(new RegExp(title, 'i'))[0].trim();
                    // Simple validation: check if it looks like a name (e.g., has 1-3 words)
                    if (potentialName && potentialName.split(' ').length <= 3 && potentialName.length > 2) {
                        data.OwnerName = potentialName.replace(/,$/, '').trim(); // Remove trailing comma
                        break;
                    }
                }
            }
            if (data.OwnerName) break;
        }

        // Find Social and Email (using the full list of links from the first page load)
        data.InstagramURL = allLinks.find(link => link.href.includes('instagram.com'))?.href || '';
        data.FacebookURL = allLinks.find(link => link.href.includes('facebook.com'))?.href || '';
        const mailtoLink = allLinks.find(link => link.href.startsWith('mailto:'));
        data.Email = mailtoLink ? mailtoLink.href.replace('mailto:', '').split('?')[0] : '';
        if (!data.Email) {
            const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            data.Email = emailMatch ? emailMatch[0] : '';
        }

    } catch (error) {
        console.log(`   -> Could not fully scrape ${websiteUrl}. Error: ${error.message.split('\n')[0]}`);
    }
    return data;
}

app.listen(PORT, () => {
    console.log(`Scraping server (v5 - Final) running on http://localhost:${PORT}`);
});