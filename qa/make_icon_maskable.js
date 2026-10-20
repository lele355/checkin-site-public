// make_icon_maskable.js — 生成 Android 自适应图标用的 maskable PNG
// 原理：安卓桌面会用系统形状（圆/方/水滴）裁切图标，只保证中间 80% 圆形区域可见。
// 所以这里把满幅底色铺满 512×512，再把白色图形整体缩到 80% 居中，
// 保证被裁成任何形状时图形都不会掉角（图标缺 maskable 时安卓会硬裁出白边）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DIR = 'D:/projects/checkin/CheckinApp/wwwroot/icons';
const SIZES = [[192, 'icon-maskable-192.png'], [512, 'icon-maskable-512.png']];

// 与 icon.svg 同一套渐变与图形，只是底色改成满幅、图形缩放 0.8 居中
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#13795F"/>
      <stop offset="1" stop-color="#0A5343"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(51.2,51.2) scale(0.8)">
    <rect x="112" y="150" width="288" height="250" rx="42" fill="none" stroke="#FFFFFF" stroke-width="30"/>
    <path d="M112 192a42 42 0 0 1 42-42h204a42 42 0 0 1 42 42v18H112z" fill="#FFFFFF"/>
    <rect x="186" y="96" width="34" height="74" rx="17" fill="#FFFFFF"/>
    <rect x="292" y="96" width="34" height="74" rx="17" fill="#FFFFFF"/>
    <path d="M180 302l52 52 108-116" fill="none" stroke="#FFFFFF" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

(async () => {
    const b = await chromium.launch({ channel: 'msedge' });
    for (const [size, name] of SIZES) {
        const page = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>
            html,body{margin:0;padding:0;background:transparent}
            svg{display:block;width:${size}px;height:${size}px}
        </style></head><body>${SVG}</body></html>`;
        await page.setContent(html, { waitUntil: 'load' });
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(DIR, name), clip: { x: 0, y: 0, width: size, height: size } });
        await page.close();
        const st = fs.statSync(path.join(DIR, name));
        console.log(`${name}  ${size}x${size}  ${(st.size / 1024).toFixed(1)}KB`);
    }
    await b.close();
})();
