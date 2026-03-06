import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', (msg) => {
  console.log(`[console:${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  console.log(`[pageerror] ${err.stack || err.message}`);
});

const resp = await page.goto('http://localhost:5173/net-worth', { waitUntil: 'networkidle', timeout: 30000 });
console.log(`[goto] status=${resp?.status()}`);

const h1 = await page.textContent('h1').catch(() => null);
console.log(`[h1] ${h1}`);

await page.screenshot({ path: '/tmp/networth-debug.png', fullPage: true });
console.log('[screenshot] /tmp/networth-debug.png');

await browser.close();
