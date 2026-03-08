const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    // Capture and log console messages
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));

    // Capture page errors
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    try {
        await page.goto('file:///c:/Users/Mahesh/OneDrive/Desktop/Navigation/index.html', { waitUntil: 'networkidle0' });
        console.log("Page loaded successfully.");
    } catch (e) {
        console.log("Failed to load page:", e.message);
    }

    await browser.close();
})();
