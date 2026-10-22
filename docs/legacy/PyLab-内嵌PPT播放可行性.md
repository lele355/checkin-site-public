# 内嵌 PPT 播放：可行性分析（理论篇）

> **⚠️ 历史文档（2026-10-22 注）**：最终选的是 iframe（金山文档）方案；
> 「上传 PPT → 服务端转图」那条路已于 2026-10-22 整套删除（连 LibreOffice 一起卸了）。
> 现役做法见 `PyLab模块-拆除与迁移.md` 第四节。
>
> 结论先行：**五条路理论上都走得通，区别只在「要不要真动画」和「这台 2C1.7G 的机器扛不扛得住」。**
> 本文只做可行性判断与选型，不含实现代码。

---

## 一、先把「内嵌播放」拆清楚

现在的实现是：PPT → 逐页 PNG（160 DPI，1600×900）→ 前端换图翻页 + 键盘 + 全屏。
它**已经是"播放"**，缺的只是这四样：

| 能力 | 现状 | 说明 |
|---|---|---|
| 页内动画（淡入、飞入、路径） | ❌ | 图片是死的，只能靠 CSS 近似 |
| 切换效果（推、擦除、Morph） | ❌ | 同上 |
| 嵌入视频 / 音频 | ❌ | `soffice --convert-to` 不导出这些流 |
| 超链接 / 触发动作 | ❌ | 图片上没有热区 |

所以「能不能内嵌 PPT 播放」这个问题，真正的问法是：**要不要为了这四样，在服务器上再养一个能"跑"PPT 的引擎？**

---

## 二、服务器实况（2026-10-20 实测，不是估算）

| 项 | 数值 | 对选型的意义 |
|---|---|---|
| CPU / 内存 | 2 vCPU / **1735MB**（可用 ~1089MB）+ 2GB swap | 装"在线 Office"级别组件会很紧张 |
| 磁盘 | 40GB，剩 30GB | 视频/容器镜像都放得下 |
| Docker / Podman | **都没有** | 选容器方案要先装 Docker（+~500MB） |
| ffmpeg / Xvfb | **都没有**，apt 可装（ffmpeg 8.0.1、xvfb 21.1.22） | 录屏烘焙视频这条路只差这两个包 |
| python3-uno | **已存在**（`/usr/lib/python3/dist-packages/uno.py`） | 可用 UNO 精确控制 Impress 放映（关键！） |
| LibreOffice | 26.2.6.3（impress + core + common） | 已有真渲染引擎，只缺"能显示的窗口" |

---

## 三、五条路线

### 路线 1：Collabora Online / OnlyOffice 文档服务器（真·在线放映）

**原理**：服务端常驻一个「浏览器里的 Office」。PPTX 由服务端的 LibreOffice 内核真正加载，浏览器通过 WebSocket 收到的不是图片而是渲染瓦片/画布；放映时是引擎逐帧绘制，所以**切换、动画、视频都能真放**。

**需要的组件**：
- Docker（本机没有）+ 镜像（Collabora ~1.5GB／OnlyOffice ~2GB）
- **WOPI 宿主端**：我们的 ASP.NET 要额外实现 `CheckFileInfo` / `GetFile` / `PutFile` 等接口，并做令牌校验 —— 这不是"装个组件"，是**写一块对接逻辑**
- 独立子域名 + WebSocket 反代（`proxy_read_timeout` 要开到 10 小时级）

**资源**：Collabora 官方最低 2 核 / 1GB + 100MB 每用户；OnlyOffice 社区版最低 2 核 / 2GB（20 并发）。
**本机判断**：只剩 1.09GB 可用，容器常驻 1.3GB 起 → **会把 swap 打满，和 dotnet/nginx 抢内存。理论上可行，这台机器上不可行。**换 4GB 内存的实例才谈得上。

**另外**：它是**常驻服务**，会破坏 PyLab「整块删掉就干净」的可拆卸设计。

---

### 路线 2：Xvfb + UNO + ffmpeg，把放映"录"成 MP4（推荐做 POC）

