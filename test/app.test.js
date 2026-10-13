// -----------------------------------------------------------------------------
// The whole integration against the fake Gladys of the SDK and an in-memory
// Gotify answering like the real one.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  ACTION_KEY,
  CHECK_INTERVAL_MS,
  FAILURE_EVENT_INTERVAL_MS,
  MESSAGE_TIMEOUT_MS,
  RECHECK_DELAY_MS,
  SCENE_ACTION_KEY,
  TRIGGERS,
} from '../src/app.js';
import { SERVER_STATES } from '../src/history.js';
import { ERROR_TEXT } from '../src/texts.js';
import { TEST_ACTION, WIDGET_KEY } from '../src/widgets.js';
import { APP_TOKEN, CLIENT_TOKEN, USER_TOKEN, createFakeGotify } from './helpers/fakeGotify.js';
import { BASE_CONFIG, createWorld } from './helpers/world.js';

const events = (fake, key) => fake.sceneEvents.filter((event) => event.key === key);

test('connecting checks the server and reports it connected', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.app.history.server.state, SERVER_STATES.ONLINE);
  assert.equal(world.app.history.server.version, '3.1.1');
  assert.deepEqual(world.fake.sceneEvents, [], 'the first known state is not a transition');
  assert.deepEqual(
    world.timers.pending.map((timer) => timer.delay),
    [CHECK_INTERVAL_MS],
  );
  assert.deepEqual(world.fake.discoveredDevices, [], 'a communication integration has no device');
});

test('without an address, the configuration screen says what to do', async (t) => {
  const world = await createWorld({ config: {} });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT.no_server,
  });
  assert.equal(world.gotify.calls.length, 0);
});

test('a Gladys message goes with the token and priority of the user', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, default_priority: '5' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sendMessage(
    { app_token: USER_TOKEN, priority: '8' },
    { text: 'The **washing machine** is done', file: null },
  );
  assert.deepEqual(ack, { success: true });
  const [message] = world.gotify.messages;
  assert.equal(message.token, USER_TOKEN);
  assert.equal(message.priority, 8);
  assert.equal(message.message, 'The **washing machine** is done');
  assert.deepEqual(message.extras, { 'client::display': { contentType: 'text/markdown' } });
  const post = world.gotify.calls.find((call) => call.method === 'POST');
  assert.equal(post.timeoutMs, MESSAGE_TIMEOUT_MS);
});

test('a user without a token of their own gets the shared one and the default priority', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, default_priority: '2' } });
  t.after(() => world.app.stop());
  assert.deepEqual(await world.fake.sendMessage({ priority: 'default' }, { text: 'Hi' }), {
    success: true,
  });
  assert.equal(world.gotify.messages[0].token, APP_TOKEN);
  assert.equal(world.gotify.messages[0].priority, 2);
});

test('a refused token fails the message, fires the trigger once per 15 minutes', async (t) => {
  const world = await createWorld({ config: { ...BASE_CONFIG, app_token: '' } });
  t.after(() => world.app.stop());

  const first = await world.fake.sendMessage({ app_token: 'gtfya.revoked' }, { text: 'a' });
  assert.equal(first.success, false);
  assert.match(first.error, /token refused/);
  assert.ok(!first.error.includes('gtfya'), 'the token is not in the error');
  assert.deepEqual(events(world.fake, TRIGGERS.FAILED), [
    {
      key: TRIGGERS.FAILED,
      data: { reason: 'token', origin: 'gladys_message', error: ERROR_TEXT.unauthorized.en },
    },
  ]);

  // Without any token at all: the same reason, still within 15 minutes.
  assert.equal((await world.fake.sendMessage({ priority: '5' }, { text: 'b' })).success, false);
  assert.equal(
    (await world.fake.sendMessage({ app_token: CLIENT_TOKEN }, { text: 'c' })).success,
    false,
  );
  assert.equal(events(world.fake, TRIGGERS.FAILED).length, 1);

  world.clock.time = new Date(world.clock.time.getTime() + FAILURE_EVENT_INTERVAL_MS);
  await world.fake.sendMessage({ app_token: CLIENT_TOKEN }, { text: 'd' });
  assert.equal(events(world.fake, TRIGGERS.FAILED).length, 2);
  assert.equal(world.app.history.today().failed, 4);
});

