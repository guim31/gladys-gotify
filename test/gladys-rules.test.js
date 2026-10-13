// -----------------------------------------------------------------------------
// Conformity with the rules of the Gladys core.
//
// The device rules of the other integrations of the series (category/type
// pairs of test/fixtures/gladys-feature-table.json, polling, min/max…) do not
// apply: a communication integration publishes no device at all. This test
// pins it, so a device added one day comes with the full conformity test.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('a communication integration: no device, so no device rule to check', async (t) => {
  assert.equal(manifest.type, 'communication');
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.scanRequest();
  await world.fake.sendMessage({ priority: '5' }, { text: 'x' });
  await world.fake.action('test_connection', {});
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.deepEqual(world.fake.states, []);
  assert.equal(
    world.fake.requests
      .filter((request) => /\/device|\/state/.test(request.path))
      .filter((request) => request.method !== 'GET').length,
    0,
  );
});

test('the messages fit the core limits: text ≤ 4096 characters is all Gladys sends', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const text = 'é'.repeat(4096);
  assert.equal((await world.fake.sendMessage({ priority: '5' }, { text })).success, true);
  assert.equal(world.gotify.messages[0].message, text);
});
