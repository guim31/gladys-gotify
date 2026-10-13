// -----------------------------------------------------------------------------
// Gladys message / scene action → Gotify message (the body of POST /message).
// Pure functions, no I/O.
//
// - Gladys messages are Markdown (the brain and the AI write it): sent with
//   `client::display` `text/markdown` so the Gotify apps render it, unless
//   the user turned Markdown off.
// - Gotify carries no attachment: the image of the "Send a camera image"
//   scene action is left out, and a line says so instead of losing the
//   message.
// - No title on Gladys messages: Gotify then shows the application name.
// - A priority left to "default" is not sent: Gotify applies the default
//   priority of the application.
// -----------------------------------------------------------------------------

import { parsePriority } from '../config.js';
import { IMAGE_DROPPED, pick } from '../texts.js';

export const MAX_TITLE_LENGTH = 250;

const MARKDOWN = { 'client::display': { contentType: 'text/markdown' } };

/** A message the user typed wrong (a scene action field): shown as is. */
export class InvalidMessageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidMessageError';
  }
}

const asText = (value) =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

function withOptionalFields(payload, { title, priority, extras }) {
  const result = { ...payload };
  if (title) {
    result.title =
      Array.from(title).length > MAX_TITLE_LENGTH
        ? `${Array.from(title)
            .slice(0, MAX_TITLE_LENGTH - 1)
            .join('')}…`
        : title;
  }
  if (priority !== null && priority !== undefined) {
    result.priority = priority;
  }
  if (extras && Object.keys(extras).length > 0) {
    result.extras = extras;
  }
  return result;
}

/**
 * The Gotify message for a message Gladys sends to a user (onSendMessage).
 * @param {{ text?: unknown, file?: unknown }} gladysMessage
 * @param {{ priority: number|null, markdown: boolean, language: string }} options
 * @returns {{ message: string, priority?: number, extras?: object }}
 */
export function fromGladysMessage(gladysMessage, { priority, markdown, language }) {
  const { text, file } = gladysMessage ?? {};
  let body = asText(text);
  if (file) {
    const note = pick(IMAGE_DROPPED, language);
    const line = markdown ? `_${note}_` : note;
    body = body === '' ? line : `${body}\n\n${line}`;
  }
  if (body === '') {
    throw new InvalidMessageError('Empty message: nothing to send to Gotify');
  }
  return withOptionalFields(
    { message: body },
    { priority, extras: markdown ? { ...MARKDOWN } : undefined },
  );
}

/** An http(s) URL, or undefined when the field is empty. */
function parseLink(value, fieldName) {
  const text = asText(value);
  if (text === '') {
    return undefined;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new InvalidMessageError(`${fieldName}: not a URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new InvalidMessageError(`${fieldName}: only http:// and https:// links are allowed`);
  }
  return url.href;
}

/**
 * The Gotify message of the "Send a Gotify notification" scene action.
 * @param {Record<string, unknown>} fields the resolved scene action fields
 * @param {{ default_priority: number|null, markdown: boolean }} config
 * @returns {{ message: string, title?: string, priority?: number, extras?: object }}
 */
export function fromSceneAction(fields, config) {
  const message = asText(fields?.message);
  if (message === '') {
    throw new InvalidMessageError('message: the text of the notification is empty');
  }
  const markdown = typeof fields?.markdown === 'boolean' ? fields.markdown : config.markdown;
  const clickUrl = parseLink(fields?.url, 'url');
  const imageUrl = parseLink(fields?.image_url, 'image_url');
  const extras = markdown ? { ...MARKDOWN } : {};
  if (clickUrl || imageUrl) {
    extras['client::notification'] = {
      ...(clickUrl ? { click: { url: clickUrl } } : {}),
      ...(imageUrl ? { bigImageUrl: imageUrl } : {}),
    };
  }
  const priority = parsePriority(fields?.priority) ?? config.default_priority;
  return withOptionalFields({ message }, { title: asText(fields?.title), priority, extras });
}
