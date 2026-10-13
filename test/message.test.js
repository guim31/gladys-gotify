// -----------------------------------------------------------------------------
// Gladys message / scene action → body of POST /message.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { InvalidMessageError, fromGladysMessage, fromSceneAction } from '../src/gotify/message.js';
import { normalizeConfig } from '../src/config.js';
import { IMAGE_DROPPED } from '../src/texts.js';
import { fixture } from './helpers/fakeGotify.js';

const MARKDOWN = { 'client::display': { contentType: 'text/markdown' } };

test('a Gladys message is Markdown, without title nor priority by default', () => {
  assert.deepEqual(
    fromGladysMessage(
      { text: '  **Door** opened  ', file: null },
      { priority: null, markdown: true, language: 'en' },
    ),
    { message: '**Door** opened', extras: MARKDOWN },
  );
  assert.deepEqual(
    fromGladysMessage({ text: 'Hello' }, { priority: 8, markdown: false, language: 'en' }),
    { message: 'Hello', priority: 8 },
  );
});

test('a camera image cannot follow: a line says so', () => {
  const file = 'image/jpg;base64,/9j/4AAQSkZJRg==';
  const withText = fromGladysMessage(
    { text: 'Someone at the door', file },
    { priority: null, markdown: true, language: 'fr' },
  );
  assert.equal(withText.message, `Someone at the door\n\n_${IMAGE_DROPPED.fr}_`);
  const alone = fromGladysMessage(
    { text: '', file },
    { priority: null, markdown: false, language: 'de' },
  );
  assert.equal(alone.message, IMAGE_DROPPED.de);
});

test('an empty message is refused before reaching Gotify', () => {
  for (const message of [{ text: '' }, { text: '   ' }, {}, null]) {
    assert.throws(
      () => fromGladysMessage(message, { priority: null, markdown: true, language: 'en' }),
      InvalidMessageError,
    );
  }
});

test('the scene action builds the request of the real message-full fixture', () => {
  const config = normalizeConfig({ markdown: true });
  const payload = fromSceneAction(
    {
      title: 'Front door',
      message: '**Front door** opened',
      priority: '8',
      url: 'https://example.com/camera',
      image_url: 'https://example.com/snapshot.jpg',
    },
    config,
  );
  const stored = fixture('message-full').body;
  assert.deepEqual(payload, {
    message: stored.message,
    title: stored.title,
    priority: stored.priority,
    extras: stored.extras,
  });
});

test('the scene action: defaults, priorities, numbers from scene variables', () => {
  const config = normalizeConfig({ default_priority: '5', markdown: false });
  assert.deepEqual(fromSceneAction({ message: 'Hi', priority: 'default' }, config), {
    message: 'Hi',
    priority: 5,
  });
  assert.equal(fromSceneAction({ message: 21.5, priority: 42 }, config).message, '21.5');
  assert.equal(fromSceneAction({ message: 'x', priority: 42 }, config).priority, 10);
  assert.equal(fromSceneAction({ message: 'x', priority: '-3' }, config).priority, 0);
  assert.equal(fromSceneAction({ message: 'x' }, normalizeConfig({})).priority, undefined);
  assert.equal(fromSceneAction({ message: 'x', title: 't'.repeat(400) }, config).title.length, 250);
  assert.deepEqual(fromSceneAction({ message: 'x', markdown: true }, config).extras, MARKDOWN);
});

test('the scene action refuses an empty text and links that are not http(s)', () => {
  const config = normalizeConfig({});
  assert.throws(() => fromSceneAction({ message: ' ' }, config), InvalidMessageError);
  assert.throws(() => fromSceneAction({}, config), InvalidMessageError);
  assert.throws(
    () => fromSceneAction({ message: 'x', url: 'javascript:alert(1)' }, config),
    /only http/,
  );
  assert.throws(
    () => fromSceneAction({ message: 'x', image_url: 'not a url' }, config),
    /not a URL/,
  );
  assert.equal(
    fromSceneAction({ message: 'x', url: '' }, config).extras['client::notification'],
    undefined,
  );
});
