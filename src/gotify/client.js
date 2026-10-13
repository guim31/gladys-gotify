// -----------------------------------------------------------------------------
// Gotify REST API client: the three endpoints the integration needs.
//
//   GET  /health   no token: {"health":"green","database":"green"}
//   GET  /version  no token: {"version":"3.1.1","commit":"…","buildDate":"…"}
//   POST /message  application token in the X-Gotify-Key header:
//                  { message, title?, priority?, extras? } → the stored message
//
// Every failure becomes a GotifyError with a `kind` (ERROR_KINDS) the rest of
// the code translates for the user. Messages never carry the token: it only
// travels in a header, and the address is logged without its credentials.
// Real answers of a Gotify 3.1.1 server are in test/fixtures/gotify/.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = {
  NO_SERVER: 'no_server',
  INVALID_URL: 'invalid_url',
  NO_TOKEN: 'no_token',
  UNREACHABLE: 'unreachable',
  TLS: 'tls',
  REDIRECT: 'redirect',
  NOT_GOTIFY: 'not_gotify',
  UNAUTHORIZED: 'unauthorized',
  CLIENT_TOKEN: 'client_token',
  REJECTED: 'rejected',
  SERVER_ERROR: 'server_error',
};

// The kinds that say "the server cannot be reached", as opposed to "it
// answered no": they drive the online/offline state of the monitor.
export const UNREACHABLE_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TLS,
  ERROR_KINDS.REDIRECT,
  ERROR_KINDS.NOT_GOTIFY,
  ERROR_KINDS.SERVER_ERROR,
]);

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
  'EPROTO',
]);

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export class GotifyError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never a token)
   * @param {{ status?: number, cause?: unknown }} [details]
   */
  constructor(kind, message, { status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GotifyError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * The server address typed by the user, as a base URL: `http://` added when no
 * scheme is given, a path prefix kept (a Gotify served under /gotify behind a
 * reverse proxy), the trailing slash, query and fragment dropped.
 * @param {string} raw
 * @returns {URL}
 */
export function parseServerUrl(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    throw new GotifyError(ERROR_KINDS.NO_SERVER, 'No Gotify server address configured');
  }
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    throw new GotifyError(ERROR_KINDS.INVALID_URL, 'The Gotify server address is not a URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    throw new GotifyError(ERROR_KINDS.INVALID_URL, 'The Gotify server address must be http(s)');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

/** The address without credentials, for the logs. */
export function describeUrl(url) {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/** Shortens an error text coming from the server before it reaches a log or a toast. */
const shorten = (text, max = 200) =>
  typeof text === 'string' && text.length > max ? `${text.slice(0, max - 1)}…` : text;

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export class GotifyClient {
  /**
   * @param {object} options
   * @param {string} options.serverUrl the address typed by the user
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] replaced by the tests
   * @param {number} [options.timeoutMs]
   */
  constructor({ serverUrl, insecure = false, request = httpRequest, timeoutMs = 10_000 }) {
    this.base = parseServerUrl(serverUrl);
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  get description() {
    return describeUrl(this.base);
  }

  url(path) {
    const url = new URL(this.base.href);
    // A URL always keeps a pathname of at least "/": never send "//message".
    url.pathname = `${this.base.pathname.replace(/\/+$/, '')}${path}`;
    return url.href;
  }

  async call(method, path, { headers, json, timeoutMs = this.timeoutMs } = {}) {
    let response;
    try {
      response = await this.request(this.url(path), {
        method,
        headers,
        json,
        insecure: this.insecure,
        timeoutMs,
      });
    } catch (err) {
      const code = err?.code;
      if (TLS_CODES.has(code) || /certificate/i.test(err?.message ?? '')) {
        throw new GotifyError(ERROR_KINDS.TLS, `TLS certificate refused (${code ?? 'TLS'})`, {
          cause: err,
        });
      }
      const reason = NETWORK_CODES.has(code) ? code : (code ?? err?.message ?? 'network error');
      throw new GotifyError(ERROR_KINDS.UNREACHABLE, `Gotify does not answer (${reason})`, {
        cause: err,
      });
    }
    const { status } = response;
    const data = parseJson(response.body);
    if (status >= 300 && status < 400) {
      throw new GotifyError(ERROR_KINDS.REDIRECT, `The address redirects (HTTP ${status})`, {
        status,
      });
    }
    if (status >= 200 && status < 300) {
      if (data === undefined || data === null || typeof data !== 'object') {
        throw new GotifyError(ERROR_KINDS.NOT_GOTIFY, `Not a Gotify answer (HTTP ${status})`, {
          status,
        });
      }
      return data;
    }
    const description = shorten(data?.errorDescription ?? data?.error ?? `HTTP ${status}`);
    if (status === 401 || status === 403) {
      throw new GotifyError(ERROR_KINDS.UNAUTHORIZED, `Token refused: ${description}`, { status });
    }
    if (status === 400 && /appid is required/i.test(description)) {
      // A client token (gtfyc.…) is accepted, but only to send in the name of
      // an application chosen by id: the user pasted the wrong kind of token.
      throw new GotifyError(ERROR_KINDS.CLIENT_TOKEN, 'A client token was given', { status });
    }
    if (status === 404 && data?.errorCode === undefined) {
      throw new GotifyError(ERROR_KINDS.NOT_GOTIFY, `Not a Gotify server (HTTP 404)`, { status });
    }
    if (status >= 500) {
      throw new GotifyError(ERROR_KINDS.SERVER_ERROR, `Gotify error: ${description}`, { status });
    }
    throw new GotifyError(ERROR_KINDS.REJECTED, `Gotify refused the request: ${description}`, {
      status,
    });
  }

  /**
   * Is the server up? GET /version (also proves it is a Gotify) then
   * GET /health (the database state).
   * @returns {Promise<{ version: string, health: string, database: string }>}
   */
  async check() {
    const version = await this.call('GET', '/version');
    if (typeof version.version !== 'string') {
      throw new GotifyError(ERROR_KINDS.NOT_GOTIFY, 'No Gotify version at this address');
    }
    const health = await this.call('GET', '/health');
    if (health.health !== 'green' || health.database !== 'green') {
      throw new GotifyError(
        ERROR_KINDS.SERVER_ERROR,
        `Gotify is not healthy (health ${health.health}, database ${health.database})`,
      );
    }
    // Bounded: the version is stored, shown in the widget and sent with a trigger.
    return {
      version: version.version.slice(0, 40),
      health: health.health,
      database: health.database,
    };
  }

  /**
   * Sends one message with an application token.
   * @param {string} token
   * @param {{ message: string, title?: string, priority?: number, extras?: object }} payload
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<{ id: number, appid: number, priority: number, date: string }>}
   */
  async send(token, payload, { timeoutMs } = {}) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new GotifyError(ERROR_KINDS.NO_TOKEN, 'No Gotify application token');
    }
    const message = await this.call('POST', '/message', {
      headers: { 'X-Gotify-Key': token.trim() },
      json: payload,
      timeoutMs,
    });
    if (typeof message.id !== 'number') {
      throw new GotifyError(ERROR_KINDS.NOT_GOTIFY, 'Gotify did not return the message');
    }
    return message;
  }
}

// The four reasons a delivery fails, as the "Delivery failed" trigger and the
// widget name them: the stable values of the trigger filter.
export const FAILURE_REASONS = ['unreachable', 'token', 'configuration', 'rejected'];

/**
 * The failure reason of an error kind (anything unknown is "rejected").
 * @param {string|undefined} kind
 * @returns {string} one of FAILURE_REASONS
 */
export function failureReason(kind) {
  if (UNREACHABLE_KINDS.has(kind)) {
    return 'unreachable';
  }
  if ([ERROR_KINDS.NO_TOKEN, ERROR_KINDS.UNAUTHORIZED, ERROR_KINDS.CLIENT_TOKEN].includes(kind)) {
    return 'token';
  }
  if ([ERROR_KINDS.NO_SERVER, ERROR_KINDS.INVALID_URL].includes(kind)) {
    return 'configuration';
  }
  return 'rejected';
}
