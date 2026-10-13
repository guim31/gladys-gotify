# Gotify for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that sends the messages of Gladys through your own
[Gotify](https://gotify.net) server, the self-hosted push notification server:
the messages of your scenes, the answers of Gladys and its system messages
reach your phone, plus notifications with a title, a priority, a link and an
image from your scenes. Local network only, no cloud.

> **Developed without the hardware: feedback welcome.** The integration was
> tested against a real Gotify 3.1.1 server (the `gotify/server` Docker image),
> but not with the Gotify phone apps nor inside a real Gladys. Please report
> what works and what does not in the
> [issues](https://github.com/guim31/gladys-gotify/issues) or on the
> [Gladys forum](https://community.gladysassistant.com).

## Features

- **A Gladys notification channel** (send-only communication integration):
  every message Gladys sends to a user (the _Send Message_ scene action, the
  answers of Gladys, the system messages) goes to Gotify, as Markdown.
- **Per user**: each Gladys user fills in "My account" with the token of an
  application of their own Gotify account, or only picks a priority to use the
  shared token. A user who saved nothing receives nothing.
- **Scene action** _Send a Gotify notification_: title, message, priority
  (0–10), link opened on tap, image shown by the Android app. Outputs:
  delivered, Gotify message number, error.
- **Scene triggers**: _Gotify server offline_ (two failed checks 30 s apart),
  _Gotify server back online_, _Gotify notification not sent_ (filtered by
  reason and origin, at most once per reason every 15 minutes so it cannot
  loop).
- **Dashboard widget** _Gotify_: server state and version, notifications sent
  and failed today, the last scene notifications (never the messages sent to
  one user), a _Send a test_ button.
- **Configuration test**: checks the server and sends a test notification.
- Four languages (English, French, German, Spanish).

## Requirements

- Gladys Assistant **5.1.0** or later.
- A Gotify server reachable from Gladys on your network (tested with 3.1.1).
- An **application token** (Gotify web interface → **Apps** → **Create
  application**). A client token does not send messages and is detected.
- The Gotify Android app, or the Gotify web interface, to read the
  notifications. Gotify has no official iOS app.

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-gotify`. Fill in the server address and the
shared application token, click **Send a test notification**, then let each
user fill in "My account". The full documentation is in
[docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

- `POST /message` with the application token in the `X-Gotify-Key` header;
  `client::display` `text/markdown` when Markdown is on; `client::notification`
  `click.url` and `bigImageUrl` for the scene action. A priority left to
  "default" is not sent, so Gotify applies the default priority of the
  application.
- A health check every 5 minutes, without any token: `GET /version` (it is a
  Gotify) and `GET /health` (its database is fine). It drives the connection
  status of the Configuration screen, the widget and the online / offline
  triggers.
- Gladys waits 5 seconds for a message to be acknowledged: the request to
  Gotify gives up after 4 seconds.
- `/data/gotify-state.json` keeps the last known server state (so a restart
  neither repeats nor forgets a transition) and the statistics of the widget.
  No token and no address is stored there.

## Checked on a real server, and what was not

Checked against `gotify/server` 3.1.1 in a Docker container, the integration
running in the locked-down sandbox of Gladys (read-only root, all capabilities
dropped, 256 MB): sending with every option (title, priorities, Markdown, click
link, big image), a refused token, a client token in place of an application
token, an empty message, the server stopped then restarted, and the messages
read back through `GET /application/{id}/message`. The real answers are in
[test/fixtures/gotify/](test/fixtures/gotify/).

Not checked: how the phone apps display the notifications (the priority table
of the documentation comes from the source of the Gotify Android app), the
"My account" block and the scene editor in a real Gladys.

## Limitations

- Send only: Gotify has no replies, so you cannot talk to Gladys from Gotify.
- Gotify carries text only: the image of _Send a camera image_ is left out,
  with a line saying so.
- The messages of Gladys have no title of their own (Gotify shows the name of
  the application).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and an in-memory Gotify that
answers with the real fixtures; they never touch the network. See
[CLAUDE.md](CLAUDE.md) for the project rules.

## Credits

- [Gotify](https://github.com/gotify/server) (MIT): the REST API and its
  documentation. The priority levels of the documentation come from
  `NotificationSupport.kt` of [gotify/android](https://github.com/gotify/android)
  (MIT).
- The logo on the cover is the Gotify logo from
  [gotify/logo](https://github.com/gotify/logo), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the original Go
  gopher was designed by Renee French.
- [Pushover for Gladys](https://github.com/cicoub13/gladys-pushover) by
  cicoub13 (Apache-2.0) and [ntfy for Gladys](https://github.com/callemand/gladys-ntfy)
  by callemand: the shape of a send-only channel (`contact_schema`, the dropped
  camera image). No code was copied.
- The HTTP transport and the `/data` store come from
  [gladys-pihole](https://github.com/guim31/gladys-pihole); the tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled).
- Home Assistant has no core Gotify integration to start from.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the Gotify
project.

## License

Apache-2.0
