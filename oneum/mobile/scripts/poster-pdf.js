const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1240, height: 1000 });
  await page.goto('file:///Users/jeondonghun/d-tech-2026/제출물/포스터.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  const h = await page.evaluate(() => document.querySelector('.poster').scrollHeight);
  await page.pdf({ path: '/Users/jeondonghun/d-tech-2026/제출물/포스터.pdf',
    width: '1240px', height: `${h}px`, printBackground: true, pageRanges: '1' });
  await browser.close();
})();
