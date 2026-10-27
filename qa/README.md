# qa/ 回归脚本

这些都是**本机自用**的一次性验收脚本，不进产品构建、不跑 CI。留在这里的价值是：
改完某块功能后，能一条命令把当时验收过的证据重新跑一遍。

## 跑之前

```bash
# 1) 站点要跑起来（默认 5188）
cd ../CheckinApp && dotnet run

# 2) playwright 的模块路径（本机是全局装的）
export NODE_PATH="C:/Users/An/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules"

# 3) 账号口令从环境变量读，不要在脚本里写死
export QA_PASS='你的本地管理员密码'
```

需要连线上站的脚本（`check_online_*` / `online_*` / `seed_online` / `shot_online` /
`test_online` / `verify_online_native_perf`）额外要：

```bash
export QA_PASS_ONLINE='你的线上管理员密码'   # 不配会退回用 QA_PASS
```

然后 `node 脚本名.js` 即可。撤掉 `QA_PASS` 再跑，脚本会直接提示缺哪个变量并退出——
这是有意的，宁可早退也不要用空口令去撞登录。

## 口径

- **不跑全量。** 每个脚本对应一次具体改动，跑自己写的那几个就够了。
  全量套件（`qa_full.js`）年代久远，页面改过几轮后多半已经对不上，参考价值有限。
- **脚本要能重复跑。** 会改库的（节次配置、密码、测试数据）必须在开头自己复位，
  否则中途崩一次，下次跑就是一片假失败。
- **危险操作要点两下。** 2.3.0 起删除/重置类按钮是就地二次确认
  （第一下进入待确认态、第二下才提交），脚本里别再指望 `dialog` 事件。

## 清单

| 脚本 | 管什么 |
| --- | --- |
| `qa_module_removed.js` | PyLab 模块删除专项（17 项），现在唯一还在维护的回归项 |
| `dbq.py` / `wipe_qa.py` | 直接读库 / 清掉测试数据 |
| `test_periods.js` | 节次时间自定义（改时间 → 课表跟着变 → 增删 → 恢复默认） |
| `shot_*.js` | 目检截图，产物在 `_shots/` |
| `legacy/` | PyLab 时代的历史脚本，**已废弃**，只作考古 |

`legacy/` 与带线上服务器操作的脚本已被排除在公开导出之外（见 `../_export_public.js`）。