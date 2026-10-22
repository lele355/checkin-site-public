# 拉起本机 WPS / PowerPoint 放映：方案设计

> **⚠️ 历史文档（2026-10-22 注）**：本方案没有落地。课件播放最终只保留 iframe（金山文档），
> 「上传 PPT → 服务端转图 → 自己翻页」那一套（含本机 COM 放映桥）已整套删除。
> 现役做法见 `PyLab模块-拆除与迁移.md` 第四节。
>
> 结论先行：**能做，但不能靠「插件」，只能靠「本地桥接助手 + COM」。**
>
> 一句话判断：**「零安装」和「双向同步」在技术上是互斥的。** 浏览器沙箱不让网页碰本机进程，唯一的缺口是自定义协议（能"发信号"，不能"读状态"）；要读到「现在第几页」，就必须有一个跑在本机的进程。
>
> 所以三条路各有定位：**助手 = 唯一能同步的解；URI = 省一步的过渡；图片模式 = 不装东西的保底。**
>
> 本文给通信协议、COM 分层、安全设计、分期计划。**不含完整实现**，但含可直接照抄的关键片段。

---

## 一、先把需求拆成四个能力

「拉起放映 + 网页同步」听起来是一件事，实际是四个能力，成本差一个数量级：

| 能力 | 描述 | 纯网页 | 加载项 | 本地助手 |
|---|---|---|---|---|
| ① 拉起 | 网页点一下 → 本机 WPS/PPT 全屏放映 | ❌ | ❌ 只能被动响应 | ✅ |
| ② 正向同步 | 网页点「下一页」→ 放映真的翻 | ❌ | ❌ 方向反了 | ✅ |
| ③ 反向同步 | 老师自己按空格翻 → 网页知道第几页 | ❌ | ⚠️ 需另开 IPC | ✅ |
| ④ 手机遥控 | 手机当遥控器 | ✅ 已有 | ❌ | ✅ 需中继 |

②③ 是「同步」的全部含义。**加载项只解决 ③ 的一半，且要装的东西比助手还重。**

---

## 二、为什么「插件」这条路走不通

### 2.1 PowerPoint 的三类加载项，两类根本管不到放映

| 类型 | 技术 | 能控放映吗 | 部署代价 |
|---|---|---|---|
| **Web 加载项**（Office.js） | HTML+JS，跑在 WebView 里 | **❌ 完全没有 API**。Office.js 对 PowerPoint 只暴露 `PowerPoint.run` / `presentation.slides`，能读写幻灯片**内容**，连「当前是否在放映」都读不到 | 轻（清单文件 + 托管页），但能力为零 |
| **COM / VSTO 加载项** | .NET，跑在 Office 进程内 | ✅ 能，它就是 `Application` 对象模型 | 重：装 VSTO Runtime、32/64 位必须与 Office 一致、仅 Windows 桌面版、发布需签名、每台机器单独装 |
| **WPS 加载项** | JS（wps-js-sdk） | ❌ 以文档内容操作为主，无放映控制接口 | 中：离线 `jsplugins.xml` 分发或走 WPS 商店 |

### 2.2 致命点不是「能力」，是「方向」

即使 VSTO 能控放映，架构上它也是**挂在文档进程里的被动方**：Office 启动 → 加载项被加载 → 它能读写 `Application`。它是一个「被宿主调用」的组件，没有「主动监听外部指令」的入口。

要让它接收网页指令，只有两条路：

1. 加载项里再开一个本地 HTTP 服务 → **那就是一个助手，还多背了一个 Office 版本适配的包袱**；
2. 加载项定时轮询云端的「待执行指令」→ 延迟不可控（秒级），翻页体验直接崩。

**所以：做插件 = 用更大的代价，做助手能做的事。** 这条否决成立，不是"麻烦"，是"架构上多余"。

---

## 三、三条可行路线

### 路线 A：Office URI 唤起（零安装，但做不到"放映"）

