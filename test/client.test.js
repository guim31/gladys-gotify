// -----------------------------------------------------------------------------
// The Gotify client against the real answers of a Gotify 3.1.1 server
// (test/fixtures/gotify/), and every way a request can fail.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_KINDS,
  FAILURE_REASONS,
  GotifyClient,
  GotifyError,
  describeUrl,
  failureReason,
  parseServerUrl,
} from '../src/gotify/client.js';
import {
  APP_TOKEN,
  CLIENT_TOKEN,
  SERVER_URL,
  createFakeGotify,
  fixture,
} from './helpers/fakeGotify.js';

const clientFor = (gotify, serverUrl = SERVER_URL) =>
  new GotifyClient({ serverUrl, request: gotify.request });

async function kindOf(promise) {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof GotifyError, `${err} is not a GotifyError`);
    return err;
  }
  assert.fail('no error');
}

test('the server address is normalized, path prefix kept', () => {
  assert.equal(parseServerUrl(' 192.0.2.10:8080 ').href, 'http://192.0.2.10:8080/');
  assert.equal(parseServerUrl('https://gotify.example.org/').href, 'https://gotify.example.org/');
  assert.equal(
    parseServerUrl('https://example.org/gotify/?x=1#a').href,
    'https://example.org/gotify',
  );
  assert.equal(
    describeUrl(parseServerUrl('https://me:secret@example.org:8443/g')),
    'https://example.org:8443/g',
  );
  assert.equal(
    new GotifyClient({ serverUrl: 'https://example.org/gotify/' }).url('/message'),
    'https://example.org/gotify/message',
  );
  assert.equal(
    new GotifyClient({ serverUrl: 'http://192.0.2.10' }).url('/message'),
    'http://192.0.2.10/message',
  );
});

test('an empty or invalid address is a configuration error', () => {
  assert.throws(() => parseServerUrl(''), { kind: ERROR_KINDS.NO_SERVER });
  assert.throws(() => parseServerUrl(undefined), { kind: ERROR_KINDS.NO_SERVER });
  assert.throws(() => parseServerUrl('ftp://192.0.2.10'), { kind: ERROR_KINDS.INVALID_URL });
  assert.throws(() => parseServerUrl('http://'), { kind: ERROR_KINDS.INVALID_URL });
  assert.throws(() => parseServerUrl('http://exa mple'), { kind: ERROR_KINDS.INVALID_URL });
});

test('check reads the version and the health, without any token', async () => {
  const gotify = createFakeGotify();
  assert.deepEqual(await clientFor(gotify).check(), {
    version: fixture('version').body.version,
    health: 'green',
    database: 'green',
  });
  assert.deepEqual(
    gotify.calls.map((call) => [call.method, call.path, call.headers['X-Gotify-Key']]),
    [
      ['GET', '/version', undefined],
      ['GET', '/health', undefined],
    ],
  );
});

test('send posts the message with the application token in a header', async () => {
  const gotify = createFakeGotify();
  const sent = await clientFor(gotify).send(` ${APP_TOKEN} `, { message: 'Hello from Gladys' });
  assert.equal(sent.id, 1);
  const [call] = gotify.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.url, `${SERVER_URL}/message`);
  assert.deepEqual(call.headers, { 'X-Gotify-Key': APP_TOKEN });
  assert.ok(!call.url.includes(APP_TOKEN), 'the token never goes in the URL');
});

test('the answers of a real server are understood', async () => {
  // message-full.json: what Gotify stored for a message with every option.
  const { body } = fixture('message-full');
  const gotify = createFakeGotify();
  gotify.overrides.set('POST /message', fixture('message-full'));
  const sent = await clientFor(gotify).send(APP_TOKEN, { message: body.message });
  assert.equal(sent.priority, 8);
  assert.equal(sent.extras['client::notification'].click.url, 'https://example.com/camera');
});