**原理**：给 LibreOffice 一个虚拟显示器，用 UNO 让 Impress 真正进入放映状态（动画会真实播放），ffmpeg 抓屏编码成 MP4。前端用 `<video>` 内嵌播放。

**为什么这条路最有意思**：
- **不需要 Docker，不需要第二台机器**，只装 `xvfb` + `ffmpeg`（约 250MB）
- **python3-uno 服务器上已经有了**，能精确控制「播完当前页动画 → 下一页」
- 产出是**一个 MP4 文件**：全屏、倍速、拖动进度、手机/投屏全兼容，浏览器原生支持，零 JS 依赖
- 资源占用约 400–450MB（Xvfb 30M + soffice 250M + ffmpeg 150M），**和现在的 soffice 转换一个量级**

**代价（必须说清楚）**：
| 代价 | 量级 | 缓解 |
|---|---|---|
| 编码吃 CPU | 2 核软件编码 720p≈1–2 倍速，**10 分钟课件要录 5–10 分钟** | 降帧率到 15fps、`-preset ultrafast`；做成后台队列 |
| 不是"可交互播放" | 只能按时轴跳页 | 记录「页 → 时间戳」映射，页码按钮 = `video.currentTime = t[N]` |
| 音频要虚拟声卡 | pulseaudio/alsa null sink | 一期可以先只录画面（讲课本来是自己讲） |
| 动画保真度 | Impress 的 Morph 等复杂过渡会降级 | 用 `SAL_USE_VCLPLUGIN=gen` 走无加速路径；如实告知 |
| 磁盘 | 静态幻灯片 10 分钟 720p ≈ 10–30MB | 比 40 页 PNG 的 47MB 还小 |

**判断：理论上完全可行，本机也跑得动，是唯一「真动画 + 不升内存」的路子。**

---

### 路线 3：PowerPoint COM 导出视频（Windows only）

`Presentation.CreateVideo(path, 1080, 30, 90)` 一行就能把 PPT 连动画带旁白导成 MP4，质量最好。
**但需要 Windows + Office**：你本机有 Office16（可以本地转好再传），**服务器是 Ubuntu，装不了**。
→ 只适合「自己的课件」，不能作为站内功能。

---

### 路线 4：PDF + PDF.js（不是播放，但性价比最高）

已有的 `--convert-to pdf` 产物直接用 PDF.js 渲染，矢量文字任意缩放都清晰。
**实测对比（同一份 40 页带图课件）**：PDF **1.2MB**，PNG 一套 **47MB**（约 1/40）。

- 优点：清晰度、流量、磁盘全面胜出；PDF.js 是成熟库
- 缺点：**没有动画**，本质还是逐页
- 判断：**如果目标是"看得清、翻得快"，这是最划算的一步**

---

### 路线 5：现状 + CSS 过渡（零成本）

给 PNG 翻页加 crossfade / 横向推入，观感接近「切换效果」。
但页内动画依然没有 —— 属于"打磨"而不是"能力升级"。**1 小时能做完。**

---

## 四、横向对照

| 路线 | 页内动画 | 视频/音频 | 常驻内存 | CPU 峰值 | 新增依赖 | 本机可行 | 工程量 |
|---|---|---|---|---|---|---|---|
| 1 Collabora / OnlyOffice | ✅ | ✅ | 1.3–2 GB | 中 | Docker + WOPI 对接 | ❌ 内存不够 | 3–5 天 |
| 2 Xvfb + ffmpeg 烘焙 MP4 | ✅ | ✅（需声卡） | ~450 MB | **高（编码）** | xvfb、ffmpeg | ✅ | 2–3 天 |
| 3 PowerPoint COM | ✅ | ✅ | — | — | Windows | ❌ 服务器不支持 | 1 天（本地） |
| 4 PDF.js | ❌ | ❌ | ≈0 | 低 | PDF.js | ✅ | 0.5–1 天 |
| 5 现状 + CSS 过渡 | ❌ | ❌ | 0 | 0 | 无 | ✅ | 1 小时 |

