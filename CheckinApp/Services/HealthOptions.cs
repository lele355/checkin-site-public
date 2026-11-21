namespace CheckinApp.Services;

/// <summary>
/// 健康模块配置（appsettings 的 Health 节，密钥走 appsettings.Local.json / 环境变量，绝不进 git）。
/// </summary>
public class HealthOptions
{
    /// <summary>bridge 地址（本机回环，不对外）</summary>
    public string BridgeBaseUrl { get; set; } = "http://127.0.0.1:8765";
    /// <summary>调 bridge REST 的 Bearer token（bridge auth.api_token）</summary>
    public string BridgeToken { get; set; } = "";
    /// <summary>bridge 回调 webhook 的共享密钥（X-Mi-Health-Token）</summary>
    public string WebhookToken { get; set; } = "";
    /// <summary>后台增量同步间隔（分钟）</summary>
    public int SyncIntervalMinutes { get; set; } = 10;
}
