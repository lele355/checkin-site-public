"""小游戏接口级自检（本地，双人全流程）。

前置：本地服务跑在 5188，库里有两个账号
  房主 admin / Lel3@Guanjia2026（uid=1）
  对手 qagamer / Qa123456（uid=17）
**不再需要手工往 ApiTokens 插行**：脚本自己走 /auth/login 换令牌。
以前要「插两行 sha256、测完删掉」，忘了删就留了后门、忘了插就跑不起来，
现在这一步彻底省了。

注意：脚本会改房主的**账号默认对局设置**，跑完会恢复成出厂值。

用法：python qa/qa_games_api.py
"""
import json, os, sys, time, urllib.request, urllib.error

BASE = 'http://127.0.0.1:5188/api/v1'
ACC_HOST = (ADMIN, process.env.QA_PASS)
ACC_GUEST = ('qagamer', 'Qa123456')
HOST = None      # 运行时由 login() 填
GUEST = None
ok = fail = 0


def unwrap(raw):
    """ApiKit.Ok 把 DTO 包在 {ok:true,data:...} 里，这里剥一层"""
    if not raw:
        return None
    j = json.loads(raw)
    # 成功：{ok:true,data:...}；失败：{ok:false,error:"..."}（失败时原样返回，好断言错误文案）
    if isinstance(j, dict) and j.get('ok') is True:
        return j.get('data')
    return j


