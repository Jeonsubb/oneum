const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1000, deviceScaleFactor: 2 });
  await page.goto('file:///Users/jeondonghun/d-tech-2026/제출물/포스터.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: '/Users/jeondonghun/d-tech-2026/제출물/포스터.png', fullPage: true });
  await browser.close();
})();
