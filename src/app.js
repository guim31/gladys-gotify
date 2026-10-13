// -----------------------------------------------------------------------------
// The integration: wires the Gladys SDK to the Gotify client.
//
// - onSendMessage: Gladys sends a message to ONE user (a scene "Send a
//   message", the replies of the brain, the system messages). The user's
//   "My account" values (contact_schema) say which application token and
//   priority to use; the shared token of the configuration is the fallback.
// - Scene action `send_notification`: a notification with title, priority,
//   link and image, sent with the shared token.
// - Action `test_connection` and the widget button: check the server, send a
//   test notification.
// - A health check every 5 minutes (GET /version + /health, no token): the
//   connection status of the Configuration screen, the widget, and the
//   `server_offline` / `server_online` triggers. Offline is declared after two
//   failed checks 30 s apart, never on one blip.
// - Trigger `delivery_failed`: at most once per reason per 15 minutes, so a
//   scene answering it with another Gotify notification cannot loop.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, normalizeContact } from './config.js';
import {
  ERROR_KINDS,
  GotifyClient,
  GotifyError,
  UNREACHABLE_KINDS,
  failureReason,
} from './gotify/client.js';
import { InvalidMessageError, fromGladysMessage, fromSceneAction } from './gotify/message.js';
import { httpRequest } from './gotify/http.js';
import { History, SERVER_STATES } from './history.js';
import { Store } from './store.js';
import { REPORT_TEXT, each, errorText, errorTexts } from './texts.js';
import { TEST_ACTION, WIDGET_KEY, buildWidgetContent } from './widgets.js';

const logger = createLogger({ name: 'gotify' });

export const ACTION_KEY = 'test_connection';
export const SCENE_ACTION_KEY = 'send_notification';
export const TRIGGERS = {
  OFFLINE: 'server_offline',
  ONLINE: 'server_online',
  FAILED: 'delivery_failed',
};

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const RECHECK_DELAY_MS = 30 * 1000;
export const FAILURE_EVENT_INTERVAL_MS = 15 * 60 * 1000;
// Gladys waits 5 s for the ack of a message: answer before, even if Gotify is slow.
export const MESSAGE_TIMEOUT_MS = 4000;
export const ACTION_TIMEOUT_MS = 10_000;

/** A stable fingerprint of the server address, stored instead of the address itself. */
const fingerprint = (client) =>
  client ? createHash('sha256').update(client.base.href).digest('hex').slice(0, 16) : null;

