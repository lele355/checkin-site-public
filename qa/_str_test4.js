const fs = require('fs');
const needle = String.fromCharCode(114, 101, 112, 101, 97, 116);
const hay = String.fromCharCode(114, 101, 112, 101, 116, 105, 116, 105, 111, 110);
const ok1 = hay.indexOf(needle) >= 0;
const ok2 = hay.includes(needle);
const ok3 = new RegExp(needle).test(hay);
const ok4 = 'repetition'.slice(0, 6) === 'repeat';
fs.writeFileSync('D:/checkin/site/qa/_str_result.txt',
    'indexOf=' + ok1 + ' includes=' + ok2 + ' regex=' + ok3 + ' slice=' + ok4, 'utf8');
