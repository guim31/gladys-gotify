# Gotify fixtures

Real answers of a Gotify **3.1.1** server (`gotify/server` Docker image), captured
on 2026-10-13 in a throwaway container. The tokens were replaced by
`gtfya.EXAMPLE-application-token` and `gtfyc.EXAMPLE-client-token`; nothing else
was edited. Each file is `{ "status": <HTTP status>, "body": <JSON body> }`.

| File                          | Request                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| `health.json`                 | `GET /health`                                                              |
| `version.json`                | `GET /version`                                                             |
| `message-plain.json`          | `POST /message` `{ message }`: title = application name, priority 0        |
| `message-full.json`           | `POST /message` with title, priority 8, Markdown, click link and big image |
| `error-message-required.json` | `POST /message` with an empty `message`                                    |
| `error-unauthorized.json`     | `POST /message` with an unknown token                                      |
| `error-client-token.json`     | `POST /message` with a **client** token instead of an application token    |
| `error-not-found.json`        | `GET` of an unknown path                                                   |
