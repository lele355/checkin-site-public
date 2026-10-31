namespace CheckinApp.Ui;

/// <summary>
/// QA 测试钩子开关（P3-2：测试钩子生产构建不可见）。
///
/// **构建开关收敛**：常量随编译配置走——Debug 构建真、Release 发布（`dotnet publish -c Release`）假。
/// 页面侧**恒注入显式极性**：`window.__QA_HOOKS__ = true|false`（Debug/Release 各自的值）；
/// 脚本侧判据 `window.__QA_HOOKS__ !== false`——**显式 false 才隐藏**，缺省视为可见：
/// 这样视图与静态文件在滚动升级（改版未重启）期间不致把 QA 工具链打黑（本设计即源于此事故），
/// 而 Release 发布的视图恒写 false，生产构建钩子确定不可见。
/// 覆盖钩子：`__gmLastGeom`（games.js）、`__melonGame`（melon.js）。
/// </summary>
public static class QaHooks
{
#if DEBUG
    public const bool Enabled = true;
#else
    public const bool Enabled = false;
#endif
}
