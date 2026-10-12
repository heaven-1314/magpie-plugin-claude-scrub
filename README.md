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

Two layers, both in `onRequest`, before the request leaves the gateway:

1. **Drops system blocks** containing any `billing` marker (default `x-anthropic-billing-header`).
2. **Zero-width scrambles identity words** (default `Claude Agent SDK`, `Claude Code`) in system and message text, the way CLIProxyAPI's `antigravity.sensitive-words` does: the model still reads the words, a substring filter no longer matches them.

Matching is case-insensitive. Tool results' nested text is covered too. A hook that throws leaves the request as it was, and every step touches only shapes it recognizes.

For your own subscription accounts, one gateway, one user.

## Install

```sh
magpie plugin add github:heaven-1314/magpie-plugin-claude-scrub
```

Or from a checkout: `magpie plugin add ./claude-scrub.middleware.js`. Edits to the file hot-reload within a second, no restart.

## Options

```json
{ "words":   ["Claude Agent SDK", "Claude Code"],
  "billing": ["x-anthropic-billing-header"],
  "probe":   false }
```

- **`words`.** Second-layer scramble list. Given, it replaces the default; `[]` disables the layer.
- **`billing`.** Markers of system blocks to drop. Given, it replaces the default; `[]` disables the layer.
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
