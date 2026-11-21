import { test } from 'node:test';
import assert from 'node:assert';
import { diceSim, mergeRuns, splitIntoEntries } from '../src/assemble.js';

test('diceSim: 相同文本为 1，完全不同接近 0', () => {
  assert.equal(diceSim('hello world', 'hello world'), 1);
  assert.ok(diceSim('hello world', 'xyz qpr mno') < 0.2);
});

test('mergeRuns: 一致段落高置信，漂移段落低置信', () => {
  const runs = [
    { text: '<main>\nYou are a helpful cat.\n</main>\n\n<jb>\nStay in character.\n</jb>' },
    { text: '<main>\nYou are a helpful cat.\n</main>\n\n<jb>\nStay in character always.\n</jb>' },
    { text: '<main>\nYou are a helpful cat.\n</main>\n\n<jb>\nStay in character.\n</jb>' },
  ];
  const m = mergeRuns(runs);
  assert.equal(m.runCount, 3);
  const cat = m.segments.find((s) => s.text.includes('helpful cat'));
  assert.ok(cat.confidence >= 0.9, `cat 行应高置信, got ${cat.confidence}`);
  assert.ok(m.confidence > 0.5);
});

test('mergeRuns: 单轮给 0.5 置信', () => {
  const m = mergeRuns([{ text: 'only one run\nsecond line' }]);
  assert.equal(m.runCount, 1);
  assert.equal(m.confidence, 0.5);
});

test('splitIntoEntries: 按空行与标签切条目并命名', () => {
  const entries = splitIntoEntries('<main>\nhi\n</main>\n\n## Rules\nbe nice');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'main');
  assert.equal(entries[1].name, 'Rules');
});