test('every failure has a kind, and never shows the token', async () => {
  const cases = [
    [() => ({}), 'gtfya.unknown', ERROR_KINDS.UNAUTHORIZED],
    [() => ({}), CLIENT_TOKEN, ERROR_KINDS.CLIENT_TOKEN],
    [() => ({}), '', ERROR_KINDS.NO_TOKEN],
    [
      (g) => g.overrides.set('POST /message', fixture('error-message-required')),
      APP_TOKEN,
      ERROR_KINDS.REJECTED,
    ],
    [
      (g) =>
        g.overrides.set('POST /message', {
          status: 500,
          body: '{"error":"Internal Server Error","errorCode":500,"errorDescription":"database is locked"}',
        }),
      APP_TOKEN,
      ERROR_KINDS.SERVER_ERROR,
    ],
    [
      (g) => g.overrides.set('POST /message', { status: 302, body: '' }),
      APP_TOKEN,
      ERROR_KINDS.REDIRECT,
    ],
    [
      (g) => g.overrides.set('POST /message', { status: 404, body: '<html>Not Found</html>' }),
      APP_TOKEN,
      ERROR_KINDS.NOT_GOTIFY,
    ],
    [
      (g) => g.overrides.set('POST /message', { status: 200, body: '<html>router login</html>' }),
      APP_TOKEN,
      ERROR_KINDS.NOT_GOTIFY,
    ],
    [
      (g) => g.overrides.set('POST /message', { status: 200, body: '{}' }),
      APP_TOKEN,
      ERROR_KINDS.NOT_GOTIFY,
    ],
    [
      (g) => {
        g.down = 'ECONNREFUSED';
      },
      APP_TOKEN,
      ERROR_KINDS.UNREACHABLE,
    ],
    [
      (g) => {
        g.down = 'ETIMEDOUT';
      },
      APP_TOKEN,
      ERROR_KINDS.UNREACHABLE,
    ],
    [
      (g) => {
        g.down = 'DEPTH_ZERO_SELF_SIGNED_CERT';
      },
      APP_TOKEN,
      ERROR_KINDS.TLS,
    ],
  ];
  for (const [arrange, token, kind] of cases) {
    const gotify = createFakeGotify();
    arrange(gotify);
    const err = await kindOf(clientFor(gotify).send(token, { message: 'x' }));
    assert.equal(err.kind, kind, `${kind}: ${err.message}`);
    assert.ok(!err.message.includes('gtfy'), `${kind}: "${err.message}" shows a token`);
  }
});

test('check refuses what is not a healthy Gotify', async () => {
  const notGotify = createFakeGotify();
  notGotify.overrides.set('GET /version', { status: 200, body: '{"name":"something else"}' });
  assert.equal((await kindOf(clientFor(notGotify).check())).kind, ERROR_KINDS.NOT_GOTIFY);

  const sick = createFakeGotify();
  sick.overrides.set('GET /health', { status: 200, body: '{"health":"orange","database":"red"}' });
  assert.equal((await kindOf(clientFor(sick).check())).kind, ERROR_KINDS.SERVER_ERROR);

  const down = createFakeGotify();
  down.down = 'EHOSTUNREACH';
  assert.equal((await kindOf(clientFor(down).check())).kind, ERROR_KINDS.UNREACHABLE);
});

test('the self-signed option reaches the request, a path prefix too', async () => {
  const gotify = createFakeGotify();
  const client = new GotifyClient({
    serverUrl: 'https://192.0.2.10/gotify',
    insecure: true,
    request: gotify.request,
  });
  await client.check();
  assert.equal(gotify.calls[0].url, 'https://192.0.2.10/gotify/version');
  assert.equal(gotify.calls[0].insecure, true);
});

test('every error kind has a failure reason', () => {
  for (const kind of Object.values(ERROR_KINDS)) {
    assert.ok(FAILURE_REASONS.includes(failureReason(kind)), kind);
  }
  assert.equal(failureReason(ERROR_KINDS.UNAUTHORIZED), 'token');
  assert.equal(failureReason(ERROR_KINDS.UNREACHABLE), 'unreachable');
  assert.equal(failureReason(ERROR_KINDS.NO_SERVER), 'configuration');
  assert.equal(failureReason(undefined), 'rejected');
});