`ms-powerpoint:ofv|u|<url>`（`ofe` 打开编辑、`ofv` 打开查看）能让浏览器把远程 PPT 直接交给本机 PowerPoint 打开，**不需要下载到桌面，也不需要装任何东西**。

但有两个硬限制（2026-10-20 核对）：

- **URI 没有「放映」参数**。它只能把文件打开到普通编辑/查看视图，老师还得自己按 F5。命令行才有 `POWERPNT.EXE /s <file>`，而命令行需要本地程序执行权限 —— 又回到助手。
- **无状态**。网页不知道 PPT 打开了没有、放到第几页，一个字都读不到。

> 修正一个常见误解：网上很多文章说 URI 可以「一键放映」，那是把 `/s` 命令行开关和 URI 混淆了。实测不支持。

**定位**：P0 过渡档。收益是「不用下载再双击」，把三步压成一步，保真度 100%。开发半天，作为助手不可用时的备选。

### 路线 B：本地桥接助手（推荐）

一个托盘 exe，只听 `127.0.0.1`，网页通过它控 COM。这是唯一能同时满足 ①②③ 的形态。

### 路线 C：现状图片模式（保底）

已有实现：PPT → PNG + PDF → 网页换图全屏。动画丢失，但**零依赖、手机天然可用**（今天 `PyLab-内嵌PPT播放可行性.md` 已论证过在 2C1.7G 的服务器上"真渲染"不划算）。

**三档共存，运行时按可用性降级：**

```
助手在  → 本机放映（保真 + 双向同步）
助手无  → Office URI 打开（保真，老师自己 F5）
都没有  → 网页图片模式（零依赖，丢动画）
```

---

## 四、推荐架构

### 4.1 组件划分

| 组件 | 位置 | 职责 | 体量 |
|---|---|---|---|
| `PyLabBridge.exe` | 教室电脑 | 托盘常驻、HTTP+SSE、COM 控制、文件缓存 | ~800 行，自包含单文件 ~15MB |
| 网页控制台 | 浏览器 | 探测、配对、指令、状态展示、页码联动 | ~250 行 JS |
| `DeckTicket` 端点 | 服务器 | 给助手发 5 分钟签名下载票据 | ~60 行 |
| SSE 中继（P2） | 服务器 | 手机 ↔ 教室电脑的指令中转 | ~80 行 |

**端口**：固定 `17890`，被占则 `17891…17899` 递进；网页按序探测。

**关键设计：助手只 bind `127.0.0.1`，不 bind `0.0.0.0`。** 这样 Windows 防火墙不会弹「是否允许此程序接受连接」——教室里那个弹窗是灾难，老师会点错。

### 4.2 一次放映的完整时序

```
网页                     助手                       Office/WPS
 │  GET /ping ───────────►│                              │
 │◄──── {ok, engines} ────│                              │
 │  POST /pair ──────────►│ [托盘气泡：是否允许？]        │
 │◄──── {token} ──────────│                              │
 │  POST /open{url,token}►│                              │
 │                        │ 下载 → 解锁 MOTW → 缓存       │
 │                        │ Presentations.Open ─────────►│
 │                        │ SlideShowSettings.Run ──────►│ 全屏放映
 │◄──── {pages:24} ───────│                              │
 │  GET /events (SSE) ───►│ 每 250ms 轮询 CurrentShowPosition
 │◄──── {page:1} ─────────│                              │
 │  点"下一页" ──────────►│                              │
 │  POST /cmd{next} ─────►│ view.Next() ────────────────►│ 翻页
 │◄──── {page:2} ─────────│                              │
 │                        │ 检测到 SlideShowWindows==0    │
 │◄──── {closed} ─────────│                              │
```

### 4.3 延迟预算

| 环节 | 预期 | 依据 |
|---|---|---|
| 网页 → 助手（loopback HTTP） | 1–3 ms | 本机回环 |
| 助手 → Office（COM 跨进程） | 0.5–2 ms | 本机实测 COM 调用量级 |
| 轮询周期（反向同步上限） | 250 ms | 可降到 100ms，CPU 可忽略 |
| 翻页体感总延迟 | **< 300 ms** | 与本地按键盘同级 |

