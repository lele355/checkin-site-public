const s = 'repetition';
console.log('literal includes:', s.includes('repeat'));
console.log('charcodes:', [...s].map(c => c.charCodeAt(0)).join(','));
console.log('regex:', /repeat/.test(s));
console.log('server-string test:', 'repetition'.includes('repeat'));
const fs = require('fs');
// 从服务器响应拿真实字符串再测
(async () => {
    const r = await fetch('http://127.0.0.1:5188/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'QA_alpha', password: 'QaGames2026!', device: 'str' }) });
    console.log('login ok:', r.status);
})();
