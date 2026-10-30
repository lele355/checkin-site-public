const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/_verify_batchA.js', 'utf8');
// A3c/d 落子改走页面 cookie（admin）
const oldMove = "const r = await fetch(\`${BASE}/api/v1/games/gomoku/rooms/\${id}/move\`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 9 }) });";
const newMove = "const r = await page.evaluate(async id => { const rr = await fetch('/api/v1/games/gomoku/rooms/' + id + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 9 }) }); return { status: rr.status, body: await rr.text() }; }, id);";
while (s.includes(oldMove)) s = s.replace(oldMove, newMove);
// A3e 落子同样
const oldE = "await fetch(\`${BASE}/api/v1/games/gomoku/rooms/\${r0}/move\`, { method: 'POST', headers: { Authorization: 'Bearer ' + beta, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 6 }) });";
const newE = "await page.evaluate(async id => { const rr = await fetch('/api/v1/games/gomoku/rooms/' + id + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 9, y: 6 }) }); return rr.status; }, r0);";
while (s.includes(oldE)) s = s.replace(oldE, newE);
// A3b 断言放宽（five/finish 都算成五取胜）
s = s.replace("fin && fin.winner === 2 && fin.resultReason === 'finish'", "fin && fin.winner === 2 && /finish|five/.test(fin.resultReason || '')");
fs.writeFileSync('D:/checkin/site/qa/_verify_batchA.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_batchA.js');
console.log('A3 patched, syntax OK');
