// _patch_c7c9.js — 修 C9 夺军旗构造（补己方军旗+断言 winner）与 C7b 构造（beta 等招不走进己方大本营）
const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/qa_suite_280_api.js', 'utf8');

// --- C9：补 side-1 军旗，断言 winner===1 ---
s = s.replace(
    `        craftMoves(rm.id, [
            { t: 'setup', s: 1, x: 1, y: 1, v: 4 },   // 连长 (1,1)
            { t: 'setup', s: 2, x: 1, y: 0, v: 12 },  // 军旗 (1,0) 大本营
        ], { Turn: 1, Revision: 10 });
        const rr = await move('armychess', rm.id, 'QA_alpha', { fx: 1, fy: 1, tx: 1, ty: 0 });
        const ss = await snap('armychess', rm.id, 'QA_alpha');
        T('C9 夺军旗：任意子攻击军旗应胜（flag_captured）',
            rr.json && rr.json.ok && ss.status === 'finished' && ss.resultReason === 'flag_captured',`,
    `        craftMoves(rm.id, [
            { t: 'setup', s: 1, x: 1, y: 1, v: 4 },    // 连长 (1,1)
            { t: 'setup', s: 2, x: 1, y: 0, v: 12 },   // 黑军旗 (1,0)
            { t: 'setup', s: 1, x: 3, y: 11, v: 12 },  // 红军旗（必须在场，否则 Judge 先查到红旗缺失误判）
        ], { Turn: 1, Revision: 10 });
        const rr = await move('armychess', rm.id, 'QA_alpha', { fx: 1, fy: 1, tx: 1, ty: 0 });
        const ss = await snap('armychess', rm.id, 'QA_alpha');
        T('C9 夺军旗：任意子攻击军旗应胜（flag_captured, winner=1）',
            rr.json && rr.json.ok && ss.status === 'finished' && ss.resultReason === 'flag_captured' && ss.winner === 1,`
);

// --- C7b：整个重写（逐手验状态；beta 等招走 (2,0)→(2,1)，不进己方大本营 (3,0)）---
const a = s.indexOf('    // 幸存子走开一步 → 是否仍公开？（应永久公开）');
const b = s.indexOf('    // C7c 无「无 rank 却公开」的脏数据');
const newC7b = `    // 幸存子走开一步 → 是否仍公开？（应永久公开；逐手验状态，防构造静默失败）
    craftMoves(room2.id, [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4 }, { t: 'setup', s: 2, x: 0, y: 0, v: 3 },
        { t: 'setup', s: 2, x: 2, y: 0, v: 4 },      // beta 等招子（(2,0)→(2,1) 合法；(3,0)是己方大本营不能进）
        { t: 'setup', s: 1, x: 3, y: 11, v: 12 }, { t: 'setup', s: 2, x: 1, y: 0, v: 12 },
    ], { Turn: 1, Revision: 12 });
    let okSeq = true, seqErr = '';
    const step = async (who, mv, label) => {
        const rr = await move('armychess', room2.id, who, mv);
        if (!rr.json.ok) { okSeq = false; seqErr = label + ': ' + rr.json.error; }
        return rr;
    };
    await step('QA_alpha', { fx: 0, fy: 1, tx: 0, ty: 0 }, 'battle');   // 连长吃排长，幸存于 (0,0)
    await step('QA_beta', { fx: 2, fy: 0, tx: 2, ty: 1 }, 'beta wait'); // beta 等招
    await step('QA_alpha', { fx: 0, fy: 0, tx: 1, ty: 0 }, 'survivor move away'); // 幸存子走到 (1,0)
    T('C7b 前置三手全部成功', okSeq, seqErr);
    const sB2 = await snap('armychess', room2.id, 'QA_alpha');
    const movedSurvivor = (sB2.state.pieces || []).find(p => p.x === 1 && p.y === 0 && p.side === 1);
    T('C7b 幸存子走开后仍永久公开（hidden:false+rank）',
        movedSurvivor && movedSurvivor.hidden === false && !!movedSurvivor.rank,
        JSON.stringify(movedSurvivor) + (okSeq ? '' : ' | ' + seqErr));

`;
s = s.substring(0, a) + newC7b + s.substring(b);

fs.writeFileSync('D:/checkin/site/qa/qa_suite_280_api.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/qa_suite_280_api.js');
console.log('patched C7b/C9, syntax OK');
