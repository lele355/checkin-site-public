const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/_verify_283.js', 'utf8');
const oldMove = "await api('POST', `/api/v1/games/jungle/rooms/${id}/move`, { fx: 3, fy: 1, tx: 3, ty: 0 }, alpha);";
const newMove = "await page.evaluate(async id2 => { const r = await fetch('/api/v1/games/jungle/rooms/' + id2 + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fx: 3, fy: 1, tx: 3, ty: 0 }) }); return r.status; }, id);";
while (s.includes(oldMove)) s = s.replace(oldMove, newMove);
fs.writeFileSync('D:/checkin/site/qa/_verify_283.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_283.js');
console.log('P1b identity fixed');
