# PyLab 模块：拆除与迁移手册

> 《Python 程序设计》教学平台（`/PyLab`）是**先行测试**接入「日常管理」的临时模块。
> 目标是：将来要单独做成一个站点时，能整块搬走；不想留了，能整块删干净。
> 这份文档就是那份「拆装说明书」——**改动模块时请顺手更新它**。
>
> **2026-10-22 变更**：本地的「上传 PPT → 转逐页图片/PDF → 自己翻页」整套方案已**彻底删除**，
> 课件播放只剩 WPS/金山文档 iframe 一条通道（见第四节）。服务器上的 LibreOffice、poppler
> 以及 `data/pylab/` 目录也一并清掉了。

---

## 一、模块边界：哪些文件属于它

全部集中在下面这些位置，**没有一个文件是「半 PyLab 半主站」**（最后一个除外，见注）。

| 层 | 文件 | 说明 |
|---|---|---|
| 实体 | `Models/PyLabEntities.cs` | 6 个实体（学生 / 考勤 / 片段分类 / 片段 / PPT 链接 / PPT 挂载） |
| EF 映射 | `Data/AppDbContext.PyLab.cs` | `partial class AppDbContext`，含 6 个 `DbSet` + 索引/级联 |
| 迁移 | `Migrations/*_AddPyLabModule.cs`、`*_AddPyLabSnippets.cs`、`*_AddPyLabWpsDecks.cs`（各带 `.Designer.cs`） | 建表 |
| 服务 | `Services/PyLabBridge.cs` | 与 Python 子进程通信（stdin/stdout JSON） |
| 服务 | `Services/PyLabRosterParser.cs` | 名单解析（xlsx / csv / txt，含 GBK 兜底） |
| 页面 | `Pages/PyLab.cshtml` | 三个视图的全部 UI + 本页专用 `<style>` + 本页专用 JS |
| 页面 | `Pages/PyLab.cshtml.cs` | PageModel 本体（鉴权、公共返回格式、Python 桥转发） |
| 页面 | `Pages/PyLab.Roster.cs` | partial：点名 / 名单 / 考勤处理器 |
| 页面 | `Pages/PyLab.Wps.cs` | partial：PPT 链接增删改 + 整份挂载处理器 |
| Python | `tools/pylab/main.py` + `tools/pylab/uishim/` | 代码执行器（零第三方依赖，同时是交作业的控制台版） |

**没有任何运行时文件落在磁盘上**：PPT 本体在金山文档那边，本站只存一条链接；
代码片段源码直接存库；名单/考勤全在 SQLite 里。所以拆模块不用处理数据目录。

**唯一与主站共享的两行配置**（删模块时删这两行，主站功能不受影响）：

```csharp
// Security/NavCatalog.cs —— 侧栏「工具」分组里加一项
new("pylab", "Python 教学", "list", "/PyLab", "pylab.use", GroupTool, true),

// Security/PermissionCatalog.cs —— 注册权限码
// 启动时自动同步进 Permissions / RolePermissions，不用手改库、不用写迁移
```

`CheckinApp.csproj` 里还有三条 `Content`（把 `tools/pylab/**` 复制到输出目录），拆模块时一并删：

```xml
<Content Include="tools\pylab\main.py" CopyToPublishDirectory="PreserveNewest" />
<Content Include="tools\pylab\uishim\**\*.py" CopyToPublishDirectory="PreserveNewest" />
<Content Update="tools\pylab\snippets_extra.json" CopyToPublishDirectory="PreserveNewest" />
```

`Program.cs`、`nginx`、`systemd` **完全没为 PyLab 改动过**——它就是一个普通 Razor 页面。

---

## 二、拆除步骤（从主站移除）

```bash
# 1. 删文件（在仓库根 D:/projects/checkin/CheckinApp）
rm -f Models/PyLabEntities.cs
rm -f Data/AppDbContext.PyLab.cs
rm -f Services/PyLabBridge.cs Services/PyLabRosterParser.cs
rm -f Pages/PyLab.cshtml Pages/PyLab.cshtml.cs Pages/PyLab.Roster.cs Pages/PyLab.Wps.cs
rm -rf tools/pylab
rm -f Migrations/*_AddPyLabModule.cs Migrations/*_AddPyLabModule.Designer.cs
rm -f Migrations/*_AddPyLabSnippets.cs Migrations/*_AddPyLabSnippets.Designer.cs
rm -f Migrations/*_AddPyLabWpsDecks.cs Migrations/*_AddPyLabWpsDecks.Designer.cs

# 2. 删侧栏与权限两行（NavCatalog.cs / PermissionCatalog.cs）

# 3. 删 csproj 里的 tools/pylab 三行

# 4. 编译 —— 会剩一个「空实现」的挂载点，可以不管：
#    Data/AppDbContext.cs 里的 partial void OnModelCreatingPyLab(ModelBuilder m);
#    只声明不实现，C# 会把它连同调用一起优化掉，编译零错误零警告。
#    （想彻底干净就把那行声明和 OnModelCreating 里的同名调用一起删）

# 5. 清库：线上不要手删表，发一个 RemovePyLab 迁移更稳
#    （先把 6 个实体的 DbSet 从 partial 文件里注释掉，让 EF 认为表多余，再 migrations add）
```

