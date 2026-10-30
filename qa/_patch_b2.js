const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/_verify_b_api.js', 'utf8');
s = s.replace(
    "await api('POST', `/api/v1/games/armychess/rooms/${id2}/deploy`, { pieces: validLayout(null, 2) }, beta);",
    "const depRes = await api('POST', `/api/v1/games/armychess/rooms/${id2}/deploy`, { pieces: validLayout(null, 2) }, beta);\n        console.log('beta deploy resp:', depRes.status, JSON.stringify(depRes.json && (depRes.json.error || depRes.json.data && depRes.json.data.status)));"
);
fs.writeFileSync('D:/checkin/site/qa/_verify_b_api.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_b_api.js');
console.log('deploy log added');
