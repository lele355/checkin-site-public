# 日常管理 · 网页端

个人生活管理站点（打卡 / 日程 / 备忘 / 课表 / 记账 / 纪念日 / 统计 / 邮件 / AI 助手）。
邀请制，上限 10 人，不做公网注册。

技术栈：ASP.NET Core 10 · Razor Pages · EF Core + SQLite · 原生 JS/CSS（无构建步骤）。
安卓客户端在[另一个仓库](https://github.com/Lele355/checkin-app-public)，通过本仓库的 `/api/v1` 取数据。

> **这是从私人仓库导出的脱敏版本**：域名替换成 `example.com`，备案号换成占位值，
> 真实姓名与口令已抹掉，运维手册（部署路径、服务器信息、备份流程）不随代码导出。
>
> 因此仓库里**没有** `docs/manual/OPERATIONS.md` 那份运维文档 —— 它对读者没有价值，
> 公开等于把入侵说明书写在门上。构建与本地运行看下面，足够了。

`docs/` 下的其余文件是历史截图与调研报告（过程资料）。

## 本地运行

```bash
cd CheckinApp
dotnet build
dotnet run --urls http://localhost:5188
```

首次启动自动建库（`data/checkin.db`）、跑迁移、写入种子账号与各模块样例数据。

初始管理员账号是 `admin`，**密码不在代码里**：在 `CheckinApp/appsettings.Local.json` 里写

```json
{ "Seed": { "AdminPassword": "你的密码" } }
```

或用环境变量 `Seed__AdminPassword`。两者都不配时会随机生成一份，落在
`data/initial-admin-password.txt`，登录后请立刻改密码并删掉这个文件。

私密配置都放 `CheckinApp/appsettings.Local.json`（AI Key 同理，已 gitignore）。

## 目录

| 路径 | 作用 |
|---|---|
| `CheckinApp/Pages/` | Razor 页面，每个模块一个目录（`.cshtml` + `.cshtml.cs`） |
| `CheckinApp/Api/` | `/api/v1` 端点，供 App 使用 |
| `CheckinApp/Services/` | 业务服务（时钟 / 权限 / AI / 邮件 / 通知计划 / 周次解析） |
| `CheckinApp/Security/` | 权限目录、认证、限流 |
| `CheckinApp/Models/` | EF 实体 + API DTO |
| `CheckinApp/wwwroot/css/` | `tokens.css`（设计令牌）→ `site.css`（布局组件）→ `themes.css`（主题差异） |
| `CheckinApp/wwwroot/js/` | `theme` / `site` / `datepicker` / `modal` / `calendar` / `dashboard` |
| `docs/` | 历史截图与调研报告（过程资料） |
| `qa/` | 专项回归脚本（Playwright） |

## 改代码的几条硬规矩

1. 静态资源必须 `asp-append-version`（否则换皮肤后用户看到半新半旧）
2. 改实体先 `dotnet build`，再 `dotnet ef migrations add`（`--no-build` 会生成空迁移）
3. `.gitignore` 不要写 `data/` —— 会把 `Data/`（C# 源码）一起吞掉
4. 颜色只准引用 `tokens.css` 变量，不许写死色值
5. 日期字段直接写 `<input type="date">`，`js/datepicker.js` 会自动接管外观与弹层
6. 删除类操作写 `data-confirm="确认删除"`，不要用 `confirm()`

## 部署

```bash
dotnet publish CheckinApp -c Release -o <输出目录>
```

把产物拷到服务器，前面挂 nginx 反代即可。两个容易翻车的点：

1. **打包别带 `data/` 和 `appsettings.Local.json`。** 前者是运行数据（覆盖会丢库），
   后者是本机密钥。
2. **发布后确认包里确实有 `CheckinApp.dll`。** 打包时路径参数写错，很容易把上级目录
   整个打进去，线上起来就是崩溃重启。

数据库是单个文件（`data/checkin.db`），备份 = 拷这个文件；
注意 SQLite 开了 WAL，拷之前最好先停服务，或者连 `-wal` 一起拷。

## 许可

MIT，见 [LICENSE](LICENSE)。站点内的个人数据、备案信息与域名不随代码授权。