test('the scene action sends a full notification and returns its outputs', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction(SCENE_ACTION_KEY, {
    title: 'Front door',
    message: 'Opened while **away**',
    priority: '8',
    url: 'https://example.com/camera',
    image_url: '',
  });
  assert.deepEqual(ack, {
    success: true,
    data: { outputs: { delivered: true, message_id: 1, error: '' } },
  });
  const [message] = world.gotify.messages;
  assert.equal(message.title, 'Front door');
  assert.equal(message.priority, 8);
  assert.deepEqual(message.extras['client::notification'], {
    click: { url: 'https://example.com/camera' },
  });
  assert.equal(world.app.history.data.recent[0].title, 'Front door');
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('a scene notification that fails is an output, a wrong field fails the action', async (t) => {
  const gotify = createFakeGotify();
  const world = await createWorld({ gotify });
  t.after(() => world.app.stop());
  gotify.down = 'ECONNREFUSED';
  const ack = await world.fake.sceneAction(SCENE_ACTION_KEY, { message: 'x' });
  assert.deepEqual(ack.data.outputs, {
    delivered: false,
    message_id: 0,
    error: ERROR_TEXT.unreachable.en,
  });
  assert.equal(world.app.history.data.recent[0].delivered, false);
  assert.deepEqual(events(world.fake, TRIGGERS.FAILED)[0].data, {
    reason: 'unreachable',
    origin: 'scene_action',
    error: ERROR_TEXT.unreachable.en,
  });

  const invalid = await world.fake.sceneAction(SCENE_ACTION_KEY, {
    message: 'x',
    url: 'file:///etc/passwd',
  });
  assert.equal(invalid.success, false);
  assert.match(invalid.error, /only http/);
});

test('the test action reports in the four languages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action(ACTION_KEY, {});
  assert.equal(ack.success, true);
  assert.deepEqual(Object.keys(ack.data.message), ['en', 'fr', 'de', 'es']);
  assert.equal(ack.data.message.en, 'Gotify 3.1.1 answers. Test notification sent (message #1).');
  assert.equal(world.gotify.messages[0].title, 'Gladys test');
  assert.equal(world.gotify.messages[0].extras, undefined, 'the test text is plain');
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('the test action without a shared token, and with a server down', async (t) => {
  const gotify = createFakeGotify();
  const world = await createWorld({ config: { ...BASE_CONFIG, app_token: '' }, gotify });
  t.after(() => world.app.stop());
  let ack = await world.fake.action(ACTION_KEY, {});
  assert.match(ack.data.message.fr, /Pas de jeton d'application partagé/);
  assert.equal(world.gotify.messages.length, 0);

  gotify.down = 'ECONNREFUSED';
  ack = await world.fake.action(ACTION_KEY, {});
  assert.equal(ack.data.message.en, 'Gotify cannot be reached: the Gotify server does not answer.');
});

test('offline after two failed checks, back online on the next good one', async (t) => {
  const gotify = createFakeGotify();
  const world = await createWorld({ gotify });
  t.after(() => world.app.stop());

  gotify.down = 'ECONNREFUSED';
  await world.timers.runAll(); // the 5-minute check fails once
  assert.equal(world.app.history.server.state, SERVER_STATES.ONLINE, 'one failure is a blip');
  assert.deepEqual(
    world.timers.pending.map((timer) => timer.delay),
    [RECHECK_DELAY_MS],
  );

  await world.timers.runAll(); // the recheck 30 s later fails too
  assert.equal(world.app.history.server.state, SERVER_STATES.OFFLINE);
  assert.deepEqual(events(world.fake, TRIGGERS.OFFLINE), [
    { key: TRIGGERS.OFFLINE, data: { error: ERROR_TEXT.unreachable.en } },
  ]);
  assert.deepEqual(world.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT.unreachable,
  });

  await world.timers.runAll(); // still down: no second event
  assert.equal(events(world.fake, TRIGGERS.OFFLINE).length, 1);

  gotify.down = null;
  await world.timers.runAll();
  assert.equal(world.app.history.server.state, SERVER_STATES.ONLINE);
  assert.deepEqual(events(world.fake, TRIGGERS.ONLINE), [
    { key: TRIGGERS.ONLINE, data: { version: '3.1.1' } },
  ]);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a message delivered while offline brings the server back at once', async (t) => {
  const gotify = createFakeGotify();
  const world = await createWorld({ gotify });
  t.after(() => world.app.stop());
  gotify.down = 'ECONNREFUSED';
  await world.timers.runAll();
  await world.timers.runAll();
  assert.equal(world.app.history.server.state, SERVER_STATES.OFFLINE);
  gotify.down = null;
  await world.fake.sendMessage({ priority: '5' }, { text: 'hello' });
  await world.app.check();
  assert.equal(world.app.history.server.state, SERVER_STATES.ONLINE);
  assert.equal(events(world.fake, TRIGGERS.ONLINE).length, 1);
});

test('a restart neither forgets nor repeats a transition', async (t) => {
  const gotify = createFakeGotify();
  // First run: the server was online, then went down.
  const first = await createWorld({ gotify });
  gotify.down = 'ECONNREFUSED';
  await first.timers.runAll();
  await first.timers.runAll();
  await first.app.stop();
  assert.equal(events(first.fake, TRIGGERS.OFFLINE).length, 1);

  // Restart while it is still down: no new "offline" event…
  const second = await createWorld({ gotify, stored: first.store.data });
  t.after(() => second.app.stop());
  await second.timers.runAll();
  assert.deepEqual(second.fake.sceneEvents, []);
  // …and its return is still announced.
  gotify.down = null;
  await second.timers.runAll();
  assert.equal(events(second.fake, TRIGGERS.ONLINE).length, 1);
});

test('a first failed check after installation announces nothing', async (t) => {
  const gotify = createFakeGotify();
  gotify.down = 'ENOTFOUND';
  const world = await createWorld({ gotify });
  t.after(() => world.app.stop());
  assert.equal(world.app.history.server.state, SERVER_STATES.OFFLINE);
  assert.deepEqual(world.fake.sceneEvents, []);
  assert.equal(world.fake.connectionStatus.connected, false);
});

test('a new address forgets the state of the previous server', async (t) => {
  const gotify = createFakeGotify();
  const world = await createWorld({ gotify });
  t.after(() => world.app.stop());
  gotify.down = 'ECONNREFUSED';
  await world.fake.configUpdated({ ...BASE_CONFIG, server_url: 'http://192.0.2.20' });
  assert.equal(world.app.history.server.state, SERVER_STATES.OFFLINE);
  assert.deepEqual(world.fake.sceneEvents, [], 'not the same server: not a transition');
  assert.equal(world.timers.pending.length, 1, 'one timer only');
  assert.ok(!JSON.stringify(world.store.data).includes('192.0.2'), 'no address stored');
});

test('the widget lists scene notifications only, within the budget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.sendMessage({ priority: '5' }, { text: 'Personal message for one user' });
  await world.fake.sceneAction(SCENE_ACTION_KEY, { message: 'Garage left open', priority: '8' });

  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language, units: 'metric' });
    assert.equal(ack.success, true);
    const content = ack.data.content ?? ack.data;
    assert.deepEqual(validateWidgetContent(content), [], language);
    const json = JSON.stringify(content);
    assert.ok(json.includes('Garage left open'));
    assert.ok(!json.includes('Personal message'), 'a message to one user is never listed');
  }
  const ack = await world.fake.widgetGet(WIDGET_KEY, {
    settings: {},
    language: 'en',
    units: 'metric',
  });
  const content = ack.data.content ?? ack.data;
  const status = content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Gotify server', 'Online (3.1.1)'],
      ['Sent today', 2],
      ['Failed today', 0],
    ],
  );
});

