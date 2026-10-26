# 贡献说明

这是一个自用的生活管理站（邀请制、上限 10 人），代码公开主要是为了留档和给同类项目做参考，
不是在做产品。因此：

- **Issue 欢迎**：bug 报告、安全问题、以及"这一段为什么这么写"的提问都会看。
- **PR 谨慎接受**：功能方向是按个人需求长的，和你想要的未必一致；改动大的建议先开 Issue 聊，
  免得你写完发现不合场景。
- **不接商业合作**，不接受把本站当作模板直接商用。

## 本地跑起来

```bash
cd CheckinApp
dotnet build
dotnet run --urls http://localhost:5188
```

首次启动会建库、跑迁移、播种数据。初始管理员密码：

- 在 `appsettings.Local.json` 里配 `Seed:AdminPassword`，或用环境变量 `Seed__AdminPassword`；
- 都没配时会随机生成一份，落在 `data/initial-admin-password.txt`。

登录后请立刻改密码。`appsettings.Local.json` 已在 `.gitignore` 里，不要提交。

## 提交前

```bash
cd CheckinApp && dotnet build     # 必须 0 警告 0 错误
```

这次的改动如果动了前端，顺手用 390 宽的视口看一眼手机端——很多问题桌面看不出来。

## 几条硬规矩

改代码时请遵守 README 里列的六条（静态资源带版本号、改实体先 build、
`.gitignore` 别写 `data/`、颜色只引用令牌变量、日期用原生 `input[type=date]`、
删除操作用 `data-confirm`）。这几条都是踩过坑之后定下来的，不是风格偏好。

## 不要提交的东西

`appsettings.Local.json`、`data/`、`_shots/`、任何 `.db` 文件、以及截图里带真实数据的图片。