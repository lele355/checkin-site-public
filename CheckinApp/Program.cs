using CheckinApp.Data;
using CheckinApp.Security;
using CheckinApp.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using System.Text.Encodings.Web;
using System.Text.Unicode;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// 本地私密配置（API Key 等）：gitignored，绝不入库。
// 也支持环境变量覆盖（Ai__ApiKey 或 MIMO_API_KEY），服务器部署用环境变量更省事。
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: false);

// ---------- 服务注册 ----------
// Razor 默认只把 ASCII 当「安全字符」，中文会被转义成 &#x5B89; 这类实体。
// 放开到全 Unicode：页面源码可读，前端取值/比较中文也不会被坑。
// 注意：必须在 AddRazorPages 之前注册 —— 框架内部是 TryAdd，晚注册会被框架的默认值顶掉。
builder.Services.AddSingleton<HtmlEncoder>(HtmlEncoder.Create(UnicodeRanges.All));

builder.Services.AddRazorPages();

// 反向代理（生产环境 nginx 终止 TLS 后转发到 127.0.0.1:5000）：
// 不认 X-Forwarded-Proto 的话，应用以为自己在 http，生成的跳转/回调地址会掉回 http，
// 登录 Cookie（SameAsRequest）也不会带 Secure。只信任本机代理，故清空已知代理白名单。
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
                       | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

// 响应压缩：手机走 WiFi/流量时 HTML(20KB+)、CSS(18KB+) 压缩后只剩零头，
// 是「点开页面等好久」最立竿见影的一味药。Brotli 优先，不支持自动回退 gzip。
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
    o.MimeTypes = Microsoft.AspNetCore.ResponseCompression.ResponseCompressionDefaults.MimeTypes
        .Concat(new[] { "application/json", "image/svg+xml" });
});
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProviderOptions>(o =>
    o.Level = System.IO.Compression.CompressionLevel.Fastest);
builder.Services.Configure<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProviderOptions>(o =>
    o.Level = System.IO.Compression.CompressionLevel.Fastest);

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=data/checkin.db"));

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.LoginPath = "/Login";
        o.AccessDeniedPath = "/AccessDenied";
        // 空闲 2 小时过期：活跃就滑动续命，停手 2 小时后要求重新登录
        // （防浏览器常驻后台/启动增强导致会话 cookie 长生不死，历史记录直达入口）
        // 「自动进入」模式的 30 天票在签发时 AllowRefresh=false，不受此滑动规则影响
        o.ExpireTimeSpan = TimeSpan.FromHours(2);
        o.SlidingExpiration = true;
        o.Cookie.HttpOnly = true;                  // JS 读不到，防会话窃取
        o.Cookie.SameSite = SameSiteMode.Lax;      // 防 CSRF 基础
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // 本地 http / 生产 https 自动适配
        o.Cookie.Name = "checkin_auth";
    });

builder.Services.AddAuthorization(o =>
{
    // 兜底策略：所有未显式标注的页面都要求登录（全局「未登录跳登录页」）
    o.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

// 权限体系三件套
builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();

// 当前用户上下文 + 登录限速
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddSingleton<LoginRateLimiter>();

// ---------- 注册防护 ----------
// 邀请码 + 一次性表单令牌 + 填写时长校验（见 Services/RegistrationGuard.cs）。
// 内存缓存只放「30 分钟内有效的一次性令牌」，重启即清空 —— 单机部署足够，多机才需要 Redis。
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<RegistrationGuard>();
// 按 IP 的小时配额（默认 3 次/小时，可用 Security:RegisterPerHour 覆盖）。
// 用自己写的滑动窗口而不是 [EnableRateLimiting]：语义可控（只数提交次数）、提示语能跟站内其它页统一。
builder.Services.AddSingleton<RegisterThrottle>();

// AI 助手：MiMo 客户端（OpenAI 兼容）+ 建议单执行器。
// API Key 只放 appsettings.Local.json（gitignored）或环境变量 MIMO_API_KEY，绝不进 git。
builder.Services.Configure<AiOptions>(builder.Configuration.GetSection("Ai"));
builder.Services.AddHttpClient("ai", (sp, http) =>
{
    var opt = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AiOptions>>().Value;
    http.Timeout = TimeSpan.FromSeconds(Math.Clamp(opt.TimeoutSeconds, 5, 120));
});
builder.Services.AddScoped<AiClient>();
builder.Services.AddScoped<AiActionExecutor>();

// 邮件模块（M7）：授权码加密 + IMAP 同步 + 后台定时拉取。
// 授权码加密密钥放环境变量 EMAIL_MASTER_KEY 或 appsettings.Local.json，绝不进 git。
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection("Email"));
builder.Services.AddSingleton<EmailCrypto>();
builder.Services.AddScoped<EmailSyncService>();
builder.Services.AddHostedService<EmailSyncBackgroundService>();

// 每日邮件提醒：摘要构建 + SMTP 发信 + 每分钟轮询到点发送
builder.Services.AddScoped<MailSender>();
builder.Services.AddScoped<DailyReminderMailer>();
builder.Services.AddHostedService<DailyMailBackgroundService>();

var app = builder.Build();

// ---------- 启动初始化：迁移建库 + 播种（幂等） ----------
Directory.CreateDirectory("data");
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();
    Seeder.Seed(db);
}

// ---------- 中间件管线 ----------
// 必须在最前面：后面所有中间件（含认证/重定向生成）才能看到真实的 https 与客户端 IP
app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
}

// 响应压缩要放在管线最前面（在静态文件之前），压缩才有机会作用于所有响应
app.UseResponseCompression();

// 静态文件缓存策略：
// - css/js 都带 asp-append-version（URL 后缀内容哈希），改了文件 URL 就变，
//   所以敢给 max-age=1 年 + immutable —— 翻页时浏览器直接用本地缓存，不发请求。
// - 其余（图标/manifest）给 7 天，浏览器回来不用重拉但也不会改了图看不到。
// .apk 不在 ASP.NET 默认 MIME 表里，不显式登记会直接 404（下载页按钮点了没反应）
var staticTypes = new Microsoft.AspNetCore.StaticFiles.FileExtensionContentTypeProvider();
staticTypes.Mappings[".apk"] = "application/vnd.android.package-archive";

app.UseStaticFiles(new StaticFileOptions
{
    ContentTypeProvider = staticTypes,
    OnPrepareResponse = ctx =>
    {
        var path = ctx.File.Name;
        var isVersioned = path.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
                       || path.EndsWith(".js", StringComparison.OrdinalIgnoreCase);
        // Service Worker 不进长缓存：它自己就是"检查更新"的入口，必须每次回源验证，
        // 否则改完 sw.js 可能一年都不生效（浏览器虽默认绕过 HTTP 缓存，但不该依赖这个默认值）
        var isServiceWorker = path.Equals("sw.js", StringComparison.OrdinalIgnoreCase);
        // 安装包也不能吃缓存：换了包还用旧缓存装，等于白升级
        var isApk = path.EndsWith(".apk", StringComparison.OrdinalIgnoreCase);
        ctx.Context.Response.Headers.CacheControl = isServiceWorker || isApk
            ? "no-cache"
            : isVersioned
                ? "public, max-age=31536000, immutable"
                : "public, max-age=604800";
    }
});
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<MustChangePasswordMiddleware>();
app.MapRazorPages();

app.Run();
