import test from 'node:test';
import assert from 'node:assert/strict';

import { siteAdapters } from '../../dist/sites/registry.js';

const expectedAdapters = [
  '1688',
  'arxiv',
  'bilibili',
  'cninfo',
  'douyin',
  'eastmoney',
  'github',
  'hackernews',
  'jimeng',
  'media',
  'producthunt',
  'reddit',
  'rouman5',
  'sec',
  'suno',
  'telegram',
  'twitter',
  'x',
  'xhs',
  'xueqiu',
  'youtube',
];

test('site registry exposes every built-in adapter with commands', () => {
  const ids = siteAdapters.map(adapter => adapter.id).sort();
  assert.deepEqual(ids, expectedAdapters.sort());

  for (const adapter of siteAdapters) {
    assert.equal(typeof adapter.title, 'string');
    assert.equal(adapter.title.length > 0, true, `${adapter.id} title missing`);
    assert.equal(typeof adapter.description, 'string');
    assert.equal(adapter.description.length > 0, true, `${adapter.id} description missing`);
    assert.equal(adapter.commands.length > 0, true, `${adapter.id} commands missing`);
    for (const command of adapter.commands) {
      assert.equal(typeof command.name, 'string');
      assert.equal(command.name.length > 0, true, `${adapter.id} command name missing`);
      assert.equal(typeof command.description, 'string');
      assert.equal(command.description.length > 0, true, `${adapter.id} command description missing`);
      assert.equal(typeof command.configure, 'function');
    }
  }
});