/**
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} [options] replaced by the tests
 * @param {typeof httpRequest} [options.request]
 * @param {{ load(): Promise<object>, save(data: object): Promise<void>, flush(): Promise<void> }} [options.store]
 * @param {() => Date} [options.now]
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 */
export function registerHandlers(gladys, options = {}) {
  const {
    request = httpRequest,
    store = new Store(),
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = options;

  const history = new History({ store, now });
  const loaded = history.load();

  let config = normalizeConfig({});
  let client = null;
  let configError = new GotifyError(ERROR_KINDS.NO_SERVER, 'Not configured yet');
  let generation = 0; // bumped at each configuration: stale checks are ignored
  let failures = 0; // consecutive failed checks
  let timer = null;
  let checking = null;
  let stopped = false;
  let lastStatus = null; // the last connection status published, to publish changes only
  const lastFailureEvent = new Map(); // reason → time of the last delivery_failed event

  // --- Gladys side effects, never fatal --------------------------------------

  async function publishStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === lastStatus || !gladys.connected) {
      return;
    }
    try {
      await gladys.setConnectionStatus(connected, message);
      lastStatus = key;
    } catch (err) {
      logger.warn(`Cannot publish the connection status: ${err.message}`);
    }
  }

  async function fire(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Cannot fire the "${key}" trigger: ${err.message}`);
    }
  }

  function refreshWidget() {
    try {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    } catch (err) {
      logger.debug(`Widget refresh not requested: ${err.message}`);
    }
  }

  // --- Server state ------------------------------------------------------------

  function schedule(delay) {
    if (timer) {
      clearTimer(timer);
    }
    timer = stopped
      ? null
      : setTimer(() => {
          timer = null;
          check().catch((err) => logger.error('Health check failed', err));
        }, delay);
    timer?.unref?.();
  }

  async function setServerState(state, { version, error } = {}) {
    await loaded;
    const previous = history.setServer({ state, address: fingerprint(client), version });
    if (previous === state) {
      return;
    }
    refreshWidget();
    // Transitions only: the first state known after an installation or a new
    // address is not news.
    if (previous === SERVER_STATES.ONLINE && state === SERVER_STATES.OFFLINE) {
      logger.warn(`Gotify is offline: ${error?.message}`);
      await fire(TRIGGERS.OFFLINE, { error: errorText(error, config.language) });
    } else if (previous === SERVER_STATES.OFFLINE && state === SERVER_STATES.ONLINE) {
      logger.info(`Gotify is back online (version ${version})`);
      await fire(TRIGGERS.ONLINE, { version: version ?? '' });
    }
  }

  async function runCheck() {
    const current = generation;
    if (!client) {
      failures = 0;
      await publishStatus(false, errorTexts(configError));
      refreshWidget();
      return;
    }
    try {
      const { version } = await client.check();
      if (current !== generation) {
        return;
      }
      failures = 0;
      await publishStatus(true);
      await setServerState(SERVER_STATES.ONLINE, { version });
    } catch (err) {
      if (current !== generation) {
        return;
      }
      failures += 1;
      logger.debug(`Health check of ${client.description} failed: ${err.message}`);
      if (failures >= 2 || history.server.state !== SERVER_STATES.ONLINE) {
        await publishStatus(false, errorTexts(err));
        await setServerState(SERVER_STATES.OFFLINE, { error: err });
      }
    } finally {
      if (current === generation) {
        schedule(failures === 1 ? RECHECK_DELAY_MS : CHECK_INTERVAL_MS);
      }
    }
  }

  /** One check at a time; a check requested meanwhile runs right after. */
  function check() {
    if (stopped) {
      return Promise.resolve();
    }
    if (!checking) {
      checking = runCheck().finally(() => {
        checking = null;
      });
    }
    return checking;
  }

  async function applyConfig(raw) {
    config = normalizeConfig(raw);
    generation += 1;
    failures = 0;
    try {
      client = new GotifyClient({
        serverUrl: config.server_url,
        insecure: config.allow_self_signed,
        request,
      });
      configError = null;
    } catch (err) {
      client = null;
      configError = err;
    }
    await loaded;
    if (history.server.address !== fingerprint(client)) {
      // Another server: what was known of the previous one no longer holds.
      history.setServer({
        state: SERVER_STATES.UNKNOWN,
        address: fingerprint(client),
        version: null,
      });
    }
    await checking; // let a check of the previous configuration end (its result is ignored)
    await check();
  }

  // --- Deliveries ----------------------------------------------------------------

  async function afterDelivery({ origin, delivered, error, notification }) {
    await loaded;
    history.record({ origin, delivered, kind: error?.kind, notification });
    refreshWidget();
    if (delivered) {
      if (history.server.state !== SERVER_STATES.ONLINE) {
        check().catch(() => {});
      }
      return;
    }
    if (UNREACHABLE_KINDS.has(error?.kind) && history.server.state === SERVER_STATES.ONLINE) {
      check().catch(() => {});
    }
    if (origin === 'test') {
      return; // the user is looking at the result already
    }
    const reason = failureReason(error instanceof InvalidMessageError ? undefined : error?.kind);
    const last = lastFailureEvent.get(reason);
    if (last !== undefined && now().getTime() - last < FAILURE_EVENT_INTERVAL_MS) {
      return;
    }
    lastFailureEvent.set(reason, now().getTime());
    await fire(TRIGGERS.FAILED, {
      reason,
      origin,
      error: errorText(error, config.language),
    });
  }

  function requireClient() {
    if (!client) {
      throw configError;
    }
    return client;
  }

  /** Sends the test notification with the shared token: the action and the widget button. */
  async function testConnection() {
    let version;
    try {
      ({ version } = await requireClient().check());
    } catch (err) {
      check().catch(() => {});
      return each(REPORT_TEXT, (text, lang) => text.unreachable(errorText(err, lang)));
    }
    check().catch(() => {});
    const reachable = (text) => text.reachable(version);
    if (!config.app_token) {
      return each(REPORT_TEXT, (text) => `${reachable(text)} ${text.noToken}`);
    }
    const text = REPORT_TEXT[config.language];
    const notification = {
      title: text.title,
      message: text.message,
      priority: config.default_priority,
    };
    try {
      const sent = await client.send(
        config.app_token,
        fromSceneAction(notification, { ...config, markdown: false }),
        { timeoutMs: ACTION_TIMEOUT_MS },
      );
      await afterDelivery({ origin: 'test', delivered: true });
      return each(REPORT_TEXT, (t) => `${reachable(t)} ${t.sent(sent.id)}`);
    } catch (err) {
      await afterDelivery({ origin: 'test', delivered: false, error: err });
      return each(REPORT_TEXT, (t, lang) => `${reachable(t)} ${t.failed(errorText(err, lang))}`);
    }
  }

  // --- Handlers ----------------------------------------------------------------

  gladys.onSendMessage(async (contact, message) => {
    const { appToken, priority } = normalizeContact(contact);
    try {
      const payload = fromGladysMessage(message, {
        priority: priority ?? config.default_priority,
        markdown: config.markdown,
        language: config.language,
      });
      await requireClient().send(appToken || config.app_token, payload, {
        timeoutMs: MESSAGE_TIMEOUT_MS,
      });
      await afterDelivery({ origin: 'gladys_message', delivered: true });
    } catch (err) {
      logger.warn(`Message not delivered to Gotify: ${err.message}`);
      await afterDelivery({ origin: 'gladys_message', delivered: false, error: err });
      // The core logs this text: the English explanation, never the token.
      throw new Error(`Gotify: ${errorText(err, 'en')}`, { cause: err });
    }
  });

  gladys.onSceneAction(SCENE_ACTION_KEY, async (fields) => {
    // Invalid fields fail the action (the scene logs it); a delivery failure
    // is an output the scene can test, like the `delivery_failed` trigger.
    const payload = fromSceneAction(fields, config);
    const notification = {
      title: payload.title,
      message: payload.message,
      priority: payload.priority,
    };
    try {
      const sent = await requireClient().send(config.app_token, payload, {
        timeoutMs: ACTION_TIMEOUT_MS,
      });
      await afterDelivery({ origin: 'scene_action', delivered: true, notification });
      return { delivered: true, message_id: sent.id, error: '' };
    } catch (err) {
      logger.warn(`Scene notification not delivered to Gotify: ${err.message}`);
      await afterDelivery({ origin: 'scene_action', delivered: false, error: err, notification });
      return { delivered: false, message_id: 0, error: errorText(err, config.language) };
    }
  });

  gladys.onAction(ACTION_KEY, () => testConnection());

  gladys.onWidgetGet(WIDGET_KEY, async ({ language }) => {
    await loaded;
    return buildWidgetContent(
      {
        server: history.server,
        configured: client !== null,
        today: history.today(),
        recent: history.data.recent,
      },
      language,
    );
  });

  gladys.onWidgetAction(WIDGET_KEY, async (actionKey) => {
    if (actionKey !== TEST_ACTION) {
      throw new Error(`Unknown widget action "${actionKey}"`);
    }
    const report = await testConnection();
    // A toast holds 200 characters.
    return each(report, (text) => (text.length > 200 ? `${text.slice(0, 199)}…` : text));
  });

  gladys.onConfigUpdated((raw) => applyConfig(raw));

  gladys.on('connected', () => {
    lastStatus = null; // a new connection: publish the status again
    return applyConfig(gladys.config).catch((err) =>
      logger.error('Cannot apply the configuration', err),
    );
  });

  return {
    check,
    history,
    get config() {
      return config;
    },
    async stop() {
      stopped = true;
      generation += 1;
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      await checking;
      await history.flush();
    },
  };
}
