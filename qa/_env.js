// _env.js — QA 脚本共用的账号与地址来源。
//
// 铁律：口令一律不进仓库，只从环境变量读。因为这些脚本会被复制、被截图、
// 被误提交，硬编码的密码迟早漏出去；而它们本来就只有本机在跑，多敲一行导出
// 环境变量不算成本。
//
// 用法（bash / Git Bash）：
//   export QA_PASS='你的本地密码'
//   export QA_PASS_ONLINE='你的线上密码'    # 只有连线上站的脚本才需要
//   node qa_full.js
//
// 用 getter 而不是在 require 时立刻校验：截注册页、量布局这类脚本根本不用登录，
// 不该被"没配密码"卡住。只有真正读到口令时才报错退出。

function must(name, fallback) {
    const v = process.env[name] || (fallback ? process.env[fallback] : '');
    if (!v) {
        console.error(`[qa] 缺少环境变量 ${name}${fallback ? `（或 ${fallback}）` : ''}。`);
        console.error(`[qa] 例：export ${name}='你的密码' 后重跑。`);
        process.exit(1);
    }
    return v;
}

module.exports = {
    /** 登录用户名。不是秘密，默认与播种管理员一致。 */
    USER: process.env.QA_USER || ADMIN,
    /** 本地站（localhost:5188）的密码。 */
    get PASS() { return must('QA_PASS'); },
    /** 线上站的密码；没单独配就沿用本地那一个。 */
    get PASS_ONLINE() { return must('QA_PASS_ONLINE', 'QA_PASS'); },
    /** 线上站地址；不同脚本历史上写法不一，这里给一个统一出口。 */
    BASE_ONLINE: process.env.QA_BASE_ONLINE || 'https://example.com',
};