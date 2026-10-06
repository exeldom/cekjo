// Run: node scripts/check_filter_search.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = {};
const context = vm.createContext({document: {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: (type, handler) => (listeners[type] ||= []).push(handler)
}});
vm.runInContext(fs.readFileSync(`${__dirname}/../static/app.js`, 'utf8'), context);
const labels = ['Dinas Pendidikan', 'Dinas Kesehatan', '(Kosong)', '1.234,50'].map((textContent, i) => ({textContent, hidden: false, checked: i % 2 === 0}));
const empty = {hidden: true};
const input = {value: '', matches: selector => selector === '.filter-search', parentElement: {
  querySelectorAll: () => labels,
  querySelector: () => empty
}};
function search(value) {
  input.value = value;
  listeners.input.forEach(handler => handler({target: input}));
  return labels.filter(label => !label.hidden).map(label => label.textContent);
}
assert.deepEqual(search('  PENDIDIKAN  '), ['Dinas Pendidikan']);
assert.deepEqual(search('kosong'), ['(Kosong)']);
assert.deepEqual(search('1.234'), ['1.234,50']);
assert.deepEqual(search('tidak tersedia'), []);
assert.equal(empty.hidden, false);
assert.equal(search('').length, 4);
assert.equal(empty.hidden, true);
assert.deepEqual(labels.map(label => label.checked), [true, false, true, false]);
input.value = 'kesehatan';
labels.push({textContent: 'Kesehatan Baru', hidden: false, checked: true});
context.searchFilterOptions(input);
assert.equal(labels.filter(label => !label.hidden).length, 2);
let prevented = false;
listeners.keydown.forEach(handler => handler({key: 'Enter', target: input, preventDefault: () => { prevented = true; }}));
assert.equal(prevented, true);
console.log('PASS: search, case/whitespace, empty values, formatted numbers, no matches, reset, selection preservation, refreshed options, Enter.');
