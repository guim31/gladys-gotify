// -----------------------------------------------------------------------------
// What reaches `docker logs`: the lifecycle at info level, everything per check
// or per message at debug level, repeated failures once. And the health checks
// run on the integration's own timer, never on the core polling (Gladys#3198).
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK_INTERVAL_MS, SCENE_ACTION_KEY } from '../src/app.js';
import { SERVER_STATES } from '../src/history.js';
import { Store } from '../src/store.js';
import { APP_TOKEN, USER_TOKEN, createFakeGotify } from './helpers/fakeGotify.js';
import { createWorld } from './helpers/world.js';

/**
 * Captures the lines of the SDK logger (console.log for debug/info,
 * console.error for warn/error), at every level.
 */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  const lines = [];
  // The SDK logger writes `[time] [LEVEL] [name]` then the arguments.
  const capture = (prefix, ...args) => {
    const [, level, name] = /\[(DEBUG|INFO|WARN|ERROR)\](?: \[([^\]]+)\])?/.exec(prefix) ?? [];
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    lines.push({ level: level?.toLowerCase(), name, text });
  };
  t.mock.method(console, 'log', capture);
  t.mock.method(console, 'error', capture);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return {
    lines,
    at: (...levels) => lines.filter((line) => levels.includes(line.level)).map((l) => l.text),
    clear: () => lines.splice(0),
  };
}

test('the health checks run on their own timer, without any onPoll call', async (t) => {
  captureLogs(t); // keeps the test output quiet
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.discoveredDevices, [], 'no device: nothing for the core to poll');
  const ack = await world.fake.poll({ external_id: 'gotify:anything', features: [] });
  assert.equal(ack.success, false, 'no onPoll handler: the core polling is never relied on');

  const versions = () => world.gotify.calls.filter((call) => call.path === '/version').length;
  const before = versions();
  world.gotify.down = 'ECONNREFUSED';
  await world.timers.runAll();
  await world.timers.runAll();
  assert.equal(world.app.history.server.state, SERVER_STATES.OFFLINE);
  world.gotify.down = null;
  await world.timers.runAll();
  assert.equal(world.app.history.server.state, SERVER_STATES.ONLINE);
  assert.equal(versions(), before + 3, 'three checks, driven by the timer alone');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    world.timers.pending.map((timer) => timer.delay),
    [CHECK_INTERVAL_MS],
  );
});

test('a normal cycle writes nothing at info level, and never a token', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(logs.at('info', 'warn', 'error'), ['Connected to Gotify (version 3.1.1)']);
  logs.clear();

  for (let i = 0; i < 5; i += 1) {
    await world.timers.runAll(); // health checks
  }
  await world.fake.sendMessage({ app_token: USER_TOKEN, priority: '5' }, { text: 'Hello' });
  await world.fake.sceneAction(SCENE_ACTION_KEY, { message: 'Door opened' });
  await world.timers.runAll();

  assert.deepEqual(logs.at('info', 'warn', 'error'), []);
  assert.ok(!logs.lines.some((line) => line.text.includes('gtfy')), 'no token in the logs');
  assert.ok(![APP_TOKEN, USER_TOKEN].some((token) => JSON.stringify(logs.lines).includes(token)));
});

test('a server down logs once when it goes, once when it comes back', async (t) => {
  const logs = captureLogs(t);
  const world = await createWorld();
  t.after(() => world.app.stop());
  logs.clear();

  world.gotify.down = 'ECONNREFUSED';
  for (let i = 0; i < 6; i += 1) {
    await world.timers.runAll();
  }
  assert.deepEqual(logs.at('info', 'warn', 'error'), [
    'Gotify is offline: Gotify does not answer (ECONNREFUSED)',
  ]);
  assert.ok(logs.at('debug').length >= 6, 'each failed check is still there at debug level');

  logs.clear();
  world.gotify.down = null;
  await world.timers.runAll();
  await world.timers.runAll();
  assert.deepEqual(logs.at('info', 'warn', 'error'), ['Gotify is back online (version 3.1.1)']);
});

test('a server down at start says so once, and a restart says where it stands', async (t) => {
  const logs = captureLogs(t);
  const gotify = createFakeGotify();
  gotify.down = 'ENOTFOUND';
  const first = await createWorld({ gotify });
  for (let i = 0; i < 4; i += 1) {
    await first.timers.runAll();
  }
  await first.app.stop();
  assert.deepEqual(logs.at('info', 'warn', 'error'), [
    'Gotify does not answer: Gotify does not answer (ENOTFOUND)',
  ]);

  logs.clear();
  gotify.down = null;
  const second = await createWorld({ gotify, stored: first.store.data });
  t.after(() => second.app.stop());
  await second.timers.runAll();
  assert.deepEqual(logs.at('info', 'warn', 'error'), ['Connected to Gotify (version 3.1.1)']);
});

test('a connection status Gladys refuses is logged once, and its return once', async (t) => {
  const logs = captureLogs(t);
  const gotify = createFakeGotify();
  const world = await createWorld({ gotify });
  t.after(() => world.app.stop());
  logs.clear();

  let refuse = true;
  const original = world.gladys.setConnectionStatus.bind(world.gladys);
  t.mock.method(world.gladys, 'setConnectionStatus', async (...args) => {
    if (refuse) {
      throw new Error('HTTP 500');
    }
    return original(...args);
  });
  gotify.down = 'ECONNREFUSED';
  for (let i = 0; i < 6; i += 1) {
    await world.timers.runAll();
  }
  assert.deepEqual(logs.at('warn', 'error'), [
    'Gotify is offline: Gotify does not answer (ECONNREFUSED)',
    'Cannot publish the connection status: HTTP 500',
  ]);
  logs.clear();
  refuse = false;
  await world.timers.runAll();
  assert.deepEqual(logs.at('info', 'warn', 'error'), ['Connection status published again']);
});

test('a volume that refuses every write is logged once, and its return once', async (t) => {
  const logs = captureLogs(t);
  const directory = await mkdtemp(join(tmpdir(), 'gladys-gotify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A file where the directory should be: every write fails.
  const blocked = join(directory, 'data');
  await writeFile(blocked, '');
  const store = new Store(blocked);
  for (let i = 0; i < 4; i += 1) {
    await store.save({ i });
  }
  assert.equal(logs.at('warn').length, 1);
  assert.match(logs.at('warn')[0], /^Cannot write /);
  assert.equal(logs.lines.find((line) => line.level === 'warn').name, 'gotify-store');

  await rm(blocked);
  await store.save({ i: 5 });
  assert.equal(logs.at('warn').length, 1);
  assert.equal(logs.at('info').length, 1);
  assert.match(logs.at('info')[0], /Writing .* works again$/);
});
