# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gotify as a Gladys notification channel: every message Gladys sends to a
  user (the "Send Message" scene action, the answers of Gladys, its system
  messages) reaches Gotify, formatted as Markdown.
- "My account" for each Gladys user: the token of an application of their own
  Gotify account and their priority, or the shared token of the integration.
- Scene action "Send a Gotify notification" with title, priority, link opened
  on tap and image (Android), returning whether it was sent, the Gotify message
  number and the error.
- Scene triggers "Gotify server offline", "Gotify server back online" and
  "Gotify notification not sent" (filtered by reason and origin).
- Dashboard widget "Gotify": server state, notifications sent and failed
  today, the last scene notifications, and a test button.
- "Send a test notification" in the configuration, and a connection status
  that explains what to fix (address, certificate, token, client token…).
- English, French, German and Spanish, documentation included.

[Unreleased]: https://github.com/guim31/gladys-gotify/commits/main
