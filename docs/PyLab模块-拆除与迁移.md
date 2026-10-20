# PyLab 模块：拆除与迁移手册

> 《Python 程序设计》教学平台（`/PyLab`）是**先行测试**接入「日常管理」的临时模块。
> 目标是：将来要单独做成一个站点时，能整块搬走；不想留了，能整块删干净。
> 这份文档就是那份「拆装说明书」——**改动模块时请顺手更新它**。

---

## 一、模块边界：哪些文件属于它

全部集中在下面这些位置，**没有一个文件是「半 PyLab 半主站」**（最后一个除外，见注）。

| 层 | 文件 | 说明 |
|---|---|---|
| 实体 | `Models/PyLabEntities.cs` | 5 个实体（学生 / 考勤 / 分类 / 课件 / 页码挂载） |
| EF 映射 | `Data/AppDbContext.PyLab.cs` | `partial class AppDbContext`，含 5 个 `DbSet` + 索引/级联 |
| 迁移 | `Migrations/*_AddPyLabModule.cs`（+ `.Designer.cs`） | 只建这 5 张表 |
| 服务 | `Services/PyLabBridge.cs` | 与 Python 子进程通信（stdin/stdout JSON） |
| 服务 | `Services/PyLabDeckConverter.cs` | PPT → 逐页 PNG（Windows 走 PowerPoint COM / Linux 走 LibreOffice） |
| 服务 | `Services/PyLabRosterParser.cs` | 名单解析（xlsx / csv / txt，含 GBK 兜底） |
| 页面 | `Pages/PyLab.cshtml` | 四个 tab 的全部 UI + 本页专用 `<style>` + 本页专用 JS |
| 页面 | `Pages/PyLab.cshtml.cs` | PageModel 本体（鉴权、路径、Python 桥转发） |
| 页面 | `Pages/PyLab.Roster.cs` | partial：点名 / 名单 / 考勤处理器 |
| 页面 | `Pages/PyLab.Deck.cs` | partial：课件上传 / 分类 / 翻页 / 挂代码处理器 |
| Python | `tools/pylab/main.py` | ③④ 的代码执行器（零第三方依赖，同时是交作业的控制台版） |
| 运行时数据 | `data/pylab/{userId}/deck_{id}/p{n}.png` | 课件图片，**不在 wwwroot**，走 `?handler=Image` 鉴权后读 |

**唯一与主站共享的两行配置**（删模块时删这两行，主站功能不受影响）：

```csharp
// Security/NavCatalog.cs —— 侧栏「工具」分组里加一项
new("pylab", "Python 教学", "list", "/PyLab", "pylab.use", GroupTool, true),

// Security/PermissionCatalog.cs —— 注册权限码
// 启动时自动同步进 Permissions / RolePermissions，不用手改库、不用写迁移
```

`CheckinApp.csproj` 里还有一行 `Content`（把 `tools/pylab/**` 复制到输出目录），拆模块时一并删：

```xml
<Content Include="tools\pylab\**" CopyToOutputDirectory="PreserveNewest" />
```

`Program.cs`、`nginx`、`systemd` **完全没为 PyLab 改动过**——它就是一个普通 Razor 页面。

---

## 二、拆除步骤（从主站移除）

```bash
# 1. 删文件（在仓库根 D:/projects/checkin/CheckinApp）
rm -f Models/PyLabEntities.cs
rm -f Data/AppDbContext.PyLab.cs
rm -f Services/PyLabBridge.cs Services/PyLabDeckConverter.cs Services/PyLabRosterParser.cs
rm -f Pages/PyLab.cshtml Pages/PyLab.cshtml.cs Pages/PyLab.Roster.cs Pages/PyLab.Deck.cs
rm -rf tools/pylab
rm -f Migrations/*_AddPyLabModule.cs Migrations/*_AddPyLabModule.Designer.cs

# 2. 删侧栏与权限两行（NavCatalog.cs / PermissionCatalog.cs）

# 3. 删 csproj 里的 tools/pylab Content 一行

# 4. 编译 —— 会剩一个「空实现」的挂载点，可以不管：
#    Data/AppDbContext.cs 里的 partial void OnModelCreatingPyLab(ModelBuilder m);
#    只声明不实现，C# 会把它连同调用一起优化掉，编译零错误零警告。
#    （想彻底干净就把那行声明和 OnModelCreating 里的同名调用一起删）

# 5. 清库（可选）：删 5 张表 + 权限行
sqlite3 data/checkin.db "
  DROP TABLE IF EXISTS PyLabDeckSnippets;
  DROP TABLE IF EXISTS PyLabDecks;
  DROP TABLE IF EXISTS PyLabDeckCategories;
  DROP TABLE IF EXISTS PyLabAttendances;
  DROP TABLE IF EXISTS PyLabStudents;
  DELETE FROM RolePermissions WHERE PermissionId IN (SELECT Id FROM Permissions WHERE Code='pylab.use');
  DELETE FROM Permissions WHERE Code='pylab.use';
  DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE '%_AddPyLabModule';"

# 6. 删已上传的课件图片
rm -rf data/pylab
```

