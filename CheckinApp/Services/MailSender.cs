using CheckinApp.Models;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using MimeKit.Utils;

namespace CheckinApp.Services;

/// <summary>
/// 发信服务 —— 复用用户已绑定邮箱账号的 SMTP 与授权码（授权码解密后只在内存里用一次）。
/// 失败不抛异常给调用方，统一返回 (ok, error)，页面/后台按需展示。
/// </summary>
public class MailSender(EmailCrypto crypto)
{
    private readonly EmailCrypto _crypto = crypto;

    public async Task<(bool Ok, string Error)> SendAsync(
        EmailAccount account, string toAddress, string subject, string textBody, string? htmlBody,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(account.SmtpHost))
            return (false, "这个邮箱账号还没配置 SMTP 服务器，请到「邮件 → 账号管理」里补上。");
        if (string.IsNullOrEmpty(account.AuthCodeEnc))
            return (false, "这个邮箱账号没有授权码，请到「邮件 → 账号管理」里补上。");

        string authCode;
        try { authCode = _crypto.Decrypt(account.AuthCodeEnc); }
        catch { return (false, "授权码解密失败（服务端加密密钥变更过），请重新填写授权码。"); }

        var to = string.IsNullOrWhiteSpace(toAddress) ? account.Address : toAddress.Trim();

        try
        {
            using var client = new SmtpClient();
            client.Timeout = 20000;
            // 465 走隐式 TLS，587/25 走 STARTTLS（都用最新协议）
            var security = account.SmtpPort == 465
                ? SecureSocketOptions.SslOnConnect
                : SecureSocketOptions.StartTlsWhenAvailable;

            await client.ConnectAsync(account.SmtpHost, account.SmtpPort, security, ct);
            await client.AuthenticateAsync(account.Address, authCode, ct);

            var msg = new MimeMessage();
            msg.From.Add(new MailboxAddress("日常管理", account.Address));
            msg.To.Add(MailboxAddress.Parse(to));
            msg.Subject = subject;
            msg.MessageId = MimeUtils.GenerateMessageId();

            var body = new BodyBuilder { TextBody = textBody };
            if (!string.IsNullOrWhiteSpace(htmlBody)) body.HtmlBody = htmlBody;
            msg.Body = body.ToMessageBody();

            await client.SendAsync(msg, ct);
            await client.DisconnectAsync(true, ct);
            return (true, "");
        }
        catch (AuthenticationException)
        {
            return (false, "SMTP 登录被拒：授权码不对，或该邮箱没开启「SMTP 服务」（QQ/163 需在网页端开启并重新生成授权码）。");
        }
        catch (SslHandshakeException)
        {
            return (false, $"TLS 握手失败：{account.SmtpHost}:{account.SmtpPort} 的加密方式与端口不匹配（465 用 SSL，587 用 STARTTLS）。");
        }
        catch (OperationCanceledException)
        {
            return (false, "发送超时：网络到 SMTP 服务器不通。");
        }
        catch (Exception ex)
        {
            // 只留一句人话，不把堆栈写进库（可能是网络、限流、地址被拒等）
            var m = ex.Message.Length > 120 ? ex.Message[..120] + "…" : ex.Message;
            return (false, "发送失败：" + m);
        }
    }
}
