// games.js — 通用对局轮询 + 落子。配合 boards.js + boards/{key}.js 使用。
// 1.2s 短轮询 + revision 乐观锁，渲染交给 boards 模块。
// pageshow 刷 bfcache（修复 2）。
(function () {
  'use strict';

  var stateEl = document.getElementById('gmState');
  var boardHost = document.getElementById('gmBoardHost');
  if (!stateEl || !boardHost) return;
  if (boardHost.dataset.bound === '1') return;
  boardHost.dataset.bound = '1';

  var state;
  try { state = JSON.parse(stateEl.textContent); } catch (e) { return; }

  var statusTextEl = document.getElementById('gmStatusText');
  var clockEl = document.getElementById('gmClock');
  var timer = null;
  var clockTimer = null;

  // 选择棋盘渲染器（按 gameKey 精确分发，不回落到 GomokuBoard）
  var gameKey = state.gameKey || 'gomoku';
  var RENDERERS = {
    gomoku: window.GomokuBoard,
    reversi: window.ReversiBoard,
    jungle: window.JungleBoard,
    xiangqi: window.XiangqiBoard,
    ludo: window.LudoBoard,
    armychess: window.ArmyChessBoard,
  };
  var renderer = RENDERERS[gameKey];
  if (!renderer) { console.error('未知游戏类型: ' + gameKey); return; }

  // 创建 SVG
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 640 640');
  svg.setAttribute('class', 'gm-board');
  svg.style.width = '100%';
  svg.style.height = 'auto';
  boardHost.appendChild(svg);

  // 视角对调：上方座（side 2）在象棋/斗兽棋/军旗（明棋+暗棋）看到的棋盘上下翻转
  // （己方恒在下半区，双端一致）；翻棋混布盘不翻。0 = 旁观不翻。
  function flipView() {
    if (gameKey !== 'xiangqi' && gameKey !== 'jungle' && gameKey !== 'armychess') return false;
    if (state.mySide !== 2) return false;
    if (gameKey === 'armychess' && state.state && state.state.mode === 'fanqi') return false;
    return true;
  }

  function render() {
    if (!renderer.render) return;
    var deployActive = gameKey === 'armychess' && state.status === 'setup'
      && state.mySide > 0 && !(state.state && state.state.deployDone && state.state.deployDone[state.mySide - 1]);
    if (deployActive && !deployPieces) deployPieces = window.ArmyChessBoard.genDeploy(state.mySide);
    if (!deployActive) { deployPieces = null; deploySel = null; }
    // 滑动动画视图（Batch D）：把正在滑的棋子坐标插值成小数（board 的 px/py 线性映射天然支持）
    var st = state.state || {};
    var ghost = null;
    if (anim) {
      var el = nowMs() - anim.t0;
      var t = Math.min(1, el / 200);
      if (t < 1) {
        var e = 1 - (1 - t) * (1 - t);   // ease-out
        st = Object.assign({}, st, {
          pieces: (st.pieces || []).map(function (p) {
            if (p.x === anim.tx && p.y === anim.ty) {
              return Object.assign({}, p, {
                x: anim.fx + (anim.tx - anim.fx) * e,
                y: anim.fy + (anim.ty - anim.fy) * e,
              });
            }
            return p;
          }),
        });
      }
      if (anim.cap) ghost = { piece: anim.cap, alpha: Math.max(0, 1 - el / 240) };
      if (el > 260) anim = null;
    }
    lastGeom = renderer.render(svg, st, {
      showCoord: state.showCoord,
      lastMark: state.lastMark,
      mySide: state.mySide,
      myTurn: state.myTurn,
      tapConfirm: state.tapConfirm,
      sel: sel,
      hints: hintMap,
      pointPreview: pointPreview,
      placeProgress: placeAnim ? Math.min(1, (nowMs() - placeAnim.t0) / 220) : 1,
      placeAt: placeAnim ? (placeAnim.x + ',' + placeAnim.y) : null,
      ghost: ghost,
      deployPieces: deployActive ? deployPieces : null,
      movable: (state.state && state.state.movable) || [],
      flip: flipView(),
    });
    if (window.__QA_HOOKS__ !== false) window.__gmLastGeom = lastGeom;   // 测试钩子（P3-2：显式 false=Release 隐藏；缺省可见=滚动升级过渡保护工具链）
    if (statusTextEl) {
      var txt = statusText(state);
      // 黑白棋：全程比分 + 无子可下提示（状态事实，非解释）
      if (gameKey === 'reversi' && state.state) {
        var evs = state.state.events || [];
        var last = evs.length ? evs[evs.length - 1] : null;
        if (last && last.t === 'pass') {
          txt = (last.s === state.mySide ? '你无子可下，跳过' : '对方无子可下，跳过') + ' · ' + txt;
        }
        txt += ' · 黑 ' + (state.state.black || 0) + ' 白 ' + (state.state.white || 0);
      }
      // 飞行棋：骰点 + 掷/选机状态（状态事实）
      if (gameKey === 'ludo' && state.state) {
        if (state.state.lastRoll) txt += ' · 骰子 ' + state.state.lastRoll;
        if (state.myTurn && state.status === 'playing') {
          txt += state.state.needRoll ? ' · 掷骰子' : ' · 选一架飞机';
        }
      }
      // 翻棋：阵营状态 + 执色 + 二选一（状态事实）
      if (gameKey === 'armychess' && state.state && state.state.mode === 'fanqi' && state.status === 'playing') {
        txt += state.state.settled ? ' · 翻子或走子' : ' · 阵营未定';
        if (state.state.myColor) txt += ' · 你执' + (state.state.myColor === 1 ? '红' : '蓝');
      }
      statusTextEl.textContent = txt;
    }
    // 布阵按钮条：仅布阵期且自己未部署时出现
    var bar = document.getElementById('gmSetupBar');
    if (bar) bar.hidden = !deployActive;
    // 飞行棋掷骰按钮条：轮到我且这一手还没掷
    var ludoBar = document.getElementById('gmLudoBar');
    if (ludoBar) {
      var needRoll = !!(state.myTurn && state.status === 'playing'
        && state.state && state.state.needRoll);
      ludoBar.hidden = !needRoll;
    }
    // 重建换房握手（走查表 §3）：对方请求 → 同意/拒绝；换房完成 → 跳新房
    updateRebuildBar(state);
  }

  // 重建换房（设置重建层改动 → 一键重建）：对手端提示条 + 换房完成跳转
  function updateRebuildBar(s) {
    var rb = s.rebuild;
    if (rb && rb.doneId) { location.href = '/Games/' + gameKey + '/Play/' + rb.doneId; return; }
    var bar = document.getElementById('gmRebuildBar');
    var show = rb && rb.askSide && rb.askSide !== s.mySide && (rb.vote === null || rb.vote === undefined);
    if (show) {
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'gmRebuildBar';
        // 不用 .msg 类（site.js 会把 .msg 收进 toast 化掉按钮）
        bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px 0;border:1px solid #e53935;border-radius:10px;padding:8px 10px;';
        var t = document.createElement('span');
        t.style.flex = '1';
        t.textContent = '对手请求重建房间';
        var ok = document.createElement('button');
        ok.className = 'btn'; ok.type = 'button'; ok.textContent = '同意换房';
        ok.onclick = function () { voteRebuild(true); };
        var no = document.createElement('button');
        no.className = 'btn secondary'; no.type = 'button'; no.textContent = '拒绝';
        no.onclick = function () { voteRebuild(false); };
        bar.appendChild(t); bar.appendChild(ok); bar.appendChild(no);
        var host = document.querySelector('.gm-card') || document.body;
        host.insertBefore(bar, host.firstChild ? host.firstChild.nextSibling : null);
      }
    } else if (bar) {
      bar.remove();
    }
  }

  function voteRebuild(accept) {
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id + '/rebuild', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vote', accept: accept }),
    }).then(function () {
      var bar = document.getElementById('gmRebuildBar');
      if (bar) bar.remove();
    }).catch(function () {});
  }

  // 最近一次 render 返回的几何（pad/cw/ch/cols/rows/mode）—— 点击换算与渲染同源
  var lastGeom = null;
  // 两段式走子：当前选中的起点 (gx,gy)。象棋/斗兽棋/军旗用。
  var sel = null;
  // 可走提示按需表（QA §3-P1）：选中棋子才拉单子提示，轮询不再全量下发
  var hintMap = {};
  // 单点落子确认（任务二尾巴）：第一下预览，同点第二下落子；点别处换预览
  var pointPreview = null;
  // 单点落子/翻子动画（任务二尾巴）：新落点回弹缩放 + 黑白棋翻子挤压
  var placeAnim = null;
  // 滑动动画（Batch D）：{fx,fy,tx,ty,t0,cap}，按 lastMove 滑向终点 + 吃子鬼影
  var anim = null;
  var animRaf = 0;
  // 军旗明棋布阵：本地排布（客户端生成，确认后提交 deploy）
  var deployPieces = null;
  var deploySel = null;

  function statusText(s) {
    if (s.status === 'waiting') return '等人进来';
    if (s.status === 'finished') {
      var w = s.winner === 3 ? '和棋' : s.winner === 0 ? '已结束' : (s.winner === s.mySide ? '你赢了' : '你输了');
      return w;
    }
    if (s.mySide === 0) return '你在旁观这一局';
    if (s.status === 'setup') return '布阵中';   // 军棋布阵期阶段名（0.2 极简；过渡态不跳 playing 词）
    return s.myTurn ? '轮到你' : '等对手落子';
  }

  // 点击模式：两段式（象棋/斗兽棋/军旗）/ 单点落子（五子棋/黑白棋）/ 不响应棋盘点击（飞行棋走按钮）
  function boardClickMode() {
    if (gameKey === 'xiangqi' || gameKey === 'jungle' || gameKey === 'armychess') return 'two';
    if (gameKey === 'gomoku' || gameKey === 'reversi') return 'point';
    return 'none';
  }

  // 执方视角：翻棋 = 执色（myColor），其余 = 座位（mySide）
  function myColorOf() {
    if (gameKey === 'armychess' && state.state && state.state.mode === 'fanqi') return state.state.myColor || 0;
    return state.mySide;
  }

  // (gx,gy) 上是否我的子（两段式选起点用）
  function ownPieceAt(gx, gy) {
    var ps = state.state && state.state.pieces;
    if (!ps) return false;
    var mine = myColorOf();
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].x === gx && ps[i].y === gy && ps[i].side === mine) return true;
    }
    return false;
  }

  // 可走提示查询（Batch D / 按需化）：以按需单子表为准；未就绪退回直接走（服务端仍兜底校验）
  function canTarget(fx, fy, tx, ty) {
    var lst = hintMap[fx + ',' + fy];
    if (!lst) return true;
    for (var i = 0; i < lst.length; i++) if (lst[i][0] === tx && lst[i][1] === ty) return true;
    return false;
  }

  // 选中起点 = 记录 + 拉这一子的提示（GET /rooms/{id}/hints，单子成本 ≈ 全量/子数）
  function selectHintPiece(gx, gy) {
    sel = { x: gx, y: gy };
    hintMap = {};
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id + '/hints?fx=' + gx + '&fy=' + gy, {
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok || !j.data) return;
      for (var k in j.data) hintMap[k] = j.data[k];
      render();
    }).catch(function () {});
  }

  // 点击：算到 SVG viewBox 坐标 → 飞行棋点机 / 网格坐标 → 布阵/两段式/单点分发
  svg.addEventListener('click', function (e) {
    var rect = svg.getBoundingClientRect();
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var vw = vb && vb.width ? vb.width : 640;
    var vh = vb && vb.height ? vb.height : 640;
    var x = (e.clientX - rect.left) / rect.width * vw;
    var y = (e.clientY - rect.top) / rect.height * vh;

    // 飞行棋：点 ✈ 走子（movable 内才发 {p}），不走网格换算
    if (gameKey === 'ludo') {
      if (!state.myTurn || state.status !== 'playing') return;
      var lst = (state.state && state.state.movable) || [];
      if (!lst.length) return;
      var pi = window.LudoBoard.pieceAt(x, y);
      if (pi >= 0 && lst.indexOf(pi) >= 0) sendMove({ p: pi });
      return;
    }

    var g = window.GameBoards.hit(lastGeom, x, y);
    if (!g) return;
    // 视角对调：hit 返回的是「显示行号」，翻转视角下换回逻辑行号再走棋（发送/比对均逻辑坐标）
    if (flipView() && lastGeom) g.y = (lastGeom.rows - 1) - g.y;

    // 军旗明棋布阵：点两格互换（约束不合法的交换不动）
    if (gameKey === 'armychess' && state.status === 'setup' && deployPieces) {
      var mine = deployPieces.some(function (q) { return q.x === g.x && q.y === g.y; });
      if (!mine) return;
      if (!deploySel) { deploySel = { x: g.x, y: g.y }; sel = deploySel; render(); return; }
      if (deploySel.x === g.x && deploySel.y === g.y) { deploySel = null; sel = null; render(); return; }
      var swapped = window.ArmyChessBoard.trySwap(state.mySide, deployPieces, deploySel.x, deploySel.y, g.x, g.y);
      if (swapped) deployPieces = swapped;
      deploySel = null; sel = null;
      render();
      return;
    }

    if (!state.myTurn || state.status !== 'playing') return;

    // 翻棋：点暗子 = 翻开 {x,y}；点己方已翻子 = 两段式走子（暗子不可动不可被攻击）
    if (gameKey === 'armychess' && state.state && state.state.mode === 'fanqi') {
      var psF = state.state.pieces || [], pq = null;
      for (var iF = 0; iF < psF.length; iF++) if (psF[iF].x === g.x && psF[iF].y === g.y) { pq = psF[iF]; break; }
      if (pq && pq.hidden) {
        sel = null;
        sendMove({ x: g.x, y: g.y });
        return;
      }
      if (!state.state.settled) return;   // 阵营未定：只能翻子
      if (ownPieceAt(g.x, g.y)) { selectHintPiece(g.x, g.y); render(); return; }
      if (sel && !(sel.x === g.x && sel.y === g.y)) {
        // 可走提示点内才发着；点别处 = 取消选中（Batch D）
        if (canTarget(sel.x, sel.y, g.x, g.y)) {
          sendMove({ fx: sel.x, fy: sel.y, tx: g.x, ty: g.y });
          sel = null;
        } else {
          sel = null;
        }
        render();
        return;
      }
      sel = null;
      render();
      return;
    }

    var mode = boardClickMode();
    if (mode === 'none') return;

    if (mode === 'two') {
      // 点己方另一子 = 改选起点（必须在 sendMove 之前判，否则改选分支不可达）
      if (ownPieceAt(g.x, g.y)) {
        selectHintPiece(g.x, g.y);
        render();
        return;
      }
      // 已有起点：提示点内 → 提交 {fx,fy,tx,ty}；点别处 → 取消选中（Batch D）
      if (sel && !(sel.x === g.x && sel.y === g.y)) {
        if (canTarget(sel.x, sel.y, g.x, g.y)) {
          sendMove({ fx: sel.x, fy: sel.y, tx: g.x, ty: g.y });
          sel = null;
        } else {
          sel = null;   // BUG-1：点别处取消选中（与 fanqi 分支/App 端对齐，红线 0.1）
        }
        render();
        return;
      }
      sel = null;
      render();
      return;
    }

    // 单点落子（五子棋/黑白棋）：开「落子确认」时第一下只预览、同点第二下落（点别处=换预览，与 App 同规）
    if (state.tapConfirm) {
      var pk = g.x + ',' + g.y;
      if (pointPreview !== pk) {
        pointPreview = pk;
        render();
        return;
      }
      pointPreview = null;
    }
    sendMove({ x: g.x, y: g.y });
  });

  // 军旗布阵：随机 / 确认（Play.cshtml 按钮条调）
  window.__gmDeployRandom = function () {
    if (deployPieces) { deployPieces = window.ArmyChessBoard.genDeploy(state.mySide); deploySel = null; sel = null; render(); }
  };
  window.__gmDeployPieces = function () { return deployPieces; };
  window.__gmDeployConfirm = function () {
    if (!deployPieces) return;
    fetch('/api/v1/games/armychess/rooms/' + state.id + '/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify({ pieces: deployPieces }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) { deployPieces = null; deploySel = null; sel = null; apply(j.data); }
    }, function () { });
  };

  // 飞行棋：掷骰（Play.cshtml 按钮条调）
  window.__gmLudoRoll = function () {
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id + '/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) apply(j.data);
    }, function () { });
  };

  function sendMove(move) {
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      body: JSON.stringify(move),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) apply(j.data);
    }, function () { });
  }

  function apply(data) {
    if (data.revision === state.revision) return;
    var prevPieces = (state.state && state.state.pieces) || [];
    state.revision = data.revision;
    if (!data.myTurn) { sel = null; pointPreview = null; }   // 轮到对方时清掉选中/预览
    state.status = data.status;
    state.turn = data.turn;
    state.winner = data.winner;
    state.resultReason = data.resultReason;
    state.myTurn = data.myTurn;
    state.mySide = data.mySide;
    state.state = data.state;
    state.moveRemainMs = data.moveRemainMs;
    state.myRemainMs = data.myRemainMs;
    state.oppRemainMs = data.oppRemainMs;
    state.players = data.players;     // 飞行棋多座（D4-BUG-1 同类风险，一并补）
    state.rebuild = data.rebuild;     // 重建换房握手（D4-BUG-1：漏拷对手端按钮永远不出现）
    startAnim(prevPieces, data.state);
    // 单点落子动画（任务二尾巴）：五子棋/黑白棋新着回弹 + 翻子
    if ((gameKey === 'gomoku' || gameKey === 'reversi') && data.state && data.state.lastMove) {
      var lm0 = data.state.lastMove;
      placeAnim = { x: lm0.tx, y: lm0.ty, t0: nowMs() };
      if (!anim && !animRaf) animRaf = requestAnimationFrame(step);
    }
    render();
  }

  function step() {
    animRaf = 0;
    render();
    var pa = placeAnim && nowMs() - placeAnim.t0 < 300;
    if ((anim && nowMs() - anim.t0 < 260) || pa) animRaf = requestAnimationFrame(step);
    else if (!pa) placeAnim = placeAnim && nowMs() - placeAnim.t0 < 300 ? placeAnim : null;
  }

  // 滑动动画（Batch D）：按 lastMove 从起点滑向终点；吃子在目标点留淡出鬼影
  function startAnim(prevPieces, st) {
    anim = null;
    var lm = st && st.lastMove;
    if (!lm || lm.fx === undefined || lm.fx === null) return;          // 翻子等无滑动
    if (lm.fx === lm.tx && lm.fy === lm.ty) return;                    // 原地不动
    var cap = null;
    for (var i = 0; i < prevPieces.length; i++) {
      var p = prevPieces[i];
      if (p.x === lm.tx && p.y === lm.ty) { cap = p; break; }
    }
    anim = { fx: lm.fx, fy: lm.fy, tx: lm.tx, ty: lm.ty, t0: nowMs(), cap: cap };
    if (animRaf) return;
    var step = function () {
      animRaf = 0;
      render();
      if (anim && nowMs() - anim.t0 < 260) animRaf = requestAnimationFrame(step);
    };
    animRaf = requestAnimationFrame(step);
  }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function poll() {
    fetch('/api/v1/games/' + gameKey + '/rooms/' + state.id, {
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok && j.data) apply(j.data);
    }, function () { });
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }

  function tick() {
    if (!document.body.contains(svg)) {
      clearTimeout(timer);
      clearInterval(clockTimer);
      return;
    }
    if (document.hidden) { schedule(1500); return; }
    poll();
    schedule(state.status === 'finished' ? 3000 : 1200);
  }

  render();
  schedule(1200);

  // bfcache 返回时刷一次（修复 2）
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    if (!document.body.contains(svg)) return;
    poll();
  });
})();
