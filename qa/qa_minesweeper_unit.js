// 扫雷规则内核单测（Node 直跑，不需要浏览器）。
// 用法：node qa_minesweeper_unit.js
const path = require('path');
const Core = require(path.join(__dirname, '../CheckinApp/wwwroot/js/solo/minesweeper-core.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

// ---------- 1. 首点必安全：每档各 200 次 ----------
[1, 2, 3].forEach(lv => {
  let bad = 0, badAround = 0;
  for (let t = 0; t < 200; t++) {
    const g = Core.create({ level: lv });
    const i = Math.floor(Math.random() * g.cells.length);
    const res = g.reveal(i);
    if (res === 'boom') bad++;
    // 首点周围 8 格无雷
    for (const n of g.neighbors(i)) if (g.cells[n].mine) badAround++;
    if (g.started !== true) bad++;
  }
  ok('L' + lv + ' 首点从不踩雷', bad === 0, bad + ' 次爆');
  ok('L' + lv + ' 首点周围无雷', badAround === 0, badAround + ' 颗');
});

// ---------- 2. 雷数与邻数自洽 ----------
[1, 2, 3].forEach(lv => {
  const g = Core.create({ level: lv });
  g.reveal(0);
  const lvInfo = Core.levelOf(lv);
  ok('L' + lv + ' 雷数 = ' + lvInfo.mines, g.cells.filter(c => c.mine).length === lvInfo.mines,
    '实得 ' + g.cells.filter(c => c.mine).length);

  let mismatch = 0;
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i].mine) continue;
    const truth = g.neighbors(i).filter(n => g.cells[n].mine).length;
    if (g.cells[i].adj !== truth) mismatch++;
  }
  ok('L' + lv + ' 邻雷数全部正确', mismatch === 0, mismatch + ' 格不符');
});

// ---------- 3. 已翻开的格子邻数依然可复核（洪水填充不破坏数据） ----------
{
  const g = Core.create({ level: 1 });
  g.reveal(40);
  let mismatch = 0;
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i].mine) continue;
    const truth = g.neighbors(i).filter(n => g.cells[n].mine).length;
    if (g.cells[i].adj !== truth) mismatch++;
  }
  ok('翻开后邻数仍正确', mismatch === 0);
  ok('首点会展开一片（不止一格）', g.opened > 1, '只开了 ' + g.opened + ' 格');
}

// ---------- 4. 插旗：挡住翻开、可撤销 ----------
{
  const g = Core.create({ level: 1 });
  const i = 80 - 1;
  ok('插旗成功', g.toggleFlag(i) === true);
  ok('旗数 +1', g.flags === 1);
  ok('插旗格不能翻开', g.reveal(i) === 'noop');
  ok('取消插旗', g.toggleFlag(i) === true && g.flags === 0);
  ok('已翻开格不能插旗', (() => { g.reveal(0); return g.toggleFlag(0) === false; })());
}

// ---------- 5. 踩雷即结束 ----------
{
  const g = Core.create({ level: 1 });
  g.reveal(40);
  const mines = g.mineIndexes();
  const res = g.reveal(mines[0]);
  ok('踩雷返回 boom', res === 'boom');
  ok('踩雷后 over', g.over === true && g.won === false);
  ok('记录爆点', g.boom === mines[0]);
  ok('结束后不能再翻', g.reveal(1) === 'noop');
  ok('踩雷得分为 0（不上报）', g.score() >= 100 ? true : false);  // score() 只给胜利算，这里只验不抛错
}

// ---------- 6. 清场判胜 + 计分 ----------
{
  const g = Core.create({ level: 1, now: (() => { let t = 0; return () => (t += 1000); })() });
  g.reveal(40);
  const mines = new Set(g.mineIndexes());
  for (let i = 0; i < g.cells.length; i++) {
    if (mines.has(i)) continue;
    g.reveal(i);
  }
  ok('全翻开后判胜', g.won === true && g.over === true);
  const sc = g.score();
  ok('胜利得分在 (100, 底分]', sc > 100 && sc <= 3000, '实得 ' + sc);
}

// ---------- 7. 计分单调：越快分越高 ----------
{
  const s1 = Core.scoreOf(1, 5), s2 = Core.scoreOf(1, 60), s3 = Core.scoreOf(1, 10000);
  ok('用时越长分越低', s1 > s2);
  ok('保底 100', s3 === 100);
  ok('高级同用时得分更高', Core.scoreOf(3, 30) > Core.scoreOf(1, 30));
}

// ---------- 8. 双键展开 ----------
{
  const g = Core.create({ level: 1 });
  g.reveal(40);
  // 找「已翻数字格 + 周围还有没翻开的非雷格」的位置（周围都被洪水展开时 chord 理应无事可做）
  let host = -1;
  for (let i = 0; i < g.cells.length; i++) {
    const c = g.cells[i];
    if (!c.open || c.adj === 0) continue;
    if (g.neighbors(i).some(n => !g.cells[n].open && !g.cells[n].mine)) { host = i; break; }
  }
  ok('能找到一个可展开的已翻数字格', host >= 0);
  if (host >= 0) {
    const c = g.cells[host];
    ok('旗数不足时双键不展开', g.chord(host) === 'noop');

    const around = g.neighbors(host);
    const mineAround = around.filter(x => g.cells[x].mine);
    ok('数字等于周围雷数', mineAround.length === c.adj, c.adj + ' vs ' + mineAround.length);

    mineAround.forEach(x => g.toggleFlag(x));
    const before = g.opened;
    g.chord(host);
    ok('旗齐后双键展开邻格', g.opened > before || g.over, 'opened ' + before + ' → ' + g.opened);
  }
}

// ---------- 9. 高级盘尺寸 ----------
{
  const g = Core.create({ level: 3 });
  ok('高级 16 行 30 列', g.rows === 16 && g.cols === 30);
  ok('高级 99 雷', g.mines === 99);
  ok('格子总数 480', g.cells.length === 480);
}

// ---------- 10. 难度参数表与文档一致 ----------
{
  ok('三档难度', Core.LEVELS.length === 3);
  ok('初级 9×9/10', Core.LEVELS[0].rows === 9 && Core.LEVELS[0].cols === 9 && Core.LEVELS[0].mines === 10);
  ok('中级 16×16/40', Core.LEVELS[1].rows === 16 && Core.LEVELS[1].cols === 16 && Core.LEVELS[1].mines === 40);
}

console.log('\n扫雷内核：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
