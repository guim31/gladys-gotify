// -----------------------------------------------------------------------------
// An in-memory Gotify server answering with the real answers captured in
// test/fixtures/gotify/: a drop-in replacement of src/gotify/http.js.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const APP_TOKEN = 'gtfya.EXAMPLE-application-token';
export const USER_TOKEN = 'gtfya.EXAMPLE-user-token';
export const CLIENT_TOKEN = 'gtfyc.EXAMPLE-client-token';
export const SERVER_URL = 'http://192.0.2.10:8080';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/gotify/${name}.json`, import.meta.url), 'utf8'));

const answer = ({ status, body }) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

export function createFakeGotify({ tokens = [APP_TOKEN, USER_TOKEN] } = {}) {
  const fake = {
    /** Every request received: { method, path, headers, json, insecure, timeoutMs }. */
    calls: [],
    /** The messages stored, as Gotify answered them. */
    messages: [],
    /** A network error code (ECONNREFUSED…) to throw, or null. */
    down: null,
    /** Replaces the answer of one "METHOD /path": a function of the call, or a fixed answer. */
    overrides: new Map(),
    nextId: 1,

    async request(url, { method = 'GET', headers = {}, json, insecure, timeoutMs } = {}) {
      const target = new URL(url);
      const call = { method, url, path: target.pathname, headers, json, insecure, timeoutMs };
      fake.calls.push(call);
      if (fake.down) {
        const error = new Error(`connect ${fake.down}`);
        error.code = fake.down;
        throw error;
      }
      const override = fake.overrides.get(`${method} ${target.pathname}`);
      if (override) {
        return answer(typeof override === 'function' ? override(call) : override);
      }
      const path = target.pathname.replace(/^\/gotify/, '');
      if (method === 'GET' && path === '/version') {
        return answer(fixture('version'));
      }
      if (method === 'GET' && path === '/health') {
        return answer(fixture('health'));
      }
      if (method === 'POST' && path === '/message') {
        const token = headers['X-Gotify-Key'];
        if (token === CLIENT_TOKEN) {
          return answer(fixture('error-client-token'));
        }
        if (!tokens.includes(token)) {
          return answer(fixture('error-unauthorized'));
        }
        if (!json?.message) {
          return answer(fixture('error-message-required'));
        }
        const stored = {
          id: fake.nextId,
          appid: tokens.indexOf(token) + 1,
          message: json.message,
          title: json.title ?? 'Gladys',
          priority: json.priority ?? 0,
          ...(json.extras ? { extras: json.extras } : {}),
          date: '2026-10-13T05:13:30.000000000Z',
          token,
        };
        fake.nextId += 1;
        fake.messages.push(stored);
        const { token: _token, ...body } = stored;
        return answer({ status: 200, body });
      }
      return answer(fixture('error-not-found'));
    },
  };
  fake.request = fake.request.bind(fake);
  return fake;
}

/** A store kept in memory (same interface as src/store.js). */
export function createMemoryStore(initial = {}) {
  return {
    data: structuredClone(initial),
    saves: 0,
    async load() {
      return structuredClone(this.data);
    },
    save(data) {
      this.data = structuredClone(data);
      this.saves += 1;
      return Promise.resolve();
    },
    flush() {
      return Promise.resolve();
    },
  };
}

/** Timers run by hand: `timers.pending` lists them, `timers.run()` fires the due ones. */
export function createManualTimers() {
  const timers = {
    pending: [],
    set(callback, delay) {
      const timer = { callback, delay };
      timers.pending.push(timer);
      return timer;
    },
    clear(timer) {
      timers.pending = timers.pending.filter((entry) => entry !== timer);
    },
    /** Fires every pending timer once; resolves once the callbacks settled. */
    async runAll() {
      const due = timers.pending;
      timers.pending = [];
      due.forEach((timer) => timer.callback());
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
  return timers;
}
