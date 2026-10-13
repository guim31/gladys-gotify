// -----------------------------------------------------------------------------
// The integration wired to the fake Gladys of the SDK and to the fake Gotify.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import {
  APP_TOKEN,
  SERVER_URL,
  createFakeGotify,
  createManualTimers,
  createMemoryStore,
} from './fakeGotify.js';

export const BASE_CONFIG = { server_url: SERVER_URL, app_token: APP_TOKEN, language: 'en' };

export async function createWorld({
  config = BASE_CONFIG,
  stored = {},
  gotify = createFakeGotify(),
  connect = true,
  now,
} = {}) {
  const gladys = createFakeGladys({ config });
  const store = createMemoryStore(stored);
  const timers = createManualTimers();
  const clock = { time: new Date('2026-10-13T10:00:00Z') };
  const app = registerHandlers(gladys, {
    request: gotify.request,
    store,
    now: now ?? (() => new Date(clock.time)),
    setTimer: timers.set,
    clearTimer: timers.clear,
  });
  if (connect) {
    await gladys.connect();
  }
  return { gladys, fake: gladys.fake, gotify, store, timers, clock, app };
}
