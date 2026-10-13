import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  PRIORITIES,
  normalizeConfig,
  normalizeContact,
  parsePriority,
} from '../src/config.js';

test('the configuration gets its defaults and its types', () => {
  assert.deepEqual(normalizeConfig(undefined), {
    server_url: '',
    app_token: '',
    default_priority: null,
    markdown: true,
    allow_self_signed: false,
    language: 'fr',
  });
  assert.deepEqual(
    normalizeConfig({
      server_url: ' http://192.0.2.10 ',
      app_token: ' tok ',
      default_priority: '8',
      markdown: false,
      allow_self_signed: true,
      language: 'it',
    }),
    {
      server_url: 'http://192.0.2.10',
      app_token: 'tok',
      default_priority: 8,
      markdown: false,
      allow_self_signed: true,
      language: 'fr',
    },
  );
  assert.equal(normalizeConfig({ app_token: null }).app_token, '');
  assert.equal(DEFAULT_CONFIG.default_priority, 'default');
});

test('priorities are integers from 0 to 10, or null for the default', () => {
  assert.deepEqual(PRIORITIES.map(parsePriority), [null, 0, 2, 5, 8, 10]);
  assert.equal(parsePriority('7,6'), 8);
  assert.equal(parsePriority(-1), 0);
  assert.equal(parsePriority(11), 10);
  assert.equal(parsePriority('abc'), null);
  assert.equal(parsePriority(null), null);
});

test('the "My account" values of a user', () => {
  assert.deepEqual(normalizeContact({ app_token: ' t ', priority: '2' }), {
    appToken: 't',
    priority: 2,
  });
  assert.deepEqual(normalizeContact(null), { appToken: '', priority: null });
  assert.deepEqual(normalizeContact({ priority: 'default' }), { appToken: '', priority: null });
});
