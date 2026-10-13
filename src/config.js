// -----------------------------------------------------------------------------
// Integration configuration (the `config_schema` of the manifest) and the
// per-user "My account" values (`contact_schema`), normalized so the rest of
// the code never deals with `undefined`, strings typed with spaces or a
// priority out of range.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// "default" leaves the priority out of the request: Gotify then applies the
// default priority of the application (set in its web interface).
export const PRIORITY_DEFAULT = 'default';
// The values offered in the forms: one per notification level of the Gotify
// Android app (NotificationSupport.convertPriorityToChannel: < 1 minimal,
// 1-3 low, 4-7 normal, >= 8 high), plus the maximum.
export const PRIORITIES = [PRIORITY_DEFAULT, '0', '2', '5', '8', '10'];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js).
export const DEFAULT_CONFIG = {
  server_url: '',
  app_token: '',
  default_priority: PRIORITY_DEFAULT,
  markdown: true,
  allow_self_signed: false,
  language: 'fr',
};

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * A priority as Gotify takes it: an integer from 0 to 10, or null for "the
 * application default". Accepts the select values and plain numbers (a scene
 * variable), clamps what is out of range.
 * @param {unknown} value
 * @returns {number|null}
 */
export function parsePriority(value) {
  if (value === null || value === undefined || value === '' || value === PRIORITY_DEFAULT) {
    return null;
  }
  const number = Number(typeof value === 'string' ? value.trim().replace(',', '.') : value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(10, Math.max(0, Math.round(number)));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  return {
    server_url: trimmed(config.server_url),
    app_token: trimmed(config.app_token),
    default_priority: parsePriority(config.default_priority),
    markdown: config.markdown !== false,
    allow_self_signed: config.allow_self_signed === true,
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
  };
}

/**
 * The "My account" values of one user, as Gladys hands them to onSendMessage.
 * @param {Record<string, unknown>} [contact]
 * @returns {{ appToken: string, priority: number|null }}
 */
export function normalizeContact(contact = {}) {
  const values = contact ?? {};
  return {
    appToken: trimmed(values.app_token),
    priority: parsePriority(values.priority),
  };
}
