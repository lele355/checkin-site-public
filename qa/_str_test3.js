const needle = String.fromCharCode(114, 101, 112, 101, 97, 116); // 'repeat'
const hay = String.fromCharCode(114, 101, 112, 101, 116, 105, 116, 105, 111, 110); // 'repetition'
console.log('fromCharCode indexOf:', hay.indexOf(needle));
console.log('fromCharCode includes:', hay.includes(needle));
const rx = new RegExp(needle);
console.log('fromCharCode regex:', rx.test(hay));
// 对比：字面量
console.log('literal indexOf:', 'repetition'.indexOf('repeat'));
console.log('literal charcodes repeat:', [...'repeat'].map(c => c.charCodeAt(0)).join(','));
console.log('literal length repeat:', 'repeat'.length, '| repetition length:', 'repetition'.length);
console.log('literal slice cmp:', 'repetition'.slice(0, 6) === 'repeat');
