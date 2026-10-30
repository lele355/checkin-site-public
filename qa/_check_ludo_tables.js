// _check_ludo_tables.js — 双端一致性 0.1：web boards/ludo.js ↔ App LudoBoard.kt 坐标表比对
const fs = require('fs');
const js = fs.readFileSync('D:/checkin/site/CheckinApp/wwwroot/js/boards/ludo.js', 'utf8');
const kt = fs.readFileSync('D:/checkin/app/app/src/main/java/cn/anlele/checkin/ui/games/LudoBoard.kt', 'utf8');

const jsRing = [...(js.match(/var RING = \[([\s\S]*?)\];/) || [''])[1].matchAll(/\[(\d+),\s*(\d+)\]/g)].map(m => [+m[1], +m[2]]);
const jsRun = [...(js.match(/var RUNWAY = \{([\s\S]*?)\};/) || [''])[1].matchAll(/\[(\d+),\s*(\d+)\]/g)].map(m => [+m[1], +m[2]]);
const ktRing = [...(kt.match(/ludoRing = listOf\(([\s\S]*?)\n\)/) || [''])[1].matchAll(/(\d+) to (\d+)/g)].map(m => [+m[1], +m[2]]);
const ktRun = [...(kt.match(/ludoRunway = mapOf\(([\s\S]*?)\n\)/) || [''])[1].matchAll(/(\d+) to (\d+)/g)].map(m => [+m[1], +m[2]]);

function cmp(name, a, b) {
    const ok = a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
    console.log(`${name}: web=${a.length} app=${b.length} -> ${ok ? '一致' : '不一致'}`);
    if (!ok) for (let i = 0; i < Math.max(a.length, b.length); i++)
        if (!a[i] || !b[i] || a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) console.log('  first diff @' + i, a[i], b[i]);
    return ok;
}
const r1 = cmp('RING 52 主环', jsRing, ktRing);
const r2 = cmp('RUNWAY 24 航道', jsRun, ktRun);
console.log('RESULT:', r1 && r2 ? 'PASS 双端坐标表一致' : 'FAIL');
process.exit(r1 && r2 ? 0 : 1);
