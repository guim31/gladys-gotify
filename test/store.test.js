// -----------------------------------------------------------------------------
// The persistence under /data, in a temporary directory, and History on top.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { History, MAX_RECENT, SERVER_STATES, localDay } from '../src/history.js';

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'gladys-gotify-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('the store writes atomically and reads back, a broken file is an empty state', async () => {
  await withDirectory(async (directory) => {
    const store = new Store(directory);
    assert.deepEqual(await store.load(), {});
    store.save({ a: 1 });
    store.save({ a: 2 });
    await store.flush();
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'gotify-state.json'), 'utf8')), {
      a: 2,
    });
    assert.deepEqual(await new Store(directory).load(), { a: 2 });
    await writeFile(join(directory, 'gotify-state.json'), '{ not json');
    assert.deepEqual(await new Store(directory).load(), {});
  });
});

test('history keeps the last scene notifications only, and survives a restart', async () => {
  await withDirectory(async (directory) => {
    const now = () => new Date('2026-10-13T10:00:00Z');
    const history = new History({ store: new Store(directory), now });
    await history.load();
    for (let i = 0; i < MAX_RECENT + 3; i += 1) {
      history.record({
        origin: 'scene_action',
        delivered: true,
        notification: { message: `n${i}`, priority: 5 },
      });
    }
    history.record({ origin: 'gladys_message', delivered: false, kind: 'unauthorized' });
    history.setServer({ state: SERVER_STATES.ONLINE, address: 'abc', version: '3.1.1' });
    await history.flush();

    const again = new History({ store: new Store(directory), now });
    await again.load();
    assert.equal(again.data.recent.length, MAX_RECENT);
    assert.equal(again.data.recent[0].message, `n${MAX_RECENT + 2}`);
    assert.deepEqual(again.today(), {
      sent: MAX_RECENT + 3,
      failed: 1,
      lastError: { kind: 'unauthorized', at: '2026-10-13T10:00:00.000Z' },
    });
    assert.equal(again.server.state, SERVER_STATES.ONLINE);
    assert.equal(again.server.version, '3.1.1');
  });
});

test('long texts are shortened, the local day follows the time zone of the process', () => {
  const history = new History({
    store: { load: async () => ({}), save: async () => {}, flush: async () => {} },
  });
  history.record({
    origin: 'scene_action',
    delivered: true,
    notification: { title: 't'.repeat(300), message: 'm'.repeat(2000) },
  });
  assert.equal(Array.from(history.data.recent[0].message).length, 500);
  assert.equal(Array.from(history.data.recent[0].title).length, 120);
  assert.match(localDay(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});
