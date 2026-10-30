// _patch_pass.js — 适配新语义：黑白棋 pass 端点、飞行棋自动换手、狮跳河消息；并修 ludo L2/L5
const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/qa_suite_280_api.js', 'utf8');

// 1) reversi R1 主循环：无着 → 调 pass 端点继续
s = s.replace(
    `        if (legal.length === 0) { lastErr = 'no legal move but not finished (pass missing?)'; break; }`,
    `        if (legal.length === 0) {
            // 新语义：无着时调 pass 端点（有合法着会被拒）
            const pr = await api('POST', '/api/v1/games/reversi/rooms/' + room.id + '/pass', {}, TOKENS[who]);
            if (!pr.json.ok) { lastErr = 'pass failed: ' + pr.json.error; break; }
            continue;
        }`
);

// 2) jungle 狮跳河有鼠挡：新消息是「只能跳过河面」（拒即可，消息不再细分）
s = s.replace(
    `T('非法：狮跳河中间有鼠被拒', rr.status === 400 && /挡/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));`,
    `T('非法：狮跳河中间有鼠被拒', rr.status === 400 && /挡|河面/.test(rr.json && rr.json.error || ''), JSON.stringify(rr.json && rr.json.error));`
);

// 3) ludo L2「已掷未走再掷被拒」：新语义下需「有合法着但没走」才成立 → craft 场上已有子 + roll
s = s.replace(
    `    // 重复 roll 被拒（防止重放刷骰子）
    r = await api('POST', \`/api/v1/games/ludo/rooms/\${room.id}/roll\`, {}, TOKENS.QA_alpha);
    T('已掷未走再掷被拒', r.status === 400 && /已经掷过了/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));`,
    `    // 重复 roll 被拒（有合法着但没走时；新语义：无着会自动换手，需 craft 已起飞子）
    {
        const rm2 = await mkRoom('ludo', { join: true });
        craftMoves(rm2.id, [{ t: 'move', s: 1, p: 0, v: 6 }, { t: 'roll', s: 1, v: 3 }], { Turn: 1, Status: 'playing', Revision: 10 });
        r = await api('POST', '/api/v1/games/ludo/rooms/' + rm2.id + '/roll', {}, TOKENS.QA_alpha);
        T('已掷未走再掷被拒（有合法着时）', r.status === 400 && /已经掷过了/.test(r.json && r.json.error || ''), JSON.stringify(r.json && r.json.error));
    }`
);

// 4) ludo L5 无着出路：新语义 = roll 后无合法着自动换手（turn 变化即出路）
s = s.replace(
    `        let allFail = true;
        for (const p of [0, 1, 2, 3]) {
            const rr = await move('ludo', rm.id, 'QA_alpha', { p });
            if (rr.json && rr.json.ok) allFail = false;
        }
        const rr2 = await api('POST', \`/api/v1/games/ludo/rooms/\${rm.id}/pass\`, {}, TOKENS.QA_alpha);
        const rr3 = await api('POST', \`/api/v1/games/ludo/rooms/\${rm.id}/roll\`, {}, TOKENS.QA_alpha);
        T('飞行棋无着可走时有出路（pass/自动换手）',
            (rr2.status === 200 && rr2.json && rr2.json.ok) || (rr3.json && rr3.json.ok) || !allFail,
            \`allMovesFail=\${allFail} pass=\${rr2.status} reroll=\${rr3.status} \${rr2.json && rr2.json.error || ''} \${rr3.json && rr3.json.error || ''}\`);`,
    `        let allFail = true;
        for (const p of [0, 1, 2, 3]) {
            const rr = await move('ludo', rm.id, 'QA_alpha', { p });
            if (rr.json && rr.json.ok) allFail = false;
        }
        // 新语义：roll 后无合法着 → 自动换手（turn 翻到对方 = 出路）
        const sAfter = await snap('ludo', rm.id, 'QA_alpha');
        T('飞行棋无着可走时自动换手（turn 翻转）',
            allFail && sAfter.turn === 2,
            \`allMovesFail=\${allFail} turn=\${sAfter.turn}\`);`
);

// 5) ludo L6 主循环：auto-pass 后「还没轮到你」视为换手，继续而非死局
s = s.replace(
    `            if (!r) {
                const retry = await api('POST', '/api/v1/games/ludo/rooms/' + rm.id + '/roll', {}, TOKENS[who]);
                err = 'deadlock: no legal move after roll, reroll=' + retry.status + ' ' + ((retry.json && retry.json.error) || '');
                break;
            }`,
    `            if (!r) {
                // 新语义：roll 后无合法着会自动换手；重掷报「还没轮到你」即已换手 → 继续
                const sNow = await snap('ludo', rm.id, 'QA_alpha');
                const whoNow = sNow.turn === 1 ? 'QA_alpha' : 'QA_beta';
                const retry = await api('POST', '/api/v1/games/ludo/rooms/' + rm.id + '/roll', {}, TOKENS[who]);
                if (retry.json && /还没轮到你/.test(retry.json.error || '')) continue; // 已自动换手
                err = 'deadlock: no legal move after roll, reroll=' + retry.status + ' ' + ((retry.json && retry.json.error) || '');
                break;
            }`
);

fs.writeFileSync('D:/checkin/site/qa/qa_suite_280_api.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/qa_suite_280_api.js');
console.log('pass-semantics patches applied');
