// 按行区间删除（1-based，含首含尾）。用法：
//   node cut_lines.js <file> <start> <end> <expectSubstring>
// 校验 start 行或 end 行必须含 expectSubstring（不传则跳过校验），避免行号漂移时误删。
const fs = require('fs');
const [file, s, e, expect] = process.argv.slice(2);
const start = parseInt(s, 10), end = parseInt(e, 10);
const lines = fs.readFileSync(file, 'utf8').split('\n');
if (!(start >= 1 && end >= start && end <= lines.length)) {
    console.error('区间越界：' + start + '-' + end + ' / 共 ' + lines.length + ' 行');
    process.exit(1);
}
if (expect) {
    const head = lines.slice(start - 1, end).join('\n');
    if (!head.includes(expect)) {
        console.error('校验失败：' + start + '-' + end + ' 里没有「' + expect + '」');
        console.error('首行：' + lines[start - 1]);
        console.error('尾行：' + lines[end - 1]);
        process.exit(2);
    }
}
const removed = end - start + 1;
lines.splice(start - 1, removed);
fs.writeFileSync(file, lines.join('\n'), 'utf8');
console.log('已删除 ' + removed + ' 行（' + start + '-' + end + '），剩余 ' + lines.length + ' 行');