---

## 五、推荐顺序

1. **路线 5**（顺手做，1 小时）—— 翻页不再"硬切"，观感立刻不一样。
2. **路线 4**（半天）—— 清晰度和流量的性价比之王；可以做成「图片模式 / 矢量模式」二选一。
3. **路线 2**（2–3 天，真要动效再做）—— 播放器并存两种模式：
   - **逐页模式**（PNG，随时停、随时跳，讲课时用）
   - **放映模式**（MP4，动画完整，演示时用）
   这两种恰好覆盖课堂的两种用法，比单纯追求"全都要"更实用。
4. **路线 1**（换机器再说）—— 只有当你需要"学生也能在线打开、甚至改 PPT"时才值得。

---

## 六、路线 2 的落地步骤（如果决定做）

```bash
# 1. 装依赖（约 250MB）
sudo apt install -y xvfb ffmpeg

# 2. 常驻一个虚拟显示器（systemd unit：Xvfb :99 -screen 0 1280x720x24）
# 3. 用一个常驻 soffice 监听 UNO socket：
soffice --headless --invisible --norestore --nologo \
        --accept="socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext" &

# 4. python3-uno 脚本：加载 pptx（Hidden=false）→ Presentation.start()
#    → 每页等动画结束再 gotoNextEffect()，同时记录「页 → 时间戳」
# 5. 并行开 ffmpeg 抓屏：
ffmpeg -f x11grab -video_size 1280x720 -framerate 15 -i :99.0 \
       -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p deck.mp4
# 6. 结束后把 (deckId, 页码, 秒数) 写进 PyLabDeckPages 表，前端页码按钮 seek
```

**主要风险点**（按发生概率排序）：
1. Impress 在 Xvfb 下启动放映报 GL 缺失 → 用 `SAL_USE_VCLPLUGIN=gen` 强制软件渲染
2. 每页停留时长拿不到（PPT 的自动换片时间是可选属性）→ 退化策略：默认 8 秒/页，或按"动画个数"估算
3. 2 核编码期间站点变慢 → 已有串行闸门 `SemaphoreSlim(1,1)`，天然限流；再给个夜间队列更稳
4. 中文/特殊字体在录制里变豆腐块 → 已装 `fonts-noto-cjk`，但用户自带字体（如方正）仍会替换

---

## 七、一句话总结

**装个"播放组件"这件事，技术上是伪命题**——能放 PPT 的只有三种东西：真渲染器（Collabora / LibreOffice）、预先烘焙的视频、或者 Windows 里的 PowerPoint。
按这台机器的条件：**Collabora 装不下（要 4GB），PowerPoint 装不了（要 Windows），所以"真动画"只能靠 Xvfb 录屏。**
而如果只是想"讲课时翻得顺、字看清"，PDF.js 加 CSS 过渡是花最小代价就能拿到的收益。

---

## 八、附：WPS Office for Linux 能不能顶替？

**有 Linux 版**：官方 `linux.wps.cn`，当前 **12.1.2.28080（2026-08-11）**，提供 deb / rpm 两种 64 位包（约 350MB），个人版免费，支持 Ubuntu / Debian / Deepin / UOS / 麒麟 / Fedora 等，含「WPS 演示」。

**但对"服务端渲染/播放"这件事没有帮助**，原因三条：

| 需求 | WPS Linux | 说明 |
|---|---|---|
| 无头转图（`--convert-to png`） | ❌ | 官方博客明确：它是**桌面套件，不是 headless 服务**，没有官方无头模式；网上流传的 `wps --headless --convert-to` 多是把 LibreOffice 的参数表套过来的误传 |
| 可编程控制放映（UNO 那种） | ❌ | Windows 版有 COM/VBA，Linux 版没有对等物；没有 API 就没法"播完这页再下一页" |
| 嵌进网页 | ❌ | 同上，除非走 WPS 365 / 金山文档的在线预览（企业级、需采购与独立服务器） |