test('the widget when nothing was sent yet, and its test button', async (t) => {
  const world = await createWorld({ config: { server_url: '' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, {
    settings: {},
    language: 'fr',
    units: 'metric',
  });
  const content = ack.data.content ?? ack.data;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    content.components.map((component) => component.type),
    ['status', 'text', 'button'],
  );
  assert.equal(content.components[0].items[0].value, 'Non configuré');

  const toast = await world.fake.widgetAction(WIDGET_KEY, TEST_ACTION, {}, { settings: {} });
  assert.equal(toast.success, true);
  for (const text of Object.values(toast.data.message ?? toast.data)) {
    assert.ok(text.length <= 200);
  }
  const unknown = await world.fake.widgetAction(WIDGET_KEY, 'nope', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('the counters restart at local midnight', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.sendMessage({ priority: '5' }, { text: 'x' });
  assert.equal(world.app.history.today().sent, 1);
  world.clock.time = new Date(world.clock.time.getTime() + 24 * 3600 * 1000);
  assert.equal(world.app.history.today().sent, 0);
});

test('stop clears the timer and stops checking', async () => {
  const world = await createWorld();
  await world.app.stop();
  assert.deepEqual(world.timers.pending, []);
  const calls = world.gotify.calls.length;
  await world.app.check();
  assert.equal(world.gotify.calls.length, calls);
});

test('nothing secret is stored, nor logged in the connection status', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.sceneAction(SCENE_ACTION_KEY, { message: 'x' });
  await world.fake.sendMessage({ app_token: 'gtfya.wrong' }, { text: 'y' });
  const everything = JSON.stringify([
    world.store.data,
    world.fake.connectionStatuses,
    world.fake.sceneEvents,
  ]);
  assert.ok(!everything.includes('gtfy'));
});