> 注意：线上库不要手删表，直接发一个 `RemovePyLab` 迁移更稳妥（`dotnet ef migrations add RemovePyLab`
> 前先把 5 个实体的 `DbSet` 从 partial 文件里注释掉，让 EF 认为表多余）。

---

## 三、迁移步骤（单独做成一个站点）

模块内部**只依赖 4 样主站的东西**，替换掉就能独立：

| 依赖 | 用在哪 | 独立时怎么替 |
|---|---|---|
| `AppDbContext` | 全部处理器 | 新建一个只含 5 个 `DbSet` 的 DbContext（`Data/AppDbContext.PyLab.cs` 整个搬过去就是现成的） |
| `CurrentUser`（`Services/CurrentUser.cs`） | 取当前用户 id / 显示名 / 权限 | 换成自己的登录态（Session / JWT 都行），把 `Me.Id` 换成 `currentUserId` |
| `[Authorize(Policy="perm:pylab.use")]` | 页面鉴权 | 换成 `[Authorize]` 或自建策略 |
| 站点 CSS 令牌（`--card` / `--text` / `--radius` …） | `PyLab.cshtml` 内联样式 | 保留 `tokens.css` 即可；本页的控件皮肤写在页面 `<style>` 里，不依赖 `site.css` |

页面脚本是**自包含 IIFE**，只用原生 `fetch` / `DOM`，不依赖 `site.js` 的 `window.app`：
唯一需要留意的是 pjax（`site.js` 会重放 `<script>`），所以状态都挂在 `window.__pyLab` 上靠 `P.ver` 判重——
独立站点没有 pjax 时这套逻辑退化成「正常初始化一次」，不影响功能。

**数据搬家**：5 张表靠 `UserId` 隔离，导出时按用户过滤即可：

```sql
-- 导出某位老师的全部数据（换库后改 UserId 再导入）
SELECT * FROM PyLabStudents WHERE UserId = 1;
SELECT * FROM PyLabAttendances WHERE UserId = 1;
...
```

课件图片在 `data/pylab/{userId}/deck_{id}/`，跟着数据库里的 `PyLabDecks.Id` 对应，
搬的时候整目录拷过去，`deck_{id}` 编号不变就能直接用。

---

## 四、PPT 转图片：两个后端

| 平台 | 引擎 | 依赖 | 保真度 |
|---|---|---|---|
| Windows | PowerPoint COM | 装 Office（本机 Office16 实测 24 页 8.6 秒） | 100% |
| Linux | LibreOffice → PDF → pdftoppm | `libreoffice-impress` + `poppler-utils` + `fonts-noto-cjk` | 版式/文字/图片都在，动画与切换效果不保留 |

- 两者都没装时，上传会**明确报错并给出安装命令**（不会静默失败）。
- 转换是**串行**的（`SemaphoreSlim(1,1)`）：PowerPoint 单实例，2C2G 服务器也扛不住并发转换。
- Linux 每次转换用独立 profile（`-env:UserInstallation=file:///tmp/...`），避免并发锁死。
- **必须装 `fonts-noto-cjk`**，否则中文全是豆腐块（□□□）。

服务器安装（一次性）：

```bash
sudo apt update
sudo apt install -y libreoffice-impress poppler-utils fonts-noto-cjk
soffice --version && pdftoppm -v
```

验证：`/PyLab` → 课件库 → 页头右侧「转换引擎」应显示 `LibreOffice（版式保真）`。

---

## 五、已知边界（刻意不做的事）

- **动画 / 切换效果 / 视频 / 超链接**：静态图片方案天然不支持。要保留就得嵌播放器，代价是版权与兼容性问题。
- **`.ppt` 老格式**：LibreOffice 能读，PowerPoint COM 也能读，但名单导入只支持 `.xlsx / .csv / .txt`（老 `.xls` 明确报错）。
- **多人同时上传**：串行转换，第二个会排队（前端有进度条，不会看起来像卡死）。
- **手机端**：按需求不做适配，手机上能用但主要是桌面/投屏场景。