本地想直接手删的话：

```bash
sqlite3 data/checkin.db "
  DROP TABLE IF EXISTS PyLabWpsMounts;
  DROP TABLE IF EXISTS PyLabWpsDecks;
  DROP TABLE IF EXISTS PyLabSnippetCategories;
  DROP TABLE IF EXISTS PyLabSnippets;
  DROP TABLE IF EXISTS PyLabAttendances;
  DROP TABLE IF EXISTS PyLabStudents;
  DELETE FROM RolePermissions WHERE PermissionId IN (SELECT Id FROM Permissions WHERE Code='pylab.use');
  DELETE FROM Permissions WHERE Code='pylab.use';
  DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE '%_AddPyLab%';"
```

---

## 三、迁移步骤（单独做成一个站点）

模块内部**只依赖 4 样主站的东西**，替换掉就能独立：

| 依赖 | 用在哪 | 独立时怎么替 |
|---|---|---|
| `AppDbContext` | 全部处理器 | 新建一个只含 6 个 `DbSet` 的 DbContext（`Data/AppDbContext.PyLab.cs` 整个搬过去就是现成的） |
| `CurrentUser`（`Services/CurrentUser.cs`） | 取当前用户 id / 显示名 / 权限 | 换成自己的登录态（Session / JWT 都行），把 `Me.Id` 换成 `currentUserId` |
| `[Authorize(Policy="perm:pylab.use")]` | 页面鉴权 | 换成 `[Authorize]` 或自建策略 |
| 站点 CSS 令牌（`--card` / `--text` / `--radius` …） | `PyLab.cshtml` 内联样式 | 保留 `tokens.css` 即可；本页的控件皮肤写在页面 `<style>` 里，不依赖 `site.css` |

页面脚本是**自包含 IIFE**，只用原生 `fetch` / `DOM`，不依赖 `site.js` 的 `window.app`：
唯一需要留意的是 pjax（`site.js` 会重放 `<script>`），所以状态都挂在 `window.__pyLab` 上靠 `P.ver` 判重——
独立站点没有 pjax 时这套逻辑退化成「正常初始化一次」，不影响功能。

**数据搬家**：名单与考勤两张表按 `UserId` 隔离，导出时按用户过滤即可；
代码片段、片段分类、PPT 链接、PPT 挂载是**全员共享**的，`UserId` 只作创建者留档，整表搬走即可：

```sql
SELECT * FROM PyLabStudents WHERE UserId = 1;
SELECT * FROM PyLabAttendances WHERE UserId = 1;
SELECT * FROM PyLabSnippets;         -- 共享，整表搬
SELECT * FROM PyLabWpsDecks;
```

---

## 四、课件播放：只有 iframe（金山文档）一条路

| 做法 | 状态 | 依赖 |
|---|---|---|
| 金山文档 / WPS 分享链接 → `<iframe>` 嵌它的网页版播放器 | **现役**，唯一通道 | 无（站点只存链接） |
| 上传 PPT → LibreOffice/PowerPoint COM 转 PDF → pdftoppm 转 PNG → 自己翻页 | **2026-10-22 已彻底删除** | 曾是 `libreoffice-impress` + `poppler-utils` + `fonts-noto-cjk` |

删掉本地方案的原因：要在服务器装一整条转换链（LibreOffice + poppler 约 500MB），
2C2G 机器上转一份 40 页课件要几十秒，还要自己管磁盘清理；而金山文档那边本来就能播，
本站嵌 iframe 就够了。代价是**拿不到页数**，所以代码只能挂到「整份 PPT」，
不能再像以前那样精确到第 N 页。

服务端要点：

- 链接白名单钉死在 `kdocs.cn` / `wps.cn`（`Pages/PyLab.Wps.cs` 的 `TryNormalizeWpsUrl`），
  **不能**当通用 iframe 用，否则等于给全站用户开一个钓鱼入口。
- 播放地址会拼 `?simple=1&readonly`（勾了「简化只读」时），去掉参数就是原始分享页。
- 跨域 iframe 探测不到白屏，页面上的提示语是兜底：先「新窗口打开」完成一次登录，再「重新载入」。
- 服务器上如果还残留转换环境，可这样清（2026-10-22 已执行过）：

```bash
# 卸载转换链（fonts-noto-cjk 保留：绘图沙箱还要用它出中文图）
sudo apt-get purge -y libreoffice-impress libreoffice-core libreoffice-common poppler-utils
sudo apt-get autoremove -y
rm -rf /var/www/checkin/data/pylab
```

---

## 五、已知边界（刻意不做的事）

- **按页挂代码**：iframe 取不到页数，代码只能挂到整份 PPT（这是删掉本地方案的直接代价）。
- **代码/PPT 链接全员共享**：任何有 `pylab.use` 的人都能增删改，`UserId` 只用来显示「谁建的」；
  **名单与考勤仍按用户隔离**。
- **动画 / 切换效果**：交给金山文档自己播，本站不关心。
- **手机端**：按需求不做适配，手机上能用但主要是桌面/投屏场景。