---

## 五、通信协议

### 5.1 接口表

| 方法 | 路径 | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/ping` | 存活探测 + 能力查询 | 无 |
| POST | `/pair` | 配对换 token（弹托盘确认） | 无（一次性） |
| POST | `/open` | 下载并开始放映 | X-PyLab-Token |
| POST | `/cmd` | next / prev / goto / stop | X-PyLab-Token |
| GET | `/events` | SSE 状态流 | X-PyLab-Token |
| GET | `/info` | 当前放映详情（页数、引擎、文件） | X-PyLab-Token |

### 5.2 `/ping`

```json
{
  "ok": true,
  "app": "pylab-bridge",
  "ver": "1.0.0",
  "engines": ["powerpoint"],
  "paired": true,
  "presenting": false
}
```

`engines` 是启动时探到的可用引擎，网页据此显示「将用 PowerPoint 放映」或「将用 WPS 放映」。

### 5.3 `/open`

```json
{
  "url": "https://example.com/PyLab?handler=DeckFile&id=123&t=<签名>",
  "fileName": "第3章-函数.pptx",
  "startAt": 1,
  "display": 2
}
```

- 助手**只接受 URL，不接受本地路径**（安全，见七.5）
- 下载到 `%LOCALAPPDATA%\PyLabBridge\cache\{sha1}.pptx`，命中缓存直接复用
- `display` 指定放映显示器（1=主屏，2=副屏/投影）

### 5.4 `/cmd`

```json
{ "action": "next" }
{ "action": "prev" }
{ "action": "goto", "page": 12 }
{ "action": "stop" }
```

返回统一 `{ "ok": true, "page": 12 }`，失败带 `code`（见 5.6）。

### 5.5 `/events`（SSE）

```
event: page
data: {"page":8,"total":24}

event: closed
data: {"reason":"user-exit"}

event: error
data: {"code":"NEEDS_PAIR","msg":"请在网页上重新配对"}
```

`reason` 取值：`user-exit`（按了 Esc）、`file-closed`（老师关了 PPT）、`engine-crash`。

### 5.6 错误码

| code | 含义 | 网页应对 |
|---|---|---|
| `NEEDS_PAIR` | token 无效/过期 | 重新走配对 |
| `NO_ENGINE` | 本机既无 PPT 也无 WPS | 降级到图片模式，提示装 Office |
| `BUSY` | 已有另一份在放映 | 提示「先结束当前放映」 |
| `DOWNLOAD_FAIL` | 下载 403/超时 | 票据过期，重新取 ticket 重试一次 |
| `OPEN_FAIL` | COM 打开失败（弹窗/损坏） | 弹详情，降级图片模式 |

---

## 六、COM 控制层

### 6.1 引擎探测

```csharp
// PowerPoint 优先（对象模型最完整），WPS 演示兜底
static string? PickEngine()
{
    if (Type.GetTypeFromProgID("PowerPoint.Application") is not null) return "PowerPoint.Application";
    if (Type.GetTypeFromProgID("KWPP.Application")      is not null) return "KWPP.Application";
    return null;
}
```

本机已验证两个 ProgID 同时存在（见附录 C），说明「同一套代码接两家」成立。

### 6.2 打开与放映

```csharp
dynamic app  = Activator.CreateInstance(Type.GetTypeFromProgID(progId))!;
app.Visible  = -1;                    // 两家都强制要求可见，否则 Open 直接 E_FAIL
try { app.DisplayAlerts = 1; } catch { }   // ppAlertsNone，抑制"只读推荐"等弹窗

dynamic pres = app.Presentations.Open(path, -1 /*ReadOnly*/, 0 /*Untitled*/, -1 /*WithWindow*/);

