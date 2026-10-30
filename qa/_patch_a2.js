const fs = require('fs');
const s = fs.readFileSync('D:/checkin/site/qa/_verify_batchA.js', 'utf8');
const a = s.indexOf('        const cases = [');
const b = s.indexOf('        // 黑白棋：构造 admin（黑）无合法着');
const replacement = `        const cases = [
            { gk: 'gomoku', move: { x: 7, y: 7 } },
            { gk: 'reversi', move: { x: 5, y: 3 } },
            { gk: 'jungle', move: { fx: 6, fy: 6, tx: 6, ty: 5 } },
            { gk: 'xiangqi', move: { fx: 1, fy: 9, tx: 2, ty: 7 } },
        ];
        for (const cs of cases) {
            const id = await openAiRoom(page, cs.gk);
            if (!id) continue;
            const rev0 = await page.evaluate(async ({ id, gk }) => { const r = await fetch('/api/v1/games/' + gk + '/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data.revision; }, { id, gk: cs.gk });
            const mvRes = await page.evaluate(async ({ id, gk, mv }) => { const r = await fetch('/api/v1/games/' + gk + '/rooms/' + id + '/move', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mv) }); return { status: r.status }; }, { id, gk: cs.gk, mv: cs.move });
            let aiMoved = false, lastRev = rev0;
            for (let i = 0; i < 12 && !aiMoved; i++) {
                await sleep(600);
                const rev = await page.evaluate(async ({ id, gk }) => { const r = await fetch('/api/v1/games/' + gk + '/rooms/' + id, { credentials: 'same-origin' }); return (await r.json()).data.revision; }, { id, gk: cs.gk });
                lastRev = rev;
                if (rev >= rev0 + 2) aiMoved = true;
            }
            T(\`A2 \${cs.gk} 人走→AI 回手\`, aiMoved, \`rev0=\${rev0} lastRev=\${lastRev} mvHttp=\${mvRes.status}\`);
        }

`;
fs.writeFileSync('D:/checkin/site/qa/_verify_batchA.js', s.substring(0, a) + replacement + s.substring(b), 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_batchA.js');
console.log('A2 loop rewritten, syntax OK');
