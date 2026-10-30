const a = 'repeat';
console.log('arg charcodes:', [...a].map(c => c.charCodeAt(0)).join(','));
console.log('indexOf:', 'repetition'.indexOf('repeat'));
console.log('match:', 'repetition'.match(/repeat/));
console.log('slice cmp:', JSON.stringify('repetition'.slice(0, 6)) === JSON.stringify('repeat'));
console.log('localeCompare:', 'repetition'.localeCompare('repeat'));
console.log('String.proto patched:', Object.getOwnPropertyDescriptor(String.prototype, 'includes') ? Object.getOwnPropertyDescriptor(String.prototype, 'includes').value.toString().slice(0, 120) : 'n/a');
console.log('RegExp.test src:', Object.getOwnPropertyDescriptor(RegExp.prototype, 'test') ? Object.getOwnPropertyDescriptor(RegExp.prototype, 'test').value.toString().slice(0, 120) : 'n/a');
