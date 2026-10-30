// _patch_scan.js — C3/C5b/C6c 值级扫描改准：结构性剔除 state.pieces[].rank 后再扫描
const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/qa_suite_280_api.js', 'utf8');

// 1) RANKS 加 rank_bomb
s = s.replace(
    "'rank_battalion', 'rank_company', 'rank_platoon', 'rank_engineer', 'rank_mine', 'rank_flag'];",
    "'rank_battalion', 'rank_company', 'rank_platoon', 'rank_engineer', 'rank_mine', 'rank_flag', 'rank_bomb'];"
);

// 2) v2r 加 13
s = s.replace(
    "11: 'rank_mine', 12: 'rank_flag' };",
    "11: 'rank_mine', 12: 'rank_flag', 13: 'rank_bomb' };"
);

// 3) 插入 stripPieceRanks 助手（放在 RANKS 定义后）
s = s.replace(
    "async function testArmychess() {",
    `// 值级扫描的合法身份出口只有一处：state.pieces[].rank（己方可见+已参战公开）。
// 扫描前把这份出口结构性剔除（不是把己方 rank 加白名单——那会被同名 rank 掩盖真泄露），
// 对"去身份化全文"断言：对方未公开 rank token 一个都不出现。
function stripPieceRanks(snapObj) {
    const clone = JSON.parse(JSON.stringify(snapObj));
    const pieces = clone.state && clone.state.pieces;
    if (Array.isArray(pieces)) for (const p of pieces) delete p.rank;
    return JSON.stringify(clone);
}

async function testArmychess() {`
);

// 4) C3 扫描改用剔除后全文
s = s.replace(
    `let leaked = [];
    for (const rk of scanRanks) {
        if (rawHost.includes('"' + rk + '"') || rawHost.includes(rk)) leaked.push(rk);
    }`,
    `const hostStripped = stripPieceRanks(host);
    let leaked = [];
    for (const rk of scanRanks) {
        if (hostStripped.includes(rk)) leaked.push(rk);
    }`
);

// 5) C5b 同样
s = s.replace(
    `const gLeaked = [...gScan].filter(rk => rawGuest.includes(rk));`,
    `const guestStripped = stripPieceRanks(guest);
    const gLeaked = [...gScan].filter(rk => guestStripped.includes(rk));`
);

// 6) C6c observer：用未公开 token 集（双方）+ 剔除后全文
s = s.replace(
    `const oRaw = JSON.stringify(obs);
    const oLeaked = RANKS.filter(rk => oRaw.includes(rk));`,
    `// observer 无己方；扫描集 = 双方未参战子 token − battle 已公开
    const oScan = new Set();
    for (const [pos, info] of Object.entries(truth)) {
        if (revealedCoords.has(pos)) continue;
        if (publicRanks.has(info.rank)) continue;
        oScan.add(info.rank);
    }
    const obsStripped = stripPieceRanks(obs);
    const oLeaked = [...oScan].filter(rk => obsStripped.includes(rk));`
);

fs.writeFileSync('D:/checkin/site/qa/qa_suite_280_api.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/qa_suite_280_api.js');
console.log('patched, rank_bomb in RANKS:', s.includes("'rank_bomb']"), ', strip helper:', s.includes('function stripPieceRanks'));
