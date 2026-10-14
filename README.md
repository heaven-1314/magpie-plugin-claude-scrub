# magpie-plugin-claude-scrub

[magpie](https://usemagpie.ai) gateway middleware that lets **Claude Code chats go through a Google Antigravity account** instead of dying on a disguised 429.

## The problem

Route Claude Code at an Antigravity (Google) provider and every chat with the real client comes back:

```
429 Resource has been exhausted (e.g. check quota)
```

It is not a quota: the same account serves small requests happily, and waiting never helps. What trips Google's filter is **the Anthropic billing-metadata block Claude Code puts first in `system`**:

```
x-anthropic-billing-header: cc_version=2.1.296…; cc_entrypoint=sdk-cli; …
```

Ablation-tested (2026-10-12): drop that one block → 200, keep it → 429 every time; request headers, `metadata.user_id`, the tools array and the URL path were all innocent. The block is billing bookkeeping for Anthropic's own endpoints — useless to any other upstream, so nothing of value is lost by dropping it at the gateway.

## What it does

**By default exactly one thing**: system blocks containing a `billing` marker (default `x-anthropic-billing-header`) are dropped in `onRequest`, before the request leaves the gateway. The block carries the whole fix — nothing else in the request is touched.

### Optional: system-only identity scramble

A second layer can zero-width scramble client-identity words (CLIProxyAPI `antigravity.sensitive-words` style): the model still reads the words, a substring filter no longer matches them. It is **off by default**, and when enabled it rewrites **`system` only — never `messages` or `tool_result`**.

Why: v0.1 scrambled message text too, including tool results — the file contents the model has read. The model then copies those zero-width-laced strings into `Edit` old/new strings and into files it writes, silently breaking exact matches and poisoning user files. That critique (upstream registry PR #93, closed 2026-10-12) is correct, and the billing block never needed the help.

Matching is case-insensitive. A hook that throws leaves the request as it was, and every step touches only shapes it recognizes.

For your own subscription accounts, one gateway, one user.

## Install

```sh
magpie plugin add github:heaven-1314/magpie-plugin-claude-scrub
```

Or from a checkout: `magpie plugin add ./claude-scrub.middleware.js`. Edits to the file hot-reload within a second, no restart.

## Options

```json
{ "words":   [],
  "billing": ["x-anthropic-billing-header"],
  "probe":   false }
```

- **`billing`.** Markers of system blocks to drop. Given, it replaces the default; `[]` disables the layer.
- **`words`.** Opt-in scramble list, applied to `system` only. Given, it enables the layer; `[]` (the default) keeps it off.
- **`probe`.** When `true`, a user message of exactly `PROBE_CLAUDE_SCRUB` is answered with a 418, proving the middleware is loaded and running (handy while setting things up).

Set them under **Plugins › Installed › Options**, or `magpie plugin options claude-scrub '<json>'`.

## Verify

```sh
claude -p "Reply with the single word: ok" --model haiku   # with haiku on the Antigravity model
```

Before: `API Error: 400 … Resource has been exhausted`. After: `ok`.

## Scope

Request bodies are handled in the agent's own protocol as the gateway hands them over: Anthropic (string or text-block system, message strings and content blocks) and Chat. Claude Code speaks Anthropic; no Responses/Gemini-native system locations are touched.

## License

MIT
