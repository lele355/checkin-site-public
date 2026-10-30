const fs = require('fs');
let s = fs.readFileSync('D:/checkin/site/qa/_verify_b_ui.js', 'utf8');
// geom 提升到外层作用域
s = s.replace("    let reqCount = 0;", "    let reqCount = 0;\n    let geom = null;");
s = s.replace("        const geom = await page.evaluate(gk => {", "        geom = await page.evaluate(gk => {");
fs.writeFileSync('D:/checkin/site/qa/_verify_b_ui.js', s, 'utf8');
require('child_process').execSync('node --check D:/checkin/site/qa/_verify_b_ui.js');
console.log('geom hoisted');
