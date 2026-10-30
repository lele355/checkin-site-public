const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/qa_suite_280_api.js', 'utf8');
const start = s.indexOf("section('LUDO");
const end = s.indexOf("section('ARMYCHESS");
let seg = s.substring(start, end);

seg = seg.replace(
    "craftMoves(rm.id, [\n            { t: 'setup', s: 1, p: 0, v: 55 }, { t: 'setup', s: 1, p: 1, v: 57 },\n            { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 2, p: 1, v: -1 },\n            { t: 'roll', s: 1, v: 3 },\n        ], { Turn: 1, Revision: 10 });",
    "craftMoves(rm.id, [\n            { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 49 },\n            { t: 'move', s: 1, p: 1, v: 6 }, { t: 'move', s: 1, p: 1, v: 51 },\n            { t: 'roll', s: 1, v: 3 },\n        ], { Turn: 1, Revision: 10 });"
);
seg = seg.replace(
    "craftMoves(rm.id, [\n            { t: 'setup', s: 1, p: 0, v: 55 }, { t: 'setup', s: 1, p: 1, v: 57 },\n            { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 2, p: 1, v: -1 },\n            { t: 'roll', s: 1, v: 2 },\n        ], { Turn: 1, Revision: 11 });",
    "craftMoves(rm.id, [\n            { t: 'move', s: 1, p: 0, v: 6 }, { t: 'move', s: 1, p: 0, v: 49 },\n            { t: 'move', s: 1, p: 1, v: 6 }, { t: 'move', s: 1, p: 1, v: 51 },\n            { t: 'roll', s: 1, v: 2 },\n        ], { Turn: 1, Revision: 11 });"
);
seg = seg.replace(
    "craftMoves(rm.id, [\n            { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 1, p: 1, v: -1 },\n            { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 2, p: 1, v: -1 },\n            { t: 'roll', s: 1, v: 3 },\n        ], { Turn: 1, Revision: 10 });",
    "craftMoves(rm.id, [{ t: 'roll', s: 1, v: 3 }], { Turn: 1, Revision: 10 });"
);
seg = seg.replace(
    "craftMoves(rm.id, [\n            { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 1, p: 1, v: -1 },\n            { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 2, p: 1, v: -1 },\n            { t: 'roll', s: 1, v: 6 },\n        ], { Turn: 1, Revision: 11 });",
    "craftMoves(rm.id, [{ t: 'roll', s: 1, v: 6 }], { Turn: 1, Revision: 11 });"
);
seg = seg.replace(
    "craftMoves(rm.id, [\n            { t: 'setup', s: 1, p: 0, v: -1 }, { t: 'setup', s: 1, p: 1, v: -1 },\n            { t: 'setup', s: 2, p: 0, v: -1 }, { t: 'setup', s: 2, p: 1, v: -1 },\n            { t: 'roll', s: 1, v: 2 },\n        ], { Turn: 1, Revision: 10 });",
    "craftMoves(rm.id, [{ t: 'roll', s: 1, v: 2 }], { Turn: 1, Revision: 10 });"
);

const loopStart = seg.indexOf('let guard = 0, finished = false');
const loopEnd = seg.indexOf("const s = await snap('ludo', rm.id, 'QA_alpha');", loopStart);
const newLoop = [
    "let guard = 0, finished = false, err = '';",
    "        while (guard++ < 500 && !finished) {",
    "            const s = await snap('ludo', rm.id, 'QA_alpha');",
    "            if (s.status === 'finished') { finished = true; break; }",
    "            const who = s.turn === 1 ? 'QA_alpha' : 'QA_beta';",
    "            const tryMoves = async () => {",
    "                for (const p of [0, 1, 2, 3]) {",
    "                    const rr = await move('ludo', rm.id, who, { p });",
    "                    if (rr.json && rr.json.ok) return rr;",
    "                }",
    "                return null;",
    "            };",
    "            let r = await tryMoves();",
    "            if (!r) {",
    "                const rollR = await api('POST', '/api/v1/games/ludo/rooms/' + rm.id + '/roll', {}, TOKENS[who]);",
    "                if (!rollR.json.ok) { err = 'roll: ' + rollR.json.error; break; }",
    "                r = await tryMoves();",
    "            }",
    "            if (!r) {",
    "                const retry = await api('POST', '/api/v1/games/ludo/rooms/' + rm.id + '/roll', {}, TOKENS[who]);",
    "                err = 'deadlock: no legal move after roll, reroll=' + retry.status + ' ' + ((retry.json && retry.json.error) || '');",
    "                break;",
    "            }",
    "        }",
    "        ",
].join('\n');
seg = seg.substring(0, loopStart) + newLoop + seg.substring(loopEnd);
s = s.substring(0, start) + seg + s.substring(end);
fs.writeFileSync('D:/checkin/site/qa/qa_suite_280_api.js', s, 'utf8');
console.log('ludo section patched');
