'use strict';
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
    const svg = fs.readFileSync(path.join(__dirname, '../gala/assets/fundraising-mark.svg'), 'utf8');
    await page.setContent('<style>body{margin:0;background:transparent}svg{width:512px;height:512px}</style>' + svg);
    await page.screenshot({ path: path.join(__dirname, '../gala/assets/app-icon.png'), omitBackground: true });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
