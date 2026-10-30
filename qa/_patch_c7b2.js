// _patch_c7b2.js — C7b 重写为「新房间 + 单次带 p 构造 + 逐手验状态」（对齐已验证的探针场景）
const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/qa_suite_280_api.js', 'utf8');
const a = s.indexOf('    // 幸存子走开一步');
const b = s.indexOf('    // 先让 beta');
if (a < 0 || b < 0 || b < a) { console.error('markers not found', a, b); process.exit(1); }

const NEW = `    // 幸存子走开一步 → 是否仍公开？（应永久公开）
    // 用新房间 + 单次构造（setup 带 p = 新格式全局序号；Status 自始 playing，避免复用旧房残留 finished）
    const room3 = await mkRoom('armychess');
    craftMoves(room3.id, [
        { t: 'setup', s: 1, x: 0, y: 1, v: 4, p: 0 },   // 红连长
        { t: 'setup', s: 2, x: 0, y: 0, v: 3, p: 25 },  // 黑排长（将被吃）
        { t: 'setup', s: 2, x: 2, y: 0, v: 4, p: 26 },  // 黑连长（未参战，等招用）
        { t: 'setup', s: 1, x: 3, y: 11, v: 12, p: 1 }, // 红军旗
        { t: 'setup', s: 2, x: 3, y: 0, v: 12, p: 27 }, // 黑军旗
    ], { Turn: 1, Status: "playing", Winner: 0, ResultReason: "", Revision: 12 });
    let okSeq = true, seqErr = '';
    const step = async (who, mv, label) => {
        const rr = await move('armychess', room3.id, who, mv);
        if (!rr.json.ok) { okSeq = false; seqErr = label + ': ' + rr.json.error; }
        return rr;
    };
    await step('QA_alpha', { fx: 0, fy: 1, tx: 0, ty: 0 }, 'battle');      // 连长吃排长，幸存于 (0,0)
    await step('QA_beta', { fx: 2, fy: 0, tx: 2, ty: 1 }, 'beta wait');    // 等招（(2,0)→(2,1) 合法；(3,0) 是己方大本营不能进）
    await step('QA_alpha', { fx: 0, fy: 0, tx: 1, ty: 0 }, 'survivor away'); // 幸存子走到 (1,0)
    T('C7b 前置三手全部成功', okSeq, seqErr);
    const sB2 = await snap('armychess', room3.id, 'QA_alpha');
    const movedSurvivor = (sB2.state.pieces || []).find(p => p.x === 1 && p.y === 0 && p.side === 1);
    T('C7b 幸存子走开后仍永久公开（hidden:false+rank）',
        movedSurvivor && movedSurvivor.hidden === false && !!movedSurvivor.rank,
        JSON.stringify(movedSurvivor) + (okSeq ? '' : ' | ' + seqErr));

`;

const out = s.substring(0, a) + NEW + s.substring(b);
fs.writeFileSync('D:/checkin/site/qa/qa_suite_280_api.js', out, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/qa_suite_280_api.js');
console.log('C7b rewritten, syntax OK');
