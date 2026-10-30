const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/_verify_b_api.js', 'utf8');
const a = s.indexOf('function validLayout');
const b = s.indexOf('// setup 事件（crafted 用');
const fn = `function validLayout(overrides, side) {
    const spec = [['rank_commander', 1], ['rank_army', 1], ['rank_division', 2], ['rank_brigade', 2], ['rank_regiment', 2], ['rank_battalion', 2], ['rank_company', 3], ['rank_platoon', 3], ['rank_engineer', 3], ['rank_mine', 3], ['rank_bomb', 2], ['rank_flag', 1]];
    const pieces = [];
    const used = new Set();
    const camps = new Set(['1,7', '3,7', '2,8', '1,9', '3,9']);
    function put(rank, x, y) { pieces.push({ x, y, rank }); used.add(x + ',' + y); }
    put('rank_flag', 1, 11);
    put('rank_mine', 0, 10); put('rank_mine', 4, 10); put('rank_mine', 2, 11);
    put('rank_bomb', 0, 7); put('rank_bomb', 4, 7);
    const pool = [];
    for (const [rank, n] of spec) {
        if (rank === 'rank_flag' || rank === 'rank_mine' || rank === 'rank_bomb') continue;
        for (let i = 0; i < n; i++) pool.push(rank);
    }
    for (let y = 6; y <= 11 && pool.length; y++) for (let x = 0; x <= 4 && pool.length; x++) {
        if (camps.has(x + ',' + y) || used.has(x + ',' + y)) continue;
        put(pool.shift(), x, y);
    }
    if (overrides) for (const o of overrides) {
        const idx = pieces.findIndex(p => p.rank === o.from);
        if (idx >= 0) pieces[idx] = { x: o.x, y: o.y, rank: o.rank || o.from };
    }
    if (side === 2) for (const p of pieces) { p.x = 4 - p.x; p.y = 11 - p.y; }
    return pieces;
}
`;
fs.writeFileSync('D:/checkin/site/qa/_verify_b_api.js', s.substring(0, a) + fn + '\n' + s.substring(b), 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_b_api.js');
console.log('validLayout rewritten');
