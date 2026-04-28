#!/usr/bin/env node
/**
 * Cross-checks the en.ts and zh.ts locale bundles for missing or extra
 * keys. Exits non-zero if there's any drift. Run as `node scripts/check-i18n.mjs`.
 *
 * We deliberately don't try to evaluate the modules — we walk the source
 * with a tiny brace-matcher so this stays dependency-free and CI-cheap.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const en = readFileSync(path.join(root, 'src/locales/en.ts'), 'utf8')
const zh = readFileSync(path.join(root, 'src/locales/zh.ts'), 'utf8')

/** Walk the AST-ish structure and collect dotted key paths ('settings.application'). */
function collectKeys(source) {
  const keys = new Set()
  // Trim down to the body of the exported object literal.
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end < 0) {
    throw new Error('locale file missing top-level object')
  }
  const body = source.slice(start, end + 1)

  const stack = []
  let i = 0
  while (i < body.length) {
    const ch = body[i]
    if (ch === '/' && body[i + 1] === '/') {
      // Skip line comment
      while (i < body.length && body[i] !== '\n') i++
      continue
    }
    if (ch === '/' && body[i + 1] === '*') {
      i += 2
      while (i < body.length - 1 && !(body[i] === '*' && body[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch
      i++
      while (i < body.length && body[i] !== q) {
        if (body[i] === '\\') i += 2
        else i++
      }
      i++
      continue
    }
    if (ch === '{') {
      stack.push({ keyPending: stack.at(-1)?.keyPending ?? null })
      i++
      continue
    }
    if (ch === '}') {
      stack.pop()
      i++
      continue
    }
    // Identify "<ident>:" pattern at the start of a property.
    const idMatch = body.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/)
    if (idMatch) {
      const name = idMatch[1]
      const path = [...stack.map((s) => s.keyPending).filter(Boolean), name]
      keys.add(path.join('.'))
      // If the value is an object literal, the next non-whitespace is `{`.
      let j = i + idMatch[0].length
      while (j < body.length && /\s/.test(body[j])) j++
      if (body[j] === '{') {
        stack.push({ keyPending: name })
        i = j + 1
        continue
      }
      i = j
      continue
    }
    i++
  }
  return keys
}

const enKeys = collectKeys(en)
const zhKeys = collectKeys(zh)

const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k)).sort()
const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k)).sort()

const fail = missingInZh.length || missingInEn.length
if (missingInZh.length) {
  console.error(`Missing in zh.ts (${missingInZh.length}):`)
  for (const k of missingInZh) console.error(`  - ${k}`)
}
if (missingInEn.length) {
  console.error(`Missing in en.ts (${missingInEn.length}):`)
  for (const k of missingInEn) console.error(`  - ${k}`)
}
if (fail) {
  process.exit(1)
}
console.log(`i18n OK — ${enKeys.size} keys in sync`)
