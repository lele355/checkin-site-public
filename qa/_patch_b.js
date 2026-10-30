const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/_verify_b_api.js', 'utf8');
// 1) validLayout 支持 side2 镜像
s = s.replace("function validLayout(overrides) {", "function validLayout(overrides, side) {");
s = s.replace(
    "    function put(rank, x, y) { pieces.push({ x, y, rank }); used.add(x + ',' + y); }\n    put('rank_flag', 1, 11);\n    put('rank_mine', 0, 10); put('rank_mine', 4, 10); put('rank_mine', 2, 11);\n    put('rank_bomb', 0, 7); put('rank_bomb', 4, 7);",
    "    function put(rank, x, y) { if (side === 2) { y = 11 - y; x = 4 - x; } pieces.push({ x, y, rank }); used.add(x + ',' + y); }\n    put('rank_flag', 1, 11);\n    put('rank_mine', 0, 10); put('rank_mine', 4, 10); put('rank_mine', 2, 11);\n    put('rank_bomb', 0, 7); put('rank_bomb', 4, 7);"
);
s = s.replace("    for (let y = 6; y <= 11 && pool.length; y++) for (let x = 0; x <= 4 && pool.length; x++) {",
    "    for (let y = 6; y <= 11 && pool.length; y++) for (let x = 0; x <= 4 && pool.length; x++) {");
// 2) mode 断言改走 state.mode
s = s.replace("s1.status === 'setup' && s1.mode === 'open'", "s1.status === 'setup' && s1.state.mode === 'open'");
s = s.replace("sA.status === 'playing' && sA.mode === 'dark'", "sA.status === 'playing' && sA.state.mode === 'dark'");
// 3) beta deploy 用 side2 镜像布局
s = s.replace("await api('POST', `/api/v1/games/armychess/rooms/${id2}/deploy`, { pieces: validLayout() }, beta);",
    "await api('POST', `/api/v1/games/armychess/rooms/${id2}/deploy`, { pieces: validLayout(null, 2) }, beta);");
fs.writeFileSync('D:/checkin/site/qa/_verify_b_api.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_b_api.js');
console.log('patched');