def call(method, path, body=None, token='__default__'):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if token == '__default__':
        token = HOST
    if token:                       # 登录本身不带令牌，传 None 表示匿名
        req.add_header('Authorization', 'Bearer ' + token)
    if data:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, unwrap(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, unwrap(e.read().decode())


def check(name, cond, extra=''):
    global ok, fail
    if cond:
        ok += 1
        print('PASS  ' + name + (('  [' + str(extra) + ']') if extra != '' else ''))
    else:
        fail += 1
        print('FAIL  ' + name + '  [' + str(extra) + ']')


def err(e):
    return (e or {}).get('error') if isinstance(e, dict) else e


def login(acc):
    """换一个 Bearer 令牌（登录态 token 与手工 API token 走同一条校验路）"""
    st, r = call('POST', '/auth/login',
                 {'username': acc[0], 'password': acc[1], 'device': 'qa-games-api'},
                 token=None)
    if st != 200 or not isinstance(r, dict) or not r.get('token'):
        raise SystemExit('登录失败 %s: %s %s' % (acc[0], st, r))
    return r['token']


HOST = login(ACC_HOST)
GUEST = login(ACC_GUEST)

DEFAULTS = {'size': 15, 'forbidden': False, 'tapConfirm': False, 'showCoord': True,
            'lastMark': True, 'vibrate': True, 'moveTimeoutSec': 0, 'totalTimeoutSec': 0}
# 设置分两个入口：总设置只管显示偏好，单游戏设置只管规则默认。
# 必须分开打两枪 —— 各自的 DTO 只读写自己那半，混着传会把另一半摁回默认值。
DISPLAY_DEFAULTS = {'tapConfirm': False, 'showCoord': True, 'lastMark': True, 'vibrate': True}
RULE_DEFAULTS = {'size': 15, 'forbidden': False, 'moveTimeoutSec': 0, 'totalTimeoutSec': 0}


def reset_settings():
    """把账号默认设置摁回出厂值，别让上一条断言影响下一条"""
    a = call('PUT', '/games/settings', DISPLAY_DEFAULTS)
    b = call('PUT', '/games/gomoku/settings', RULE_DEFAULTS)
    return a, b


reset_settings()


# ==================== 0. 游戏列表（入口第一屏） ====================
st, cat = call('GET', '/games')
check('游戏列表可达', st == 200, st)
check('游戏列表带 games 数组', isinstance((cat or {}).get('games'), list), cat)
keys = [g.get('key') for g in (cat or {}).get('games', [])]
check('五子棋在列表里', 'gomoku' in keys, keys)

# ==================== 1. 大厅 ====================
st, lobby = call('GET', '/games/gomoku/rooms')
check('大厅可达（新的时间过滤条件能被 SQLite 翻译）', st == 200, st)
check('大厅下发盘面尺寸 15', ((lobby or {}).get('rules') or {}).get('size') == 15, (lobby or {}).get('rules'))
check('大厅带 items 数组', isinstance((lobby or {}).get('items'), list))
check('大厅顺手带回我的显示偏好', isinstance((lobby or {}).get('display'), dict), (lobby or {}).get('display'))
check('大厅带回可选档位', isinstance((lobby or {}).get('sizeOptions'), list), (lobby or {}).get('sizeOptions'))

# ==================== 2. 建房 ====================
st, r = call('POST', '/games/gomoku/rooms', {'side': 1})
check('建房成功', st == 200, st)
rid, code = r['id'], r['code']
check('房间码 6 位', len(code) == 6, code)
check('房间码不含易混字符 0O1I', not any(c in code for c in '0O1I'), code)
check('建房响应 hostSide=1', r['hostSide'] == 1, r['hostSide'])

st, snap = call('GET', '/games/gomoku/rooms/%d' % rid)
check('房主执黑', snap['mySide'] == 1, snap['mySide'])
check('初始 waiting', snap['status'] == 'waiting', snap['status'])
check('初始盘面无子', len(snap['moves']) == 0, len(snap['moves']))
check('初始 lastMove 为空', snap.get('lastMove') is None, snap.get('lastMove'))

# ==================== 3. 各种进不去的姿势 ====================
st, e = call('POST', '/games/join', {'code': 'ZZZZZZ'})
check('错码 400 + 中文提示', st == 400 and isinstance(err(e), str), (st, err(e)))

st, e = call('POST', '/games/gomoku/rooms/%d/move' % rid, {'x': 7, 'y': 7})
check('对手没进来就落子被拒', st == 400 and '对手还没' in (err(e) or ''), (st, err(e)))

st, e = call('GET', '/games/gomoku/rooms/999999')
check('不存在的房间 400', st == 400, (st, err(e)))

# ==================== 4. 对手凭码就坐（小写也认） ====================
st, _ = call('POST', '/games/join', {'code': code.lower()}, token=GUEST)
check('房间码大小写不敏感也能进', st == 200, st)

st, snap = call('GET', '/games/gomoku/rooms/%d' % rid)
check('就坐后进入 playing', snap['status'] == 'playing', snap['status'])
check('先手（黑）轮到房主', snap['myTurn'] is True and snap['turn'] == 1, (snap['myTurn'], snap['turn']))

st, gsnap = call('GET', '/games/gomoku/rooms/%d' % rid, token=GUEST)
check('对手那一侧是白', gsnap['mySide'] == 2, gsnap['mySide'])
check('对手此刻不该轮到', gsnap['myTurn'] is False, gsnap['myTurn'])

st, e = call('POST', '/games/gomoku/rooms/%d/move' % rid, {'x': 0, 'y': 2}, token=GUEST)
check('抢下被「还没轮到你」挡住', st == 400 and '没轮到' in (err(e) or ''), (st, err(e)))

st, e = call('POST', '/games/gomoku/rooms/%d/move' % rid, {'x': 99, 'y': 0})
check('越界坐标被拒', st == 400 and '不合法' in (err(e) or ''), (st, err(e)))

# ==================== 5. 下出五连 ====================
# 黑：(0..4, 0)；白：(0..3, 1)
for i in range(5):
    st, snap = call('POST', '/games/gomoku/rooms/%d/move' % rid, {'x': i, 'y': 0})
    if st != 200:
        check('黑第 %d 手' % (i + 1), False, (st, err(snap)))
        break

    if i == 0:
        check('第一手后盘面 1 颗子', len(snap['moves']) == 1, len(snap['moves']))
        check('lastMove 指向刚下的那手',
              (snap['lastMove']['x'], snap['lastMove']['y']) == (0, 0), snap['lastMove'])
        check('落子后 toggle 到白方', snap['turn'] == 2, snap['turn'])
        st, e = call('POST', '/games/gomoku/rooms/%d/move' % rid, {'x': 0, 'y': 0}, token=GUEST)
        check('不能下在已有子的交叉点', st == 400 and '已经有子' in (err(e) or ''), (st, err(e)))

    if i == 4:
        check('五连后 status=finished', snap['status'] == 'finished', snap['status'])
        check('winner = 黑', snap['winner'] == 1, snap['winner'])
        check('原因 = five', snap['resultReason'] == 'five', snap['resultReason'])
        break

    st, snap2 = call('POST', '/games/gomoku/rooms/%d/move' % rid, {'x': i, 'y': 1}, token=GUEST)
    check('白第 %d 手成功' % (i + 1), st == 200, (st, err(snap2)))

st, e = call('POST', '/games/gomoku/rooms/%d/move' % rid, {'x': 9, 'y': 9})
check('终局后继续落子被拒', st == 400 and '已经结束' in (err(e) or ''), (st, err(e)))

# ==================== 6. 再来一局（默认交换先手） ====================
st, snap = call('POST', '/games/gomoku/rooms/%d/rematch' % rid, {})
check('再来一局成功', st == 200, st)
check('盘面被清空', len(snap['moves']) == 0, len(snap['moves']))
check('状态回到 playing', snap['status'] == 'playing', snap['status'])
check('先手交换：房主变白', snap['mySide'] == 2, snap['mySide'])

st, gsnap = call('GET', '/games/gomoku/rooms/%d' % rid, token=GUEST)
check('对手变黑且轮到它', gsnap['mySide'] == 1 and gsnap['myTurn'] is True,
      (gsnap['mySide'], gsnap['myTurn']))

# ==================== 7. 认输 ====================
st, _ = call('POST', '/games/gomoku/rooms/%d/resign' % rid, token=GUEST)
check('认输成功', st == 200, st)
st, snap = call('GET', '/games/gomoku/rooms/%d' % rid)
check('认输后 status=finished', snap['status'] == 'finished', snap['status'])
check('认输方的对手赢', snap['winner'] == 2, snap['winner'])
check('原因 = resign', snap['resultReason'] == 'resign', snap['resultReason'])

# ==================== 8. 离开 / 房间生命周期 ====================
st, _ = call('POST', '/games/gomoku/rooms/%d/leave' % rid)
check('终局后房主离开 = 清掉这局', st == 200, st)
st, e = call('GET', '/games/gomoku/rooms/%d' % rid)
check('清掉后再查 400', st == 400, (st, err(e)))

st, a = call('POST', '/games/gomoku/rooms', {'side': 1})
st, b2 = call('POST', '/games/gomoku/rooms', {'side': 2})
st, lobby = call('GET', '/games/gomoku/rooms')
waiting = [x for x in lobby['items'] if x['mine'] and x['status'] == 'waiting']
check('一个人只留一间空房（建新房会清掉旧的）', len(waiting) <= 1, len(waiting))
check('旧的那间确实没了',
      not any(x['id'] == a['id'] for x in lobby['items']),
      a['id'])
for x in waiting:
    call('POST', '/games/gomoku/rooms/%d/leave' % x['id'])

# ==================== 9. 设置分两个入口 ====================
st, s0 = call('GET', '/games/gomoku/settings')
check('杂项设置接口可达', st == 200, st)
r0 = (s0 or {}).get('rules') or {}
check('出厂值 15 路 / 自由规则 / 不限时',
      (r0.get('size'), r0.get('forbidden'), r0.get('moveTimeoutSec'), r0.get('totalTimeoutSec')) == (15, False, 0, 0),
      s0)
check('杂项设置带可选档位', isinstance(s0.get('sizeOptions'), list) and 13 in s0['sizeOptions'], s0.get('sizeOptions'))

st, s1 = call('PUT', '/games/gomoku/settings',
              {'size': 19, 'forbidden': True, 'moveTimeoutSec': 60, 'totalTimeoutSec': 600})
check('杂项设置可写', st == 200, st)
check('写进去的值原样回来',
      (s1['size'], s1['forbidden'], s1['moveTimeoutSec'], s1['totalTimeoutSec']) == (19, True, 60, 600),
      s1)

st, s2 = call('GET', '/games/gomoku/settings')
check('杂项设置回读一致（真的落库了）', s2['rules'] == s1, s2)

# 显示偏好走另一个入口，两边不能互相覆盖
st, d1 = call('PUT', '/games/settings',
              {'tapConfirm': True, 'showCoord': False, 'lastMark': True, 'vibrate': False})
check('总设置可写', st == 200, st)
check('总设置只回显自己的四个字段',
      (d1['tapConfirm'], d1['showCoord'], d1['lastMark'], d1['vibrate']) == (True, False, True, False),
      d1)
st, s3 = call('GET', '/games/gomoku/settings')
check('改总设置没有动到规则默认（两半互不覆盖）',
      s3['rules']['size'] == 19 and s3['rules']['forbidden'] is True, s3['rules'])

st, s4 = call('PUT', '/games/gomoku/settings',
              {'size': 17, 'moveTimeoutSec': 9999, 'totalTimeoutSec': -5})
check('不在档位里的盘面 17 落回默认 15', s4['size'] == 15, s4['size'])
check('超大单步限时落回最大档 120', s4['moveTimeoutSec'] == 120, s4['moveTimeoutSec'])
check('负的总用时落回 0（不限）', s4['totalTimeoutSec'] == 0, s4['totalTimeoutSec'])
st, d2 = call('GET', '/games/settings')
check('改规则没有动到显示偏好',
      (d2['tapConfirm'], d2['showCoord']) == (True, False), d2)

# ==================== 10. 建房时把规则快照进房间 ====================
reset_settings()
call('PUT', '/games/gomoku/settings', dict(RULE_DEFAULTS, size=19, forbidden=True,
                                   moveTimeoutSec=30, totalTimeoutSec=300))

st, r2 = call('POST', '/games/gomoku/rooms', {'side': 1})
check('不传覆盖值时按账号默认建房', st == 200, st)
st, sn = call('GET', '/games/gomoku/rooms/%d' % r2['id'])
check('房间拿到默认 19 路', sn['size'] == 19, sn['size'])
check('房间拿到默认标准规则', sn['forbidden'] is True, sn['forbidden'])
check('房间拿到默认单步 30 秒', sn['moveTimeoutSec'] == 30, sn['moveTimeoutSec'])
check('房间拿到默认总用时 300 秒', sn['totalTimeoutSec'] == 300, sn['totalTimeoutSec'])
check('等待中本步限时为 null（还没开始走）', sn['moveRemainMs'] is None, sn['moveRemainMs'])
check('等待中总用时是满的', sn['myRemainMs'] == 300000, sn['myRemainMs'])
call('POST', '/games/gomoku/rooms/%d/leave' % r2['id'])

st, r3 = call('POST', '/games/gomoku/rooms', {'side': 1, 'size': 13,
                                 'forbidden': False, 'moveTimeoutSec': 0, 'totalTimeoutSec': 0})
st, sn = call('GET', '/games/gomoku/rooms/%d' % r3['id'])
check('建房可当场覆盖成 13 路', sn['size'] == 13, sn['size'])
check('建房可当场覆盖成自由规则', sn['forbidden'] is False, sn['forbidden'])
check('建房可当场取消限时', sn['moveTimeoutSec'] == 0 and sn['totalTimeoutSec'] == 0,
      (sn['moveTimeoutSec'], sn['totalTimeoutSec']))
st, back = call('GET', '/games/gomoku/settings')
check('覆盖只作用于这一局，账号默认没被改',
      back['rules']['size'] == 19 and back['rules']['forbidden'] is True, back['rules'])

# 13 路：x=12 合法、x=13 越界（用房间自己的 size 判，不是写死的 15）
call('POST', '/games/join', {'code': r3['code']}, token=GUEST)
st, e = call('POST', '/games/gomoku/rooms/%d/move' % r3['id'], {'x': 13, 'y': 0})
check('13 路盘面上 x=13 越界被拒', st == 400 and '不合法' in (err(e) or ''), (st, err(e)))
st, e = call('POST', '/games/gomoku/rooms/%d/move' % r3['id'], {'x': 12, 'y': 12})
check('13 路盘面上 x=12 合法', st == 200, (st, err(e)))
call('POST', '/games/gomoku/rooms/%d/resign' % r3['id'], token=GUEST)
call('POST', '/games/gomoku/rooms/%d/leave' % r3['id'])

# ==================== 11. 标准规则：黑方长连判负 ====================
st, r4 = call('POST', '/games/gomoku/rooms', {'side': 1, 'size': 19, 'forbidden': True,
                                 'moveTimeoutSec': 0, 'totalTimeoutSec': 0})
call('POST', '/games/join', {'code': r4['code']}, token=GUEST)
# 黑在 y=0 摆 0,1,2,3,5，最后一手补 4 → 连成 6 个（长连）。
# 注意不能按 0..5 顺序下：下到第 5 个时就已经是「五连」直接赢了，永远走不到六连。
seq = [('H', 0), ('G', 0), ('H', 1), ('G', 2), ('H', 2), ('G', 4),
       ('H', 3), ('G', 6), ('H', 5), ('G', 8)]
for i, (who, x) in enumerate(seq):
    tok = HOST if who == 'H' else GUEST
    st, sn = call('POST', '/games/gomoku/rooms/%d/move' % r4['id'], {'x': x, 'y': 10 if who == 'G' else 0}, token=tok)
    if st != 200:
        check('长连序列第 %d 手' % (i + 1), False, (st, err(sn)))
        break
st, sn = call('POST', '/games/gomoku/rooms/%d/move' % r4['id'], {'x': 4, 'y': 0})
check('黑补上第 6 颗形成长连', st == 200, (st, err(sn)))
check('长连后 status=finished', sn.get('status') == 'finished', sn.get('status'))
check('长连判黑负（白胜）', sn.get('winner') == 2, sn.get('winner'))
check('原因 = overline', sn.get('resultReason') == 'overline', sn.get('resultReason'))
call('POST', '/games/gomoku/rooms/%d/leave' % r4['id'])

# ==================== 12. 计时字段：只走「该走棋的一方」 ====================
st, r5 = call('POST', '/games/gomoku/rooms', {'side': 1, 'size': 15, 'forbidden': False,
                                 'moveTimeoutSec': 120, 'totalTimeoutSec': 600})
call('POST', '/games/join', {'code': r5['code']}, token=GUEST)
st, t1 = call('GET', '/games/gomoku/rooms/%d' % r5['id'])
check('坐下后本步限时开始走', t1['moveRemainMs'] is not None and t1['moveRemainMs'] <= 120000,
      t1['moveRemainMs'])
check('双方总用时都是满的', t1['myRemainMs'] > 590000 and t1['oppRemainMs'] > 590000,
      (t1['myRemainMs'], t1['oppRemainMs']))

time.sleep(2)
st, t2 = call('GET', '/games/gomoku/rooms/%d' % r5['id'])
check('轮到我时我的总用时往下走', t2['myRemainMs'] < t1['myRemainMs'],
      (t1['myRemainMs'], t2['myRemainMs']))
check('没轮到的对手总用时不动', t2['oppRemainMs'] == 590000 or t2['oppRemainMs'] >= t1['oppRemainMs'],
      (t1['oppRemainMs'], t2['oppRemainMs']))
check('本步限时同步在走', t2['moveRemainMs'] < t1['moveRemainMs'],
      (t1['moveRemainMs'], t2['moveRemainMs']))

call('POST', '/games/gomoku/rooms/%d/move' % r5['id'], {'x': 7, 'y': 7})
st, t3 = call('GET', '/games/gomoku/rooms/%d' % r5['id'])
check('落子后本步限时重置回满', t3['moveRemainMs'] > 118000, t3['moveRemainMs'])
check('落子后双方累计用时记在房间里', t3['hostUsedMs'] > 0 and t3['guestUsedMs'] == 0,
      (t3['hostUsedMs'], t3['guestUsedMs']))
call('POST', '/games/gomoku/rooms/%d/resign' % r5['id'], token=GUEST)
call('POST', '/games/gomoku/rooms/%d/leave' % r5['id'])

# ==================== 13. 闲置 5 分钟自动销毁 ====================
# 「闲置」判据是双方的 HostSeenAt / GuestSeenAt 都早于 5 分钟 ——
# 只要还有一个人留在棋盘上（他在轮询，SeenAt 一直在刷）就不会被杀。
# 等 5 分钟不现实，直接把时间戳回拨到 10 分钟前来触发。
import sqlite3, datetime
DB = os.environ.get('QA_DB', 'D:/checkin/site/CheckinApp/data/checkin.db')


def backdate(room_id, minutes):
    old = (datetime.datetime.utcnow() - datetime.timedelta(minutes=minutes)).strftime('%Y-%m-%d %H:%M:%S')
    con = sqlite3.connect(DB, timeout=10)
    try:
        con.execute(
            'UPDATE GameRooms SET HostSeenAt=?, GuestSeenAt=?, CreatedAt=?, UpdatedAt=? WHERE Id=?',
            (old, old, old, old, room_id))
        con.commit()
    finally:
        con.close()


# 新鲜房间不能被误杀
st, f1 = call('POST', '/games/gomoku/rooms', {'side': 1})
st, lobby = call('GET', '/games/gomoku/rooms')
check('刚建的房间不会被闲置回收误杀',
      any(x['id'] == f1['id'] for x in lobby['items']), f1['id'])

# 闲置 10 分钟的空房 → 大厅读一次就该被清掉
backdate(f1['id'], 10)
st, lobby = call('GET', '/games/gomoku/rooms')
check('闲置超过 5 分钟的房间被回收',
      not any(x['id'] == f1['id'] for x in lobby['items']), f1['id'])
st, e = call('GET', '/games/gomoku/rooms/%d' % f1['id'])
check('被回收的房间再访问报「不存在或已被解散」',
      st == 400 and '不存在' in (err(e) or ''), (st, err(e)))

# 对局中：只有一方走了（SeenAt 只旧一半）不该被杀
st, f2 = call('POST', '/games/gomoku/rooms', {'side': 1})
call('POST', '/games/join', {'code': f2['code']}, token=GUEST)
call('GET', '/games/gomoku/rooms/%d' % f2['id'])          # 房主刷一次 SeenAt
con = sqlite3.connect(DB, timeout=10)
try:
    old = (datetime.datetime.utcnow() - datetime.timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M:%S')
    con.execute('UPDATE GameRooms SET GuestSeenAt=? WHERE Id=?', (old, f2['id']))
    con.commit()
finally:
    con.close()
st, lobby = call('GET', '/games/gomoku/rooms')
check('只要还有一个人在看，房间就留着',
      any(x['id'] == f2['id'] for x in lobby['items']), f2['id'])
call('POST', '/games/gomoku/rooms/%d/resign' % f2['id'], token=GUEST)
call('POST', '/games/gomoku/rooms/%d/leave' % f2['id'])

reset_settings()

print('')
print('结果：%d 通过 / %d 失败' % (ok, fail))
sys.exit(1 if fail else 0)
