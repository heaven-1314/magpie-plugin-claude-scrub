// claude-scrub.middleware.js — magpie gateway middleware.
//
// Google's Antigravity answers Claude Code chats with a disguised 429
// ("Resource has been exhausted") whatever quota is left. What trips it is
// the Anthropic billing metadata block Claude Code puts first in `system`
//     x-anthropic-billing-header: cc_version=…; cc_entrypoint=sdk-cli; …
// which is billing bookkeeping for Anthropic, useless to any other upstream,
// and the surface the filter actually matches (ablation-tested 2026-10-12:
// drop the block → 200, keep it → 429 every time; headers, metadata.user_id,
// tools and the request path were all innocent).
//
// So this middleware drops those blocks, and as a second layer zero-width
// scrambles client-identity words in system and messages the way
// CLIProxyAPI's antigravity sensitive-words does: the text reads the same to
// the model, the filter no longer matches.
//
//   { "words":   ["Claude Agent SDK", "Claude Code"],   // second layer
//     "billing": ["x-anthropic-billing-header"],        // system blocks dropped
//     "probe":   false }                                 // liveness probe
//
// "words"/"billing" replace the defaults when given; "[]" disables a layer.
// "probe": true turns a user message of exactly "PROBE_CLAUDE_SCRUB" into a
// 418, proving the middleware is loaded and running.
//
// A hook that throws leaves the request as it was, so every step is written
// to touch nothing it doesn't recognize.

const ZW = "​"; // zero-width space

const defaultWords = ["Claude Agent SDK", "Claude Code"];
const defaultBilling = ["x-anthropic-billing-header"];

export function onRequest(body, ctx) {
  if (!body || typeof body !== "object") return
  const o = ctx.options && typeof ctx.options === "object" ? ctx.options : {}

  if (o.probe) {
    const msgs = body.messages
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : null
    if (last) {
      const t = typeof last.content === "string" ? last.content
        : Array.isArray(last.content) && last.content[0] && typeof last.content[0].text === "string"
          ? last.content[0].text : ""
      if (t === "PROBE_CLAUDE_SCRUB") return ctx.reject(418, "claude-scrub middleware alive")
    }
  }

  let changed = false

  // layer 1: drop the billing metadata blocks
  const billing = o.billing ?? defaultBilling
  if (Array.isArray(body.system) && Array.isArray(billing) && billing.length) {
    const kept = body.system.filter(b =>
      !(b && typeof b.text === "string" && billing.some(k => typeof k === "string" && k && b.text.includes(k))))
    if (kept.length !== body.system.length) { body.system = kept; changed = true }
  }

  // layer 2: zero-width scramble the identity words
  const words = o.words ?? defaultWords
  const re = Array.isArray(words) && words.length
    ? new RegExp("(" + words.filter(w => typeof w === "string" && w).map(escapeRe).join("|") + ")", "gi")
    : null
  if (re) {
    const hide = (t) => { const u = t.replace(re, (w) => w.split("").join(ZW)); if (u !== t) { changed = true; return u } return t }
    if (typeof body.system === "string") body.system = hide(body.system)
    else if (Array.isArray(body.system))
      for (const b of body.system) if (b && typeof b.text === "string") b.text = hide(b.text)
    if (Array.isArray(body.messages))
      for (const m of body.messages) {
        if (!m) continue
        if (typeof m.content === "string") m.content = hide(m.content)
        else if (Array.isArray(m.content))
          for (const b of m.content) {
            if (b && typeof b.text === "string") b.text = hide(b.text)
            if (b && Array.isArray(b.content))
              for (const c of b.content) if (c && typeof c.text === "string") c.text = hide(c.text)
          }
      }
  }

  return changed ? body : undefined
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