// 指定显示器：ppShowTypeKiosk(3) = 在目标屏全屏且不抢焦点，这是双屏场景的关键
try { pres.SlideShowSettings.ShowType = 3; } catch { }
try { pres.SlideShowSettings.Run(); }
catch { pres.SlideShowSettings.Run(); }   // WPS 偶发首次抛，重试一次
```

> **`ShowType = 3`（Kiosk）很重要**：默认的演示者模式会让 PPT 抢走焦点，老师在笔记本屏点网页按钮时会被弹回 PPT。Kiosk 在副屏全屏、不抢焦点，网页控制台可以一直开着。

### 6.3 翻页：四级降级

WPS 的 COM 是「兼容实现」，不同版本对 `SlideShowWindows` 的支持不一致，必须分层兜底：

| 级别 | 手段 | 适用 |
|---|---|---|
| 1 | `app.SlideShowWindows.Item(1).View.Next()` | PowerPoint 全版本、WPS 新版本 |
| 2 | `app.ActivePresentation.SlideShowWindow.View.Next()` | WPS 部分版本（`SlideShowWindows` 集合为空） |
| 3 | `view.GotoSlide(n, -1)` 绝对跳页 | 上两级能拿到页码时最稳，也支持「跳到第 N 页」 |
| 4 | `PostMessage(hwnd, WM_KEYDOWN, VK_NEXT, 0)` | 前三级全废时的最后手段；需找放映窗口 hwnd，受焦点影响 |

`Next()` / `Previous()` / `GotoSlide(n, -1)` 的 `-1` 是 `msoTrue`。

### 6.4 页码读取与结束检测

```csharp
int cur;
try { cur = (int)view.CurrentShowPosition; }
catch { /* 放映已结束 */ OnClosed("user-exit"); return; }
```

`CurrentShowPosition` 是**当前放映位置**（1-based），Esc 退出后访问会抛 COM 异常 —— 这正好可以当"结束信号"，不需要额外事件订阅。

轮询间隔 250ms：COM 跨进程调用约 1ms，一天 8 小时也就 11 万次调用，CPU 占用可忽略。

### 6.5 生命周期与单实例（.NET 10 的坑）

**`Marshal.GetActiveObject` 在 .NET 5+ 已被移除**，不能靠它去 attach 已运行的 PowerPoint。实际行为是：

- PowerPoint / WPS 都是**单实例 COM 服务器**，`Activator.CreateInstance` 会 attach 到已存在的进程，不会开第二个；
- 所以**绝不能 `app.Quit()`** —— 如果老师本来就开着 PPT 在改课件，Quit 会把他的工作一起关掉（这条在 `PyLabDeckConverter` 里已经踩过，同一原则）；
- 结束放映只做 `pres.Close()`，且用 `try/catch` 包住（用户可能已经手动关掉了）。

助手自身单实例：具名 Mutex `Global\PyLabBridge`，第二个实例启动时激活已有窗口后退出。

### 6.6 文件与 Mark-of-the-Web

从网络下载的 pptx 带 `Zone.Identifier` 备用数据流，PowerPoint 会进**受保护视图**，放映前顶一条黄条，甚至直接拒绝放映。

**必须在 Open 之前删掉**：

```csharp
// 下载完成后立即解锁
File.Delete(path + ":Zone.Identifier");   // 不存在会抛，用 try/catch 吞掉
```

这是最容易漏、又必然踩的一步。

### 6.7 WPS 差异清单（P0 必须逐条实测）

| 项 | PowerPoint | WPS 演示 | 影响 |
|---|---|---|---|
| ProgID | `PowerPoint.Application` | `KWPP.Application` | 探测顺序 |
| `SlideShowWindows` 集合 | ✅ | ⚠️ 部分版本为空 | 决定翻页级别 1 还是 2 |
| `CurrentShowPosition` | ✅ | ⚠️ 需验证 | 反向同步的命门 |
| `DisplayAlerts` | ✅ | ⚠️ 可能不支持 | 弹窗抑制 |
| `ShowType=Kiosk` | ✅ | ⚠️ 需验证 | 双屏不抢焦点 |
| 免费版是否开放 COM | — | ⚠️ 部分版本限制个人版自动化 | **最大不确定性** |
| 启动速度 | 2–4 s | 1–3 s | 体感 |

---

## 七、安全设计

本地 HTTP 服务的攻击面比看起来大：**任何网页（包括恶意页面）都能往 `127.0.0.1:17890` 发请求。** 五道锁：

### 7.1 只绑 loopback
`http://127.0.0.1:17890/`，不绑 `0.0.0.0`。外网、局域网都不可达，也不触发防火墙弹窗。

