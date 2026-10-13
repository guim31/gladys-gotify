// -----------------------------------------------------------------------------
// What the widget shows and what survives a restart (src/store.js):
//
// - the last known state of the server (online / offline, its version), so a
//   restart neither forgets nor re-announces a transition;
// - today's delivery counters (sent / failed), reset at local midnight (the
//   supervisor injects TZ, the time zone of Gladys);
// - the last notifications sent by SCENES only. The messages Gladys sends to
//   one user (onSendMessage) are counted but never listed: the widget is seen
//   by the whole household, a personal message stays personal.
//
// No token, no address is ever stored here.
// -----------------------------------------------------------------------------

export const MAX_RECENT = 8;
export const MAX_RECENT_TEXT = 500;

export const SERVER_STATES = {
  UNKNOWN: 'unknown',
  ONLINE: 'online',
  OFFLINE: 'offline',
};

/** The local day of a date, YYYY-MM-DD, in the time zone of the process. */
export function localDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const shorten = (text, max) => {
  const characters = Array.from(text ?? '');
  return characters.length > max ? `${characters.slice(0, max - 1).join('')}…` : (text ?? '');
};

export class History {
  /**
   * @param {object} options
   * @param {{ load(): Promise<object>, save(data: object): Promise<void>, flush(): Promise<void> }} options.store
   * @param {() => Date} [options.now]
   */
  constructor({ store, now = () => new Date() }) {
    this.store = store;
    this.now = now;
    this.data = History.empty();
  }

  static empty() {
    return {
      server: { state: SERVER_STATES.UNKNOWN, address: null, version: null, since: null },
      day: null,
      sent: 0,
      failed: 0,
      lastError: null,
      recent: [],
    };
  }

  async load() {
    const saved = await this.store.load();
    const empty = History.empty();
    this.data = {
      ...empty,
      ...saved,
      server: { ...empty.server, ...(saved.server ?? {}) },
      recent: Array.isArray(saved.recent) ? saved.recent.slice(0, MAX_RECENT) : [],
    };
    return this.data;
  }

  save() {
    return this.store.save(structuredClone(this.data));
  }

  flush() {
    return this.store.flush();
  }

  /** Today's counters, reset when the local day changed. */
  today() {
    const day = localDay(this.now());
    if (this.data.day !== day) {
      this.data.day = day;
      this.data.sent = 0;
      this.data.failed = 0;
      this.data.lastError = null;
    }
    return { sent: this.data.sent, failed: this.data.failed, lastError: this.data.lastError };
  }

  get server() {
    return this.data.server;
  }

  /**
   * Records a new server state.
   * @param {object} change
   * @param {string} change.state one of SERVER_STATES
   * @param {string|null} [change.address] the server it is about (a hash, see app.js)
   * @param {string|null} [change.version]
   * @returns {string} the previous state
   */
  setServer({ state, address = this.data.server.address, version = this.data.server.version }) {
    const previous = this.data.server.state;
    const changed =
      previous !== state ||
      this.data.server.address !== address ||
      this.data.server.version !== version;
    if (changed) {
      this.data.server = {
        state,
        address,
        version,
        since: previous === state ? this.data.server.since : this.now().toISOString(),
      };
      this.save();
    }
    return previous;
  }

  /**
   * Records one delivery attempt.
   * @param {object} entry
   * @param {'gladys_message'|'scene_action'} entry.origin
   * @param {boolean} entry.delivered
   * @param {string} [entry.kind] the error kind when not delivered
   * @param {{ title?: string, message: string, priority?: number }} [entry.notification] listed for scene actions only
   */
  record({ origin, delivered, kind, notification }) {
    this.today();
    const at = this.now().toISOString();
    if (delivered) {
      this.data.sent += 1;
    } else {
      this.data.failed += 1;
      this.data.lastError = { kind: kind ?? 'unknown', at };
    }
    if (origin === 'scene_action' && notification) {
      this.data.recent = [
        {
          title: shorten(notification.title ?? '', 120),
          message: shorten(notification.message, MAX_RECENT_TEXT),
          priority: notification.priority ?? null,
          delivered,
          at,
        },
        ...this.data.recent,
      ].slice(0, MAX_RECENT);
    }
    this.save();
  }
}
