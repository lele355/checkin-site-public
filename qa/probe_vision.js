// 探测 MiMo 模型是否支持图片输入（视觉），并验证它能不能正确读课表。
// 用法：node qa/probe_vision.js
const fs = require('fs');

const cfg = JSON.parse(fs.readFileSync('CheckinApp/appsettings.Local.json', 'utf8'));
const KEY = cfg.Ai?.ApiKey || '';
const IMG = process.argv[2] || 'C:/Users/An/Downloads/88303fd5-abd2-4920-8d30-6fc8f5a7bad2.png';

(async () => {
    if (!KEY) { console.error('没拿到 ApiKey'); process.exit(1); }
    const buf = fs.readFileSync(IMG);
    const b64 = buf.toString('base64');
    const mime = IMG.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    console.log(`图片 ${(buf.length / 1024).toFixed(0)} KB，base64 后 ${(b64.length / 1024).toFixed(0)} KB`);

    const body = {
        model: 'mimo-v2.6-flash',
        max_tokens: 400,
        messages: [
            { role: 'system', content: '你是课程表识别助手，只根据图片内容回答。' },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
                    { type: 'text', text: '这张课表里「星期三 第二大节」是什么课？把课程名、教师、周次、地点四样都答出来，不要答别的格子。' },
                ],
            },
        ],
    };

    const t0 = Date.now();
    const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log('HTTP', res.status, `${Date.now() - t0}ms`);
    console.log(text.slice(0, 1200));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