### 7.2 校验 Host 头（防 DNS rebinding）
攻击者可以把 `evil.com` 解析到 `127.0.0.1`，让浏览器以为在同源。**必须拒绝 `Host` 不是 `127.0.0.1:17890` 的请求**，这是唯一有效的防线。

### 7.3 Origin 白名单
`Access-Control-Allow-Origin` 只回 `https://example.com` 和 `https://www.example.com`，其余直接 403。同时回 `Access-Control-Allow-Private-Network: true` 以通过 Chrome 的私有网络预检。

### 7.4 配对 token
首次使用点「连接本机放映」→ 助手弹托盘确认「pyLab 网页请求控制本机 Office，是否允许？」→ 同意后发一个 32 字节随机 token，网页存 localStorage。之后所有请求带 `X-PyLab-Token`。

这样即使恶意页面猜到了端口，也过不了 Host 校验和 token 两道。

### 7.5 只接受 URL，不接受路径
`/open` 的 `url` 必须以 `https://example.com/` 开头，且域名白名单校验后才下载。**绝不能接受本地路径参数**，否则等于给网页一个「执行任意文件」的入口。

### 7.6 下载走签名票据
课件现在走 `?handler=Image` 验 Cookie 归属，助手是独立进程拿不到 Cookie。新增：

```
GET /PyLab?handler=DeckTicket&id=123
→ { "url": "https://example.com/PyLab?handler=DeckFile&id=123&t=<HMAC>&exp=1730000000",
     "fileName": "第3章-函数.pptx" }
```

`t` = HMAC-SHA256(deckId + exp + 用户id, 服务器密钥)，5 分钟有效、一次性。助手拿它下载，不接触任何用户凭据。

---

## 八、与现有 PyLab 的集成点

### 8.1 服务端：新增两个处理器
- `OnGetDeckTicket`（新增，~40 行）
- `OnGetDeckFile`（新增，~40 行，校验 HMAC 后返回 pptx 原文件）

现有 `PyLabDeck` 表已经存了 `OriginalFileName` 和文件本身，**不需要改表**。

### 8.2 前端：三级降级链

现有「⛶ 全屏播放」按钮拆成两个：

| 按钮 | 行为 |
|---|---|
| **本机放映**（主） | 探测 17890 → 未配对则引导 → 未安装则给 exe 下载链接 |
| ⛶ 网页播放（次） | 现有图片全屏，永远可用 |

探测失败时不要报错弹窗，直接把主按钮降级为 URI 打开链接。

### 8.3 页码联动代码片段（功能③的增值）
现在是「网页翻到第 N 页 → 查 `PyLabDeckSnippets` 显示对应代码」。接了助手后，**老师在 PPT 里自己翻页，网页也能跟着变** —— 手机端/副屏可以自动显示当前页挂的代码片段。这是这个改造最大的意外收获，几乎零成本（前端已有映射表）。

### 8.4 不做的事
- 不解析 pptx 内容（页码映射仍走 `(DeckId, PageNo)` 表）
- 不做离线播放（教室断网就退回图片模式，图片模式需要服务器）
- 不做 Mac / Linux 客户端

---

## 九、部署与分发

用户环境已确认：**教室电脑能装软件、有管理员权限**，所以按「安装版」设计，便携版作为附赠（机房还原卡场景）。

