// make_icons.js — 用系统 Edge 把 icon.svg 渲染成 PWA 所需的 192/512 PNG（矢量渲染，边缘干净）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = 'D:/projects/checkin/CheckinApp/wwwroot/icons';
const SIZES = [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']];

(async () => {
    const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
    const b = await chromium.launch({ channel: 'msedge' });
    for (const [size, name] of SIZES) {
        const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>
            html,body{margin:0;padding:0;background:transparent}
            svg{display:block;width:${size}px;height:${size}px}
        </style></head><body>${svg}</body></html>`;
        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(DIR, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
        await page.close();
        const st = fs.statSync(path.join(DIR, name));
        console.log(`${name}  ${size}x${size}  ${(st.size / 1024).toFixed(1)}KB`);
    }
    await b.close();
})();
