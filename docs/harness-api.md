# Glyphra harness integration

Glyphra discovers supported executables on `PATH` and records the resolved command, native protocol, and launch arguments. The frontend consumes one ACP-shaped session stream regardless of the transport underneath it.

## Built-in discovery

| Executable | Native entrypoint | Glyphra transport |
| --- | --- | --- |
| `codex` | `codex app-server --stdio` | Codex JSON-RPC → ACP timeline |
| `claude` | `claude -p --output-format stream-json` | Claude stream JSON → ACP timeline |
| `pi` | `pi -p --mode json` | Pi JSON events → ACP timeline |
| `opencode` | `opencode acp` | ACP passthrough |

Fresh installs use **Auto-detect installed harness**. A selected custom harness is stored locally and appears beside detected harnesses in the Agent composer.

## Native harness controls

For built-in harnesses, Glyphra reads the native catalog before starting a session. The composer exposes the models and reasoning efforts reported by the harness, plus context-window and permission controls when supported. Permissions are one atomic three-level choice:

| Glyphra mode | Codex | Claude Code |
| --- | --- | --- |
| Request approval | `on-request` + `user` reviewer + `workspace-write` | `manual` |
| Auto approve | `on-request` + official `auto_review` + `workspace-write` | `auto` |
| Full access | `never` + `danger-full-access` | `bypassPermissions` |

The selected Codex policy, reviewer, and sandbox are also sent on every `turn/start`, so changing permissions applies to the next turn without replacing the native thread. On Windows, Glyphra checks `windowsSandbox/readiness` and invokes Codex's official unelevated setup flow before creating a sandboxed thread. Full access does not initialize a sandbox.

Model and reasoning-effort changes on a live session use ACP `session/set_config_option` and take effect on the next turn without rebuilding the conversation. The Codex adapter forwards them as `turn/start` overrides on the existing thread. The Claude adapter resumes the existing native session and passes the updated `--model` and `--effort` flags.

Fast mode is capability-gated by the native model catalog. Codex uses the model's `fast` service tier on `thread/start`/`turn/start`. Claude Code exposes Fast for supported Opus models and receives a per-process `fastMode` setting, leaving the user's global CLI settings untouched. Fast can be changed between turns through the same ACP configuration flow.

Codex `thread/tokenUsage/updated` and Claude `result.modelUsage` are normalized to ACP `usage_update`. The composer displays the current context used and the model-reported total window. A 1M option remains disabled until the running CLI reports a context window of at least one million tokens; this prevents a requested override that the model silently caps from being presented as active.

When the harness uses its own CLI login, no Provider control is shown. The Provider control only appears for a selected API-key provider or for a custom HTTP harness that requires one.

Codex session creation is prewarmed as part of native catalog loading. A Windows named-pipe multiplexer keeps the app-server warm and lets the catalog, usage queries, and live threads share it. The prepared thread is adopted by the ACP bridge, reducing the submit-to-connected path to the bridge handshake rather than repeating skills and MCP discovery.

## Provider usage interface

The Tauri command `provider_usage(id)` returns a normalized `ProviderUsageSnapshot` containing `source`, `plan`, `windows`, credits, reset times, and a fetch timestamp.

- Codex CLI login calls native `account/rateLimits/read` and `account/usage/read`.
- Claude subscriptions call `claude -p /usage --output-format json` and normalize the session/week windows.
- OpenAI-compatible and Anthropic API providers issue a non-generation `GET /models` probe and normalize any request/token rate-limit headers. Standard model APIs do not guarantee a billing-balance field, so the snapshot says when the endpoint only confirms the key and exposes no quota headers.

The same normalized usage snapshot is available from the composer. CLI-login sessions use the synthetic backend targets `__codex_cli__` and `__claude_cli__`, so no Provider record is required just to inspect subscription usage.

## Custom protocols

Add custom harnesses under **Settings → Agent**.

### ACP (stdio)

The configured command must be an ACP agent over newline-delimited JSON on stdin/stdout. Glyphra launches it directly; stderr is reserved for diagnostics.

### Glyphra JSONL (stdio)

Glyphra keeps the command alive for the session and writes:

```json
{"type":"prompt","sessionId":"SESSION","prompt":"USER TEXT","cwd":"PROJECT PATH"}
{"type":"cancel","sessionId":"SESSION"}
```

The harness writes one event per line. Supported output events are:

```json
{"type":"message.delta","sessionId":"SESSION","delta":"partial text"}
{"type":"plan","sessionId":"SESSION","entries":[{"content":"step","status":"in_progress"}]}
{"type":"tool.start","sessionId":"SESSION","id":"CALL","title":"Read file","kind":"read","locations":[{"path":"FILE"}]}
{"type":"tool.end","sessionId":"SESSION","id":"CALL","output":"result"}
{"type":"done","sessionId":"SESSION","stopReason":"end_turn"}
{"type":"error","sessionId":"SESSION","message":"detail"}
```

`message` and `assistant` are accepted as aliases for `message.delta`; use `text` instead of `delta` with those aliases. A `tool.end` event with an `error` field is rendered as failed.

### Shell command

The command is launched once per prompt. Arguments are a JSON string array and may include `{prompt}` and `{cwd}` placeholders. If `{prompt}` is absent, Glyphra appends the prompt as the final argument. Stdout streams into the assistant message and a non-zero exit becomes a failed turn.

### HTTP APIs

Supported request formats:

- OpenAI Responses: `POST {endpoint}/responses`
- OpenAI Chat Completions: `POST {endpoint}/chat/completions`
- Anthropic Messages: `POST {endpoint}/messages`

If the endpoint already ends with the route, Glyphra does not append it again. Select a model Provider in the composer to inject `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` from the OS keyring. Conversation history is retained for later turns in the same live session.

All adapters reserve stdout for protocol data and forward child stderr to Glyphra's crash diagnostics.
