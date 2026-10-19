# 日常管理 · Daily Manager

一个可以自己部署的生活管理小站：日程、备忘、打卡、记账、课程表、纪念日、留言板、邮件收件箱，外加一个能"一句话记事"的 AI 助手。手机优先设计，加到桌面就能当 App 用。

> 本项目是从个人自用站脱敏导出的公开版本：**域名、账号、备案号、初始口令均为占位示例**，不含任何真实凭据与私人数据。

---

## 功能

| 分组 | 模块 |
| --- | --- |
| 常用 | 工作台（可自定义卡片布局）、日程、备忘、邮件（IMAP 多账号合并收件箱）、AI 助手 |
| 生活 | 打卡、课程表（教务式周视图 / 手机格子视图）、纪念日、情侣空间、留言板、记账、经期记录 |
| 工具 | 提醒中心（支持每日邮件提醒）、统计图表、数据导出（JSON） |
| 管理 | 用户管理、邀请码、角色与权限矩阵 |

其他特性：

- **主题系统**：5 套风格 × 6 档底色 × 明暗，全部走 CSS 变量；侧栏分组可折叠、可隐藏任意模块
- **权限**：基于权限码的 RBAC，角色可自定义，敏感模块（情侣空间、经期）独立授权
- **注册**：邀请制。管理员生成一次性邀请码，填对即注册成功（无邮箱验证、无审核队列）
- **防刷**：IP 小时配额 + 蜜罐字段 + 一次性表单令牌 + 填写时长校验 + 邀请码 + 唯一索引，nginx 层再叠一道限流
- **AI 助手**：OpenAI 兼容接口（默认小米 MiMo），function calling 产出"建议单"，**用户点确认才真正写库**；每日对话次数与 token 总量双配额
- **PWA**：manifest + 图标，可添加到主屏幕

## 技术栈

- .NET 10 / ASP.NET Core Razor Pages（无前端框架，原生 JS + CSS）
- EF Core 10 + SQLite（迁移在启动时自动执行）
- MailKit（IMAP/SMTP）
- Playwright（端到端测试）

## 目录结构

```
CheckinApp/
  Data/             DbContext 与迁移
  Models/           实体
  Pages/            所有页面（Razor Pages）
  Security/         权限清单、导航清单、密码哈希
  Services/         业务服务（AI、邮件、提醒、播种、限流等）
  wwwroot/          静态资源（CSS / JS / 图标）
qa/                 端到端测试脚本与测试工具
docs/               技术文档
```

## 本地运行

前置：**.NET 10 SDK**（自带 SQLite，无需装数据库）。

```bash
cd CheckinApp
dotnet run --no-launch-profile --urls 'http://*:5188'
```

首次启动会自动建库、跑迁移、播种权限/角色/管理员账号，然后打开 <http://localhost:5188>。

### 初始管理员

账号与口令从环境变量读，**仓库里没有真实口令**：

```bash
# Linux / macOS
export CHECKIN_ADMIN_USER=admin
export CHECKIN_ADMIN_PW='你的强口令'
# Windows PowerShell
$env:CHECKIN_ADMIN_USER="admin"; $env:CHECKIN_ADMIN_PW="你的强口令"
```

不设的话会用占位值 `admin / ChangeMe!123456` —— **只在本地玩可以，部署到公网务必先设环境变量，登录后立刻改密**。

### AI 助手（可选）

AI 相关功能需要一个大模型 API Key，放在 `CheckinApp/appsettings.Local.json`（已被 gitignore）：

```json
{ "Ai": { "ApiKey": "sk-你的key", "BaseUrl": "https://api.example.com/v1", "Model": "你的模型名" } }
```

或直接用环境变量 `MIMO_API_KEY` / `AI_API_KEY`。没有 key 时其余功能照常可用，只是 AI 页会提示未配置。

## 测试

测试全部是 Playwright 脚本（Edge 内核），跑之前先把站点起在 `http://localhost:5188`：

```bash
npm i -D playwright        # 或在全局装过 playwright 亦可
export CHECKIN_ADMIN=admin
export CHECKIN_ADMIN_PW='你的口令'

node qa/test_user_delete_cascade.js   # 删用户 → 15 张表级联清空
node qa/test_register.js             # 邀请制注册 + 六层防刷
node qa/test_nav_ai.js               # 侧栏折叠/自定义 + AI 配额
node qa/qa_full.js                   # 全功能三轮回归
```

辅助工具：`qa/dbq.py`（把 SQL 打进 stdin，返回 JSON，用于字段级断言）、`qa/wipe_qa.py`（清场）。

## 部署（Linux + nginx + systemd）

1. `dotnet publish -c Release -o /tmp/publish`
2. 把发布产物放到 `/var/www/<name>`，用 systemd 跑 `dotnet <name>.dll`，环境变量写在 `EnvironmentFile`（API Key、管理员口令都走这里，不要写进仓库）
3. nginx 反代到 `127.0.0.1:5000`，记得转发 `X-Forwarded-For` / `X-Forwarded-Proto`（应用侧已启用 ForwardedHeaders）
4. 换版脚本见 `qa/deploy_app.sh`：热备份数据库 → 停服务 → 保留 data 目录 → 换目录 → 起服务跑迁移 → 探活，旧版本留一份可回滚

国内服务器部署需完成 ICP 备案；页脚的备案号请在 `Pages/Shared/_Layout.cshtml` 里换成你自己的。

## 安全说明

- 密码用 PBKDF2 哈希存储，登录失败有次数限制与锁定
- 邀请码一次性 + 有效期 + 可撤销，库里存原码、显示时加短横
- 删除用户会**级联删除**该用户的全部数据（15 张表，外键 CASCADE），界面上有 5 秒倒计时确认
- 后台管理有三条防自锁规则：不能改自己的角色、不能停用自己、不能删掉最后一个有管理权限的账号

## 许可

MIT，见 [LICENSE](LICENSE)。
