using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using System.Text;

namespace CheckinApp.Services;

/// <summary>邮件模块配置。密钥生产用环境变量 EMAIL_MASTER_KEY 覆盖，绝不进 git。</summary>
public class EmailOptions
{
    /// <summary>授权码加密主密钥（空 = 开发兜底密钥；正式部署必须配 EMAIL_MASTER_KEY）</summary>
    public string MasterKey { get; set; } = "";
    /// <summary>后台自动同步间隔（分钟）</summary>
    public int SyncIntervalMinutes { get; set; } = 10;
}

/// <summary>
/// 邮箱授权码加解密 —— AES-GCM（12 字节 nonce + 16 字节 tag + 密文，base64 一串存库）。
/// 授权码等于邮箱的「万能钥匙」，泄露 = 邮箱失守：所以只存密文、密钥独立保管、永不写日志。
/// </summary>
public class EmailCrypto(IOptions<EmailOptions> opt)
{
    private readonly EmailOptions _opt = opt.Value;

    private byte[] Key()
    {
        // 优先级：环境变量 &gt; 配置 &gt; 开发兜底（小站自用可接受；上线前务必设环境变量）
        var secret = Environment.GetEnvironmentVariable("EMAIL_MASTER_KEY");
        if (string.IsNullOrWhiteSpace(secret)) secret = _opt.MasterKey;
        if (string.IsNullOrWhiteSpace(secret)) secret = "checkin-dev-email-key";
        return SHA256.HashData(Encoding.UTF8.GetBytes(secret));
    }

    /// <summary>明文授权码 → 密文（入库值）。空串原样返回。</summary>
    public string Encrypt(string plain)
    {
        if (string.IsNullOrEmpty(plain)) return "";
        var key = Key();
        var nonce = RandomNumberGenerator.GetBytes(12);
        var plainBytes = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[plainBytes.Length];
        var tag = new byte[16];
        using var gcm = new AesGcm(key, 16);
        gcm.Encrypt(nonce, plainBytes, cipher, tag);
        var packed = new byte[12 + 16 + cipher.Length];
        nonce.CopyTo(packed, 0);
        tag.CopyTo(packed, 12);
        cipher.CopyTo(packed, 28);
        return Convert.ToBase64String(packed);
    }

    /// <summary>密文 → 明文授权码。解不出来（密钥换过）抛异常，由调用方转成「请重新填写授权码」。</summary>
    public string Decrypt(string enc)
    {
        if (string.IsNullOrEmpty(enc)) return "";
        var packed = Convert.FromBase64String(enc);
        if (packed.Length < 28) throw new FormatException("密文格式不对");
        var nonce = packed.AsSpan(0, 12).ToArray();
        var tag = packed.AsSpan(12, 16).ToArray();
        var cipher = packed.AsSpan(28).ToArray();
        var plain = new byte[cipher.Length];
        using var gcm = new AesGcm(Key(), 16);
        // 注意参数顺序：Decrypt 是 (nonce, ciphertext, tag, plaintext)，与 Encrypt 的 tag 在末尾不同！
        gcm.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}