| 项 | 做法 |
|---|---|
| 打包 | `dotnet publish -r win-x64 --self-contained /p:PublishSingleFile=true`，~15MB |
| 安装 | 解压 + 首次运行写 HKCU 自启（`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`），无需管理员 |
| 托盘 | 右键菜单：已连接站点 / 允许配对 / 打开缓存目录 / 退出 |
| 签名 | **强烈建议**。未签名 exe 会被 360/火绒/Defender 拦。OV 代码签名约 ¥600–1500/年；自签名需用户手动装根证书（麻烦但免费） |
| 升级 | 助手启动时 `GET /PyLab?handler=BridgeVersion`，版本不符则托盘提示（不做静默自动更新，避免杀软敏感行为） |
| 卸载 | 托盘「卸载」→ 删自启 + 删缓存目录 |

**分发入口放在 `/PyLab` 页面顶部一条窄横幅**：「本机放映助手 v1.0 · 下载后双击运行即可，无需管理员权限」。

> 环境注：现在 Chrome 138+ 首次访问本地网络会弹「允许访问本地网络」权限框，网页要提前说明，否则老师会以为卡住了。

---

## 十、分期实施

| 期 | 内容 | 工作量 | 产出 |
|---|---|---|---|
| **P0（必做）** | **能力探针**：20 行控制台程序，在目标教室电脑上实测两家 COM 的 6.7 表格 7 项，输出报告 | 半天 | 一份「哪家能用、翻页走哪级」的实测结论 |
| **P1** | 助手 v1：托盘 + HTTP/SSE + COM + 翻页 + 页码回传 + Esc 检测 + MOTW 解锁；网页加「本机放映」+ 配对引导 + 页码联动 | 2 天 | 单机闭环 |
| **P2** | 手机遥控（SSE 中继 + 手机端遥控条）+ 双屏显示器选择 + 演讲者视图 | 1 天 | 课堂实际可用 |
| **P3（按需）** | 代码签名、安装包、自动升级检查 | 0.5 天 | 可对外分发 |

**为什么 P0 必须先做**：整个方案压在「WPS 演示的 COM 能读 `CurrentShowPosition`」这一个假设上。如果目标教室装的是某个阉割了自动化的 WPS 个人版，P1 的 2 天有一半要返工。半天探针可以把这 50% 的风险提前砍掉。

**验收标准**

| 期 | 验收 |
|---|---|
| P0 | 在教室电脑上跑出：引擎名、能否 Open、能否 Run、能否 Next、能否读到 CurrentShowPosition、Kiosk 是否生效 |
| P1 | PowerPoint 与 WPS 各跑通一遍：翻页 20 次 0 失败；页码回传延迟 < 400ms；Esc 退出 1s 内网页收到 `closed`；网页刷新后重新连上不重复配对 |
| P2 | 手机点下一页，投影延迟 < 800ms；双屏时控制台不被 PPT 抢焦点 |

---

## 十一、风险登记

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| WPS 个人版阉割 COM 自动化 | 中 | **高**（方案对本机失效） | P0 探针；失效则只支持 PowerPoint，或让教室装 WPS 专业版 |
| WPS `SlideShowWindows` 为空 | 高 | 中 | 6.3 四级降级，级别 2 覆盖 |
| 未签名 exe 被杀软拦截 | 高 | 中（老师装不上） | 代码签名；下载页附「若被拦截」图文 |
| Chrome 本地网络权限弹窗被忽略 | 高 | 低 | 网页前置说明 + 探测失败时给截图指引 |
| 校园网代理劫持 loopback | 低 | 中（连不上助手） | 探测超时时提示「关闭 VPN/代理后重试」 |
| pptx 进受保护视图 | **高** | 高（放映不了） | 6.6 MOTW 解锁，必须做 |
| pptx 字体缺失导致排版跑版 | 中 | 低（比图片模式好，至少是原文件） | 文档里说明「保真度取决于本机字体」 |
| 多显示器配置错，投到主屏 | 中 | 中 | 网页提供「放映屏」选择，助手按 `display` 指定 |
| 老师误点「退出」后不知如何恢复 | 中 | 低 | `closed` 事件后网页给「重新开始放映」按钮 |

