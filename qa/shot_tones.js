// 测试账号从环境变量取，仓库里不放真实口令：CHECKIN_ADMIN / CHECKIN_PW
const ADMIN = process.env.CHECKIN_ADMIN || 'admin';
const PW = process.env.CHECKIN_PW || 'ChangeMe!123456';
// shot_tones.js — 底色系目检：每套主题 × 6 档底色各截一张工作台局部，最后拼成一张总览图
const { chromium } = require('playwright');
const fs = require('fs');
const { execSync } = require('child_process');

const BASE = 'http://localhost:5188';
const OUT = 'D:/projects/checkin/qa/_tones';
const PY = 'C:/Users/An/AppData/Local/Programs/Python/Python314/python.exe';
const THEMES = ['editorial', 'neumorphism', 'natural', 'macos', 'clay'];

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const b = await chromium.launch({ channel: 'msedge' });
    const ctx = await b.newContext({ viewport: { width: 520, height: 340 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();

    await p.goto(BASE + '/Login');
    await p.fill('#Username', ADMIN);
    await p.fill('#Password', PW);
    await p.click('form button[type=submit]');
    await p.waitForLoadState('networkidle').catch(() => { });
    await p.goto(BASE + '/');
    await p.waitForTimeout(400);

    for (const th of THEMES) {
        await p.evaluate((t) => {
            document.documentElement.dataset.theme = t;
            document.documentElement.dataset.tone = '';
            if (window.applyTheme) window.applyTheme(t);
        }, th);
        await p.waitForTimeout(250);

        const tones = await p.evaluate(() => {
            const els = document.querySelectorAll('#toneDots .swatch');
            return [...els].map(e => e.dataset.tone);
        });
        // 面板没打开时 #toneDots 可能是空的，退回用内置表
        const list = tones.length ? tones : ['', 'mist', 'rose', 'wheat', 'sage', 'lilac'];
        for (let i = 0; i < Math.min(6, list.length); i++) {
            await p.evaluate(({ t, tn }) => {
                document.documentElement.dataset.theme = t;
                if (tn) document.documentElement.dataset.tone = tn; else delete document.documentElement.dataset.tone;
            }, { t: th, tn: list[i] });
            await p.waitForTimeout(220);
            await p.screenshot({ path: `${OUT}/${th}-${i}.png` });
        }
    }
    await b.close();

    // 用 PIL 拼成 5 行 × 6 列的对照图
    const py = `
import os
from PIL import Image, ImageDraw
rows, cols = ${THEMES.length}, 6
themes = ${JSON.stringify(THEMES)}
imgs = []
for th in themes:
    row = []
    for i in range(cols):
        f = os.path.join(r'${OUT}', f'{th}-{i}.png')
        im = Image.open(f).convert('RGB').resize((300, 196))
        row.append(im)
    imgs.append(row)
W, H = 300, 196
pad = 6
sheet = Image.new('RGB', (cols*W + (cols+1)*pad, rows*H + (rows+1)*pad), (250, 249, 246))
for r, row in enumerate(imgs):
    for c, im in enumerate(row):
        sheet.paste(im, (pad + c*(W+pad), pad + r*(H+pad)))
sheet.save(r'${OUT}/tones-grid.png')
print('grid', sheet.size)
`;
    console.log(execSync(`"${PY}" -c "${py.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }));
})();
