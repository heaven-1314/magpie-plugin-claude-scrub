// Runs cases.json the way magpie's gateway calls the middleware: one ctx per
// request, a fresh deep copy of each body, ctx.reject captured, undefined
// meaning "send it as it came". Contract mirrors
// magpie-community/plugins scripts/middleware.mjs.
import { readFileSync } from "node:fs"
import { expect, test } from "bun:test"
import * as mod from "./claude-scrub.middleware.js"

const ZW = "​"
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"))
const copy = (v) => JSON.parse(JSON.stringify(v))

function run(c) {
  let rejected
  const ctx = {
    protocol: "anthropic", model: "", stream: false, path: "", ...c.ctx,
    options: c.options ?? {}, state: {},
    reject(status, message) { rejected ??= { status, message } },
  }
  const out = mod.onRequest ? mod.onRequest(copy(c.request), ctx) : undefined
  return { rejected, body: out }
}

// 与中间件同口径的文本收集器,供 roundtrip 对比
function collect(req) {
  const texts = []
  if (typeof req.system === "string") texts.push(req.system)
  if (Array.isArray(req.system)) for (const b of req.system) if (b && typeof b.text === "string") texts.push(b.text)
  for (const m of req.messages ?? []) {
    if (typeof m?.content === "string") texts.push(m.content)
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (b && typeof b.text === "string") texts.push(b.text)
      for (const x of Array.isArray(b?.content) ? b.content : []) if (x && typeof x.text === "string") texts.push(x.text)
    }
  }
  return texts
}

for (const c of cases) {
  test(c.name, () => {
    const { rejected, body } = run(c)
    if (c.reject) {
      expect(rejected).toBeDefined()
      expect(rejected.status).toBe(c.reject.status)
      if (c.reject.message) expect(rejected.message).toContain(c.reject.message)
      return
    }
    expect(rejected).toBeUndefined()
    const sent = body === undefined ? copy(c.request) : body
    const all = collect(sent).join("\n")
    const original = collect(c.request).join("\n")
    switch (c.check) {
      case "words_scrambled_but_readable":
      case "nested_scrambled":
        expect(all).toContain(ZW)
        expect(all.split(ZW).join("")).toBe(original)   // 去零宽后逐字还原
        break
      case "billing_dropped":
        expect(all).not.toContain("billing-header")
        break
      case "custom_words_only":
        expect(all).toContain("Claude Code")            // 默认词未启用=原样
        expect(all.toLowerCase()).not.toContain("project-x")  // 自定义词已混淆
        break
      default:
        if (c.expect_request) expect(sent).toEqual(c.expect_request)
    }
  })
}