---

## 十二、明确不做

- **不做 Office/WPS 加载项**（第二章已论证架构上多余）
- **不做服务器端真渲染**（`PyLab-内嵌PPT播放可行性.md` 已论证 2C1.7G 扛不住）
- **不做 Mac / Linux 客户端**（教室是 Windows）
- **不做多人同时放映**（一个助手只管一路放映，`BUSY` 拒绝第二路）
- **不做静默自动更新**（杀软对「自己下载并替换 exe」极敏感）

---

## 附录 A：助手侧关键骨架

```csharp
// ── 探测 ──
string? progId = Type.GetTypeFromProgID("PowerPoint.Application") is not null
    ? "PowerPoint.Application"
    : Type.GetTypeFromProgID("KWPP.Application") is not null
        ? "KWPP.Application" : null;

// ── 打开 + 放映 ──
dynamic app = Activator.CreateInstance(Type.GetTypeFromProgID(progId))!;
app.Visible = -1;
try { File.Delete(pptxPath + ":Zone.Identifier"); } catch { }   // 解锁 MOTW
dynamic pres = app.Presentations.Open(pptxPath, -1, 0, -1);
try { pres.SlideShowSettings.ShowType = 3; } catch { }          // Kiosk 不抢焦点
pres.SlideShowSettings.Run();

// ── 翻页（四级）──
bool Step(string act, int? page)
{
    try { dynamic v = app.SlideShowWindows.Item(1).View; Go(v, act, page); return true; }
    catch { }
    try { dynamic v = app.ActivePresentation.SlideShowWindow.View; Go(v, act, page); return true; }
    catch { }
    return KeySim(act);   // PostMessage 兜底
}

void Go(dynamic v, string act, int? page)
{
    if (act == "next") v.Next();
    else if (act == "prev") v.Previous();
    else if (act == "goto") v.GotoSlide(page!.Value, -1);
}

// ── 页码轮询 ──
while (true)
{
    Thread.Sleep(250);
    try
    {
        int cur = (int)app.SlideShowWindows.Item(1).View.CurrentShowPosition;
        if (cur != last) { last = cur; Sse("page", new { page = cur, total }); }
    }
    catch { Sse("closed", new { reason = "user-exit" }); break; }
}
```

## 附录 B：ProgID 与常量速查

| 名称 | 值 |
|---|---|
| PowerPoint COM | `PowerPoint.Application` |
| WPS 演示 COM | `KWPP.Application`（亦有 `Kwpp.Application`） |
| PowerPoint 主程序 | `POWERPNT.EXE`（`/s` 直接放映） |
| WPS 演示主程序 | `wpp.exe`（在 `office6` 目录） |
| `msoTrue` / `msoFalse` | `-1` / `0` |
| `ppAlertsNone` | `1` |
| `ppShowTypeKiosk` | `3`（全屏且不抢焦点） |
| `ppSaveAsPDF` | `32` |

## 附录 C：本机验证记录（2026-10-20）

| 项 | 结果 |
|---|---|
| `PowerPoint.Application` 注册 | ✅ 存在 |
| `KWPP.Application` 注册 | ✅ 存在 |
| WPS 安装路径 | `C:\Program Files (x86)\Kingsoft\office6`（仅 `wpscloudsvr.exe`，主程序在子目录） |
| Office 安装路径 | `C:\Program Files (x86)\Microsoft Office\root\Office16` |
| PPT → PNG 导出（COM） | ✅ 24 页 1920×1080 / 8.6 秒（`PyLabDeckConverter` 在用） |

> 注：本机两个 ProgID 都在，但**目标教室电脑的 WPS 版本**才是决定性的，见 P0 探针。