**结论**：WPS Linux 适合"自己电脑上检查课件显示效果"，替代不了 `soffice` 这条服务端管线。
真要用 WPS 引擎做在线播放，唯一正规路径是 **WPS 365 私有化 / 金山文档在线预览**——本质仍是"养一个服务"，和路线 1 同类，且是商业授权。

---

## 八、落地记录：路线 4 + 路线 5 已实现（2026-10-20）

前面五条路线里，**路线 4（PDF.js 矢量）与路线 5（CSS 过渡）做完了**，路线 2 保留为「真要动效再说」。

### 改了什么

| 位置 | 改动 |
|---|---|
| `Services/PyLabDeckConverter.cs` | 新增 `PdfName = "deck.pdf"`；PowerPoint 分支顺手 `SaveAs(…, 32)` 导 PDF、LibreOffice 分支把已经生成的那份 PDF 拷进课件目录。**PDF 拷贝失败只记日志、不让转换失败**（PNG 才是主产物） |
| `Pages/PyLab.Deck.cs` | `Decks` 每条记录多回 `hasPdf` / `pdfMb`（直接看目录里有没有 `deck.pdf`，不加库字段）；新增 `OnGetPdf`（鉴权 + `FileStreamResult` + `EnableRangeProcessing`） |
| `Pages/PyLab.cshtml` | 工具栏加「矢量 / 图片」开关；`<canvas>` 与 `<img>` 同位；PDF.js 按需加载；翻页淡入 |
| `wwwroot/lib/pdfjs/` | pdf.js 3.11.174（`pdf.min.js` 320KB + worker 1MB） |
| `wwwroot/sw.js` | 静态缓存规则加 `lib/`，PDF.js 不再每次重下 |

### 几个必须记住的技术点

1. **PageModel 的 `PhysicalFile` 没有 Range 重载** —— 它只有 `(物理路径, 类型, 下载名)` 三个。
   PDF.js 是按 Range 分段拉字节流的，所以这里必须手写 `FileStreamResult { EnableRangeProcessing = true }`，实测 `Range: bytes=0-1023` → 206 + 1024 字节。
2. **出图分辨率跟着容器和屏幕走**：`位图尺寸 = 容器 CSS 尺寸 × min(devicePixelRatio, 2)`。
   同一份 PDF，窗口态画 663×373，全屏重画成 1440×810 —— 这正是「放大不糊」的来源，所以 `resize` 与 `fullscreenchange` 都要重画一次。
3. **老课件没有 PDF 要优雅降级**：`hasPdf = false` 时开关直接藏掉、自动走图片模式；
   如果 PDF 拉到一半失败（文件被清、worker 被拦），当场切回图片模式并提示，绝不留黑屏。
4. **淡入不能卡在 `opacity:0`**：`<img>` 靠 `onload` 把透明度推回 1，canvas 靠 `render().promise` 之后推回 1；
   `prefers-reduced-motion: reduce` 时整段跳过（自动化测试正是 reduce 模式，否则会误判「白屏」）。

### 实测数据（本机 PowerPoint 引擎，18 页带图课件）

| 产物 | 体积 | 说明 |
|---|---|---|
| 逐页 PNG（18 张 1920×1080） | **13.4 MB** | 翻页最稳，老设备也不挑 |
| 同一份 `deck.pdf` | **3.0 MB** | 矢量文字，等比省 78% 流量 |

验收：`qa/qa_slide_vector.js` **43/43 通过**（接口 + Range + 播放器 + 全屏重画 + 模式记忆 + 越权 + 降级 + 动效）。

### 线上仍缺的一环

服务器**没装 LibreOffice**（`soffice`/`pdftoppm` 都不在），所以线上上传 PPT 依旧会明确报错，
这份矢量模式目前只在装了 Office 的本机可用。要在线上生效，得先
`apt install libreoffice-impress poppler-utils fonts-noto-cjk`（约 400MB，2C/1.7G 的机器扛得住但会紧）。
