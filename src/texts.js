// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, the "Test the connection" report, the errors of the scene
// action, the line replacing a dropped image. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';
import { ERROR_KINDS } from './gotify/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** Applies `render` to each language of a table of functions. */
export const each = (table, render) =>
  Object.fromEntries(Object.entries(table).map(([lang, value]) => [lang, render(value, lang)]));

// Appended to a Gladys message whose camera image could not follow.
export const IMAGE_DROPPED = {
  en: 'Image not sent: Gotify does not carry attachments.',
  fr: 'Image non transmise : Gotify ne transporte pas de pièce jointe.',
  de: 'Bild nicht gesendet: Gotify überträgt keine Anhänge.',
  es: 'Imagen no enviada: Gotify no admite archivos adjuntos.',
};

// One short explanation per error kind (src/gotify/client.js), plus the
// invalid scene action fields.
export const ERROR_TEXT = {
  [ERROR_KINDS.NO_SERVER]: {
    en: 'enter the address of your Gotify server in the configuration',
    fr: "saisissez l'adresse de votre serveur Gotify dans la configuration",
    de: 'gib die Adresse deines Gotify-Servers in der Konfiguration ein',
    es: 'introduzca la dirección de su servidor Gotify en la configuración',
  },
  [ERROR_KINDS.INVALID_URL]: {
    en: 'address not understood, e.g. http://192.168.1.10:8080',
    fr: 'adresse incomprise, ex. http://192.168.1.10:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10:8080',
    es: 'dirección no válida, p. ej. http://192.168.1.10:8080',
  },
  [ERROR_KINDS.NO_TOKEN]: {
    en: 'no application token: fill one in the configuration or in "My account"',
    fr: "aucun jeton d'application : renseignez-en un dans la configuration ou « Mon compte »",
    de: 'kein App-Token: Trag eines in der Konfiguration oder unter „Mein Konto“ ein',
    es: 'ningún token de aplicación: indique uno en la configuración o en «Mi cuenta»',
  },
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the Gotify server does not answer',
    fr: 'le serveur Gotify ne répond pas',
    de: 'der Gotify-Server antwortet nicht',
    es: 'el servidor Gotify no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept a self-signed certificate"',
    fr: 'certificat refusé : cochez « Accepter un certificat auto-signé »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsigniertes Zertifikat akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar un certificado autofirmado»',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.NOT_GOTIFY]: {
    en: 'no Gotify server at this address',
    fr: 'aucun serveur Gotify à cette adresse',
    de: 'kein Gotify-Server unter dieser Adresse',
    es: 'no hay ningún servidor Gotify en esta dirección',
  },
  [ERROR_KINDS.UNAUTHORIZED]: {
    en: 'application token refused by Gotify',
    fr: "jeton d'application refusé par Gotify",
    de: 'App-Token von Gotify abgelehnt',
    es: 'Gotify ha rechazado el token de aplicación',
  },
  [ERROR_KINDS.CLIENT_TOKEN]: {
    en: 'this is a client token: give an application token (Apps tab)',
    fr: "c'est un jeton client : donnez un jeton d'application (onglet Apps)",
    de: 'das ist ein Client-Token: Gib ein App-Token an (Reiter Apps)',
    es: 'es un token de cliente: indique un token de aplicación (pestaña Apps)',
  },
  [ERROR_KINDS.REJECTED]: {
    en: 'Gotify refused the message, see the logs',
    fr: 'Gotify a refusé le message, voir les logs',
    de: 'Gotify hat die Nachricht abgelehnt, sieh in den Protokollen nach',
    es: 'Gotify ha rechazado el mensaje, consulte los registros',
  },
  [ERROR_KINDS.SERVER_ERROR]: {
    en: 'Gotify answered with an error, see its logs',
    fr: 'Gotify a répondu par une erreur, voir ses logs',
    de: 'Gotify hat mit einem Fehler geantwortet, sieh in seinen Protokollen nach',
    es: 'Gotify ha respondido con un error, consulte sus registros',
  },
  invalid: {
    en: 'invalid notification, see the scene logs',
    fr: 'notification invalide, voir les logs de la scène',
    de: 'ungültige Benachrichtigung, sieh in den Protokollen der Szene nach',
    es: 'notificación no válida, consulte los registros de la escena',
  },
  unknown: {
    en: 'unexpected error, see the logs',
    fr: 'erreur inattendue, voir les logs',
    de: 'unerwarteter Fehler, sieh in den Protokollen nach',
    es: 'error inesperado, consulte los registros',
  },
};

/** The error text of any error, in one language. */
export function errorText(err, language) {
  const kind = err?.name === 'InvalidMessageError' ? 'invalid' : err?.kind;
  return pick(ERROR_TEXT[kind] ?? ERROR_TEXT.unknown, language);
}

/** The same, as a multi-language object (connection status, action reports). */
export function errorTexts(err) {
  return Object.fromEntries(LANGUAGES.map((lang) => [lang, errorText(err, lang)]));
}

// The "Test the connection" report and the test notification itself.
export const REPORT_TEXT = {
  en: {
    reachable: (version) => `Gotify ${version} answers.`,
    sent: (id) => `Test notification sent (message #${id}).`,
    noToken: 'No shared application token: no test notification sent.',
    failed: (reason) => `Test notification not sent: ${reason}.`,
    unreachable: (reason) => `Gotify cannot be reached: ${reason}.`,
    title: 'Gladys test',
    message: 'Gladys can send you notifications through Gotify.',
  },
  fr: {
    reachable: (version) => `Gotify ${version} répond.`,
    sent: (id) => `Notification de test envoyée (message n° ${id}).`,
    noToken: "Pas de jeton d'application partagé : aucune notification de test envoyée.",
    failed: (reason) => `Notification de test non envoyée : ${reason}.`,
    unreachable: (reason) => `Gotify est injoignable : ${reason}.`,
    title: 'Test de Gladys',
    message: 'Gladys peut vous envoyer des notifications par Gotify.',
  },
  de: {
    reachable: (version) => `Gotify ${version} antwortet.`,
    sent: (id) => `Testbenachrichtigung gesendet (Nachricht Nr. ${id}).`,
    noToken: 'Kein gemeinsames App-Token: keine Testbenachrichtigung gesendet.',
    failed: (reason) => `Testbenachrichtigung nicht gesendet: ${reason}.`,
    unreachable: (reason) => `Gotify ist nicht erreichbar: ${reason}.`,
    title: 'Gladys-Test',
    message: 'Gladys kann dir Benachrichtigungen über Gotify senden.',
  },
  es: {
    reachable: (version) => `Gotify ${version} responde.`,
    sent: (id) => `Notificación de prueba enviada (mensaje n.º ${id}).`,
    noToken: 'Ningún token de aplicación compartido: no se ha enviado la notificación de prueba.',
    failed: (reason) => `Notificación de prueba no enviada: ${reason}.`,
    unreachable: (reason) => `No se puede contactar con Gotify: ${reason}.`,
    title: 'Prueba de Gladys',
    message: 'Gladys puede enviarle notificaciones a través de Gotify.',
  },
};
