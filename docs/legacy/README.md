# legacy —— 已随模块下线的资产

这里放的是**功能已经不在主站上**的脚本与文档。留着是为了两件事：查历史、必要时复活。

## PyLab（Python 教学平台）· 2026-10-22 整块删除

主站 `/PyLab` 页面、Python 桥、代码沙箱、6 张 PyLab 表、`pylab.use` 权限码、
`tools/pylab/` 一套 Python 全部从 `main` 分支移除（迁移 `DropPyLabModule`）。

**代码没有消失**，只是搬了地方：

| 东西 | 在哪 |
|---|---|
| 完整可运行的 PyLab 版本 | git 分支 `pylab-local`、tag `pylab-standalone-2026-10-22` |
| 本地单机版工作副本 | `D:/projects/pylab-local`（git worktree，独立目录，可直接打包） |
| Python 控制台版（作业交付形态） | 公开仓 `Lele355/python-pylab` |

想复活：`git checkout pylab-local`，或直接在 `D:/projects/pylab-local` 里干活。

## 本目录里的文件

- `qa_*` / `debug_*` / `online_*` / `check_artifacts*` —— PyLab 时期的专项测试与排查脚本，
  依赖 `/PyLab?handler=...`、`window.__pyLab` 等已删除的接口，在 `main` 上跑必然报错。
- `patch_nginx_pylab*.py` —— 曾经给 nginx 加 `/PyLab` 专用 location（大请求体 + 长超时）。
- `PyLab*.md` —— 模块的拆除手册与两篇方案可行性分析。

需要跑这些脚本时，先切到 `pylab-local` 分支（那里代码齐全），再按文件头注释准备夹具。
