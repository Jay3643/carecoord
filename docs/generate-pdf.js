const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const htmlPath = 'file:///' + path.resolve(__dirname, 'user-manual.html').replace(/\\/g, '/');
  await page.goto(htmlPath, { waitUntil: 'networkidle0' });
  const outPath = path.resolve(__dirname, 'CareCoord-User-Manual.pdf');
  await page.pdf({
    path: outPath,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0.75in', bottom: '0.75in', left: '0.85in', right: '0.85in' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:8px;color:#8a9fb0;width:100%;text-align:center;padding:0 40px;">CareCoord User Manual &mdash; Seniority Healthcare</div>',
    footerTemplate: '<div style="font-size:8px;color:#8a9fb0;width:100%;text-align:center;padding:0 40px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
  });
  console.log('PDF generated:', outPath);
  await browser.close();
})();
