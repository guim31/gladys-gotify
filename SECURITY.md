# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the shared application token (integration configuration) and the
  application token of each user ("My account"). Gladys stores them and hands
  them to the integration; the integration keeps them in memory only, sends
  them to the configured Gotify server in the `X-Gotify-Key` header, and never
  logs them nor writes them to disk.
- **`/data`**: `gotify-state.json` holds the last known state of the server
  (online / offline, version, a hash of its address), today's delivery counters
  and the last notifications sent by scenes (title and text). No token, no
  address, and never the messages Gladys sends to one user.
- **Network**: outgoing HTTP(S) requests to the Gotify server address typed in
  the configuration only. Certificates are verified unless "Accept a
  self-signed certificate" is ticked. Nothing listens for incoming connections.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Gotify itself (see the [Gotify project](https://github.com/gotify/server)).
