const fs = require('fs');
const needle = String.fromCharCode(114, 101, 112, 101, 97, 116);
const hay = String.fromCharCode(114, 101, 112, 101, 116, 105, 116, 105, 111, 110);
function eq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a.charCodeAt(i) !== b.charCodeAt(i)) return false; return true; }
function contains(h, n) {
    for (let i = 0; i + n.length <= h.length; i++) {
        let m = true;
        for (let j = 0; j < n.length; j++) if (h.charCodeAt(i + j) !== n.charCodeAt(j)) { m = false; break; }
        if (m) return true;
    }
    return false;
}
const ok = contains(hay, needle);
fs.writeFileSync('D:/checkin/site/qa/_str_result.txt', 'charCode contains=' + ok + ' eq=' + eq('repetition'.slice(0, 6), needle), 'utf8');
