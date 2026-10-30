const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/_verify_b_ui.js', 'utf8');
// 1) admin 确认布阵后：beta 随机布阵 → playing
s = s.replace(
    "    const st = await page.evaluate(async id2 => { const r = await fetch('/api/v1/games/armychess/rooms/' + id2, { credentials: 'same-origin' }); return (await r.json()).data; }, id);\n    T('确认布阵 → playing（beta 已布）', st.status === 'playing', `status=${st.status} done=${JSON.stringify(st.state.deployDone)}`);",
    "    await fetch(`${BASE}/api/v1/games/armychess/rooms/${id}/deploy`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: JSON.stringify({ random: true }) });\n    await sleep(800);\n    const st = await page.evaluate(async id2 => { const r = await fetch('/api/v1/games/armychess/rooms/' + id2, { credentials: 'same-origin' }); return (await r.json()).data; }, id);\n    T('admin 确认布阵 + beta 随机布 → playing', st.status === 'playing', `status=${st.status} done=${JSON.stringify(st.state.deployDone)}`);"
);
// 2) 拓扑断言按实际渲染标记
s = s.replace(
    "            railThick: /stroke-width=\"?(4|5|6)/.test(html) || /stroke-width:\\s*(4|5|6)/.test(html),",
    "            railThick: html.includes('stroke-width=\"7\"') || /stroke-width=.?7/.test(html),"
);
s = s.replace(
    "            hasRankText: texts.some(t => /司令|军长|师长|工兵|炸弹|地雷|军旗/.test(t)),",
    "            campDenText: texts.some(t => t === '营') && texts.some(t => t.includes('大本营')),"
);
s = s.replace(
    "        T('拓扑渲染：山界标注 + 铁路粗线 + 军衔名可见', topo.hasMountain && topo.railThick && topo.hasRankText, JSON.stringify(topo));",
    "        T('拓扑渲染：山界标注 + 铁路粗线 + 行营/大本营标注', topo.hasMountain && topo.railThick && topo.campDenText, JSON.stringify(topo));"
);
// 3) 军衔名断言改到 playing 棋盘（两步走子之后）
s = s.replace(
    "        T('两步走子 POST {fx,fy,tx,ty} 服务端接受',",
    "        const playText = await page.evaluate(() => (document.querySelector('svg.gm-board').textContent || ''));\n        T('己方军衔名可见（司令/师长等）', /司令|军长|师长|旅长|团长|营长|连长|排长|工兵|地雷|炸弹/.test(playText), playText.slice(0, 60));\n        T('两步走子 POST {fx,fy,tx,ty} 服务端接受',"
);
fs.writeFileSync('D:/checkin/site/qa/_verify_b_ui.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_b_ui.js');
console.log('patched');
