import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const brandDir = path.join(root, 'assets', 'brand')
const readmeDir = path.join(root, 'assets', 'readme')
const publicDir = path.join(root, 'public')
const tempDir = path.join(root, '.asset-render')
const tauriIconDir = path.join(root, 'src-tauri', 'icons')
const chrome =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

mkdirSync(brandDir, { recursive: true })
mkdirSync(readmeDir, { recursive: true })
mkdirSync(publicDir, { recursive: true })
mkdirSync(tempDir, { recursive: true })

const appIconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="nativeBase" x1="128" y1="92" x2="914" y2="930" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F3E99A"/>
      <stop offset="0.42" stop-color="#B8D99B"/>
      <stop offset="0.72" stop-color="#7CCBBE"/>
      <stop offset="1" stop-color="#5AB8D5"/>
    </linearGradient>
    <radialGradient id="sunWash" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(250 210) rotate(52) scale(510)">
      <stop stop-color="#FFF6B5" stop-opacity="0.72"/>
      <stop offset="0.62" stop-color="#FFF6B5" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#FFF6B5" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="aquaWash" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(820 780) rotate(38) scale(520)">
      <stop stop-color="#38BDF8" stop-opacity="0.42"/>
      <stop offset="0.58" stop-color="#38BDF8" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#38BDF8" stop-opacity="0"/>
    </radialGradient>
    <filter id="nativeShadow" x="84" y="96" width="856" height="856" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="30" stdDeviation="34" flood-color="#15352E" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect width="1024" height="1024" rx="230" fill="url(#nativeBase)"/>
  <rect width="1024" height="1024" rx="230" fill="url(#sunWash)"/>
  <rect width="1024" height="1024" rx="230" fill="url(#aquaWash)"/>
  <rect x="35" y="35" width="954" height="954" rx="207" stroke="#FFF8C7" stroke-opacity="0.34" stroke-width="2"/>
  <g id="cpa-native-mark" filter="url(#nativeShadow)">
    <path id="cpa-diamond" d="M512 150L874 512L512 874L150 512L512 150Z" fill="#F5EBA8" fill-opacity="0.13" stroke="#1F2A24" stroke-width="34" stroke-linejoin="round"/>
    <g id="cpa-knot" stroke="#1F2A24" stroke-linecap="round" stroke-linejoin="round">
      <path d="M512 298C624 374 680 446 680 512C680 578 624 650 512 726C400 650 344 578 344 512C344 446 400 374 512 298Z" stroke-width="40"/>
      <path d="M298 512C374 400 446 344 512 344C578 344 650 400 726 512C650 624 578 680 512 680C446 680 374 624 298 512Z" stroke-width="40"/>
      <path d="M404 404C476 332 548 332 620 404C692 476 692 548 620 620C548 692 476 692 404 620C332 548 332 476 404 404Z" stroke-width="31"/>
      <path d="M446 382C494 430 530 466 512 512C494 558 530 594 578 642" stroke="#F6EDA6" stroke-width="18"/>
      <path d="M382 578C430 530 466 494 512 512C558 530 594 494 642 446" stroke="#F6EDA6" stroke-width="18"/>
      <circle cx="512" cy="512" r="48" fill="#F6EDA6" stroke-width="26"/>
      <circle cx="512" cy="512" r="18" fill="#1F2A24" stroke="none"/>
    </g>
  </g>
</svg>
`

writeFileSync(path.join(brandDir, 'cpa-desktop-icon.svg'), appIconSvg)

function htmlShell(body, { width, height, transparent = false } = {}) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${width}, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
    body {
      font-family: "DM Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: ${transparent ? 'transparent' : '#080d14'};
      color: #f8fafc;
    }
    .mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
</head>
<body>${body}</body>
</html>`
}

function renderHtml(name, html, width, height, outFile, { transparent = false } = {}) {
  const htmlFile = path.join(tempDir, `${name}.html`)
  writeFileSync(htmlFile, html)
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${outFile}`,
  ]
  if (transparent) args.push('--default-background-color=00000000')
  args.push(pathToFileURL(htmlFile).href)
  execFileSync(chrome, args, { stdio: 'inherit' })
}

function imagePage(svg, width, height, transparent = false) {
  return htmlShell(`<div style="width:${width}px;height:${height}px">${svg}</div>`, {
    width,
    height,
    transparent,
  })
}

function sizedSvg(svg, size) {
  return svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)
}

renderHtml(
  'app-icon',
  imagePage(appIconSvg, 1024, 1024, true),
  1024,
  1024,
  path.join(brandDir, 'cpa-desktop-icon.png'),
  { transparent: true },
)
renderHtml(
  'favicon',
  imagePage(sizedSvg(appIconSvg, 32), 32, 32, true),
  32,
  32,
  path.join(publicDir, 'favicon.png'),
  { transparent: true },
)
const markSvg = appIconSvg
  .replace('width="1024" height="1024"', 'width="96" height="96"')
  .replace('viewBox="0 0 1024 1024"', 'viewBox="0 0 1024 1024"')

const commonCss = `
  :root {
    --bg: #080d14;
    --surface: #0d1420;
    --surface-2: #111a29;
    --border: rgba(148, 163, 184, 0.16);
    --muted: #7d8aa0;
    --text: #f8fafc;
    --soft: #cbd5e1;
    --accent: #f59e0b;
    --accent-soft: rgba(245, 158, 11, 0.14);
    --green: #22c55e;
    --red: #ef4444;
  }
  .screen {
    position: relative;
    width: 100%;
    height: 100%;
    background:
      radial-gradient(circle at 18% 14%, rgba(245, 158, 11, 0.16), transparent 34%),
      radial-gradient(circle at 82% 22%, rgba(56, 189, 248, 0.10), transparent 36%),
      linear-gradient(135deg, #070b12 0%, #0b101a 48%, #05070b 100%);
    overflow: hidden;
  }
  .window {
    position: absolute;
    inset: 42px;
    display: flex;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 18px;
    background: #0a1019;
    box-shadow: 0 34px 95px rgba(0, 0, 0, 0.45);
  }
  .sidebar {
    width: 52px;
    background: #0f1722;
    border-right: 1px solid rgba(148, 163, 184, 0.12);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 15px 6px;
    gap: 11px;
  }
  .mini-logo {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: rgba(245, 158, 11, 0.12);
    display: grid;
    place-items: center;
  }
  .mini-logo svg { width: 24px; height: 24px; border-radius: 7px; }
  .nav {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: #7d8aa0;
  }
  .nav.active { color: var(--accent); background: var(--accent-soft); }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: #080d14;
  }
  .content {
    flex: 1;
    min-height: 0;
    padding: 30px;
  }
  .statusbar {
    height: 34px;
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 18px;
    color: #7d8aa0;
    font-size: 12px;
    background: #0b111b;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 11px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 999px;
    color: #cbd5e1;
    background: rgba(15, 23, 34, 0.92);
    font-size: 12px;
  }
  .dot { width: 7px; height: 7px; border-radius: 99px; background: var(--green); }
  .panel {
    background: #0d1420;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 12px;
  }
  .label { color: #7d8aa0; font-size: 12px; }
  .title { font-size: 24px; font-weight: 650; letter-spacing: 0; margin: 0; }
`

function appFrame(active, body) {
  const navs = ['dashboard', 'logs', 'settings', 'about']
  return `<div class="screen">
    <div class="window">
      <aside class="sidebar">
        <div class="mini-logo">${markSvg}</div>
        <div style="height:1px;width:30px;background:rgba(148,163,184,.12);margin:2px 0 4px"></div>
        ${navs
          .map(
            (nav, index) =>
              `<div class="nav ${active === nav ? 'active' : ''}">${['▦', '☰', '⚙', 'i'][index]}</div>`,
          )
          .join('')}
        <div style="flex:1"></div>
        <div class="nav">◐</div>
      </aside>
      <main class="main">
        <section class="content">${body}</section>
        <footer class="statusbar"><span><span style="color:#22c55e">●</span> CPA running on localhost:8317</span><span class="mono">v0.2.1</span></footer>
      </main>
    </div>
  </div>`
}

function dashboardBody() {
  const cards = [
    ['Quota Used', '41%', '8.2M / 20M tokens'],
    ['Active Keys', '12', '3 providers connected'],
    ['Requests', '2,184', 'Last 24 hours'],
  ]
  return `<style>${commonCss}
    .dash-shell { height: 100%; display: grid; grid-template-rows: auto 1fr; gap: 22px; }
    .dash-head { display:flex; justify-content:space-between; align-items:flex-start; }
    .dashboard-grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .quota-card { padding: 18px; min-height: 120px; }
    .metric { font-size: 32px; font-weight: 700; margin-top: 10px; }
    .chart { height: 330px; padding: 22px; display:flex; flex-direction:column; justify-content:flex-end; gap:14px; }
    .bars { display:grid; grid-template-columns:repeat(18,1fr); align-items:end; gap:9px; height:220px; }
    .bar { border-radius:8px 8px 3px 3px; background:linear-gradient(180deg,#fbbf24,#a16207); opacity:.95; }
    .side-panel { padding: 20px; display:flex; flex-direction:column; gap:14px; }
    .provider { height: 48px; border:1px solid rgba(148,163,184,.12); border-radius:10px; display:flex; align-items:center; justify-content:space-between; padding:0 14px; background:#0a1019; }
  </style>
  ${appFrame(
    'dashboard',
    `<div class="dash-shell">
      <div class="dash-head">
        <div>
          <p class="label">Dashboard</p>
          <h1 class="title">CLIProxyAPI management</h1>
        </div>
        <span class="pill"><span class="dot"></span> Live quota panel</span>
      </div>
      <div style="display:grid;grid-template-columns:1.5fr .8fr;gap:18px;min-height:0">
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="dashboard-grid">${cards
            .map(
              ([k, v, s]) =>
                `<div class="panel quota-card"><div class="label">${k}</div><div class="metric">${v}</div><div class="label">${s}</div></div>`,
            )
            .join('')}</div>
          <div class="panel chart">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><div class="label">Traffic</div><h2 style="margin:4px 0 0;font-size:18px">Requests by hour</h2></div>
              <span class="pill mono">8317</span>
            </div>
            <div class="bars">${[
              36, 58, 44, 70, 84, 49, 62, 88, 74, 96, 64, 53, 82, 90, 68, 76, 55, 72,
            ]
              .map((h) => `<div class="bar" style="height:${h}%"></div>`)
              .join('')}</div>
          </div>
        </div>
        <div class="panel side-panel">
          <div><div class="label">Provider routing</div><h2 style="margin:4px 0 0;font-size:18px">Healthy</h2></div>
          ${['OpenAI', 'Anthropic', 'Gemini', 'Local proxy'].map((name, i) => `<div class="provider"><span>${name}</span><span style="color:${i === 2 ? '#f59e0b' : '#22c55e'}">${i === 2 ? 'warm' : 'ready'}</span></div>`).join('')}
          <div style="flex:1;border-radius:12px;background:radial-gradient(circle at 60% 40%,rgba(245,158,11,.2),transparent 38%),#0a1019;border:1px solid rgba(148,163,184,.1);"></div>
        </div>
      </div>
    </div>`,
  )}`
}

function logsBody() {
  const lines = [
    ['12:43:09', 'stdout', 'loaded config from data/config.yaml'],
    ['12:43:10', 'stdout', 'server listening on 0.0.0.0:8317'],
    ['12:44:31', 'stdout', 'GET /management.html 200 4ms'],
    ['12:45:02', 'stdout', 'POST /v1/chat/completions routed to provider/openai'],
    ['12:45:03', 'stdout', 'stream completed 1.8s 14,284 tokens'],
    ['12:45:44', 'stderr', 'provider/gemini retry after 429, switching mirror'],
    ['12:45:45', 'stdout', 'mirror selected, request resumed'],
    ['12:46:02', 'stdout', 'quota snapshot persisted'],
  ]
  return `<style>${commonCss}
    .logs-page { height:100%; display:flex; flex-direction:column; gap:18px; }
    .toolbar { display:flex; align-items:center; gap:10px; }
    .search { height:36px; flex:1; border:1px solid rgba(148,163,184,.14); border-radius:9px; background:#0d1420; color:#94a3b8; padding:0 13px; }
    .log-list { flex:1; overflow:hidden; border-radius:12px; background:#090f17; border:1px solid rgba(148,163,184,.14); padding:12px 0; }
    .log-line { display:grid; grid-template-columns: 96px 74px 1fr; gap:12px; padding:11px 18px; font-size:13px; color:#cbd5e1; border-bottom:1px solid rgba(148,163,184,.06); }
    .level { color:#22c55e; }
    .level.err { color:#fb7185; }
  </style>
  ${appFrame(
    'logs',
    `<div class="logs-page">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><p class="label">Logs</p><h1 class="title">Realtime CPA stream</h1></div>
        <span class="pill"><span class="dot"></span> Tail enabled</span>
      </div>
      <div class="toolbar"><div class="search">Filter...</div><span class="pill">All</span><span class="pill">Out</span><span class="pill">Err</span><span class="pill mono">2,000 lines</span></div>
      <div class="log-list mono">${lines
        .map(
          ([time, level, text]) =>
            `<div class="log-line"><span style="color:#7d8aa0">${time}</span><span class="level ${level === 'stderr' ? 'err' : ''}">${level}</span><span>${text}</span></div>`,
        )
        .join('')}</div>
    </div>`,
  )}`
}

function settingsBody() {
  const rows = [
    ['CPA Port', '8317', 'Port CPA listens on'],
    ['Auto-start CPA', 'On', 'Launch CPA when the app opens'],
    ['Launch on login', 'Off', 'Start CPA Desktop at system login'],
  ]
  return `<style>${commonCss}
    .settings-page { height:100%; display:grid; grid-template-columns: .9fr 1.2fr; gap:18px; }
    .settings-col { display:flex; flex-direction:column; gap:14px; }
    .row { min-height:78px; padding:16px; display:flex; align-items:center; justify-content:space-between; }
    .value { height:34px; min-width:70px; border-radius:8px; background:rgba(245,158,11,.12); color:#fbbf24; display:grid; place-items:center; font-weight:650; }
    .editor { height:100%; padding:0; overflow:hidden; }
    .editor-head { height:46px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid rgba(148,163,184,.12); padding:0 16px; }
    .code { padding:18px 20px; line-height:1.85; font-size:14px; color:#cbd5e1; }
    .key { color:#fbbf24; }
    .comment { color:#64748b; }
  </style>
  ${appFrame(
    'settings',
    `<div style="height:100%;display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><p class="label">Settings</p><h1 class="title">Application and config</h1></div>
        <span class="pill">Save & Apply</span>
      </div>
      <div class="settings-page">
        <div class="settings-col">${rows
          .map(
            ([name, value, hint]) =>
              `<div class="panel row"><div><div style="font-weight:650">${name}</div><div class="label" style="margin-top:5px">${hint}</div></div><div class="value">${value}</div></div>`,
          )
          .join('')}
          <div class="panel" style="padding:18px;flex:1;background:radial-gradient(circle at 30% 20%,rgba(245,158,11,.13),transparent 38%),#0d1420"><div class="label">Data Folder</div><div style="margin-top:8px;color:#cbd5e1" class="mono">~/Library/Application Support/cpa-desktop</div></div>
        </div>
        <div class="panel editor">
          <div class="editor-head"><strong>config.yaml</strong><span class="pill">Restart CPA</span></div>
          <div class="code mono">
            <span class="comment"># CLIProxyAPI runtime</span><br>
            <span class="key">server:</span><br>
            &nbsp;&nbsp;<span class="key">port:</span> 8317<br>
            &nbsp;&nbsp;<span class="key">host:</span> 0.0.0.0<br>
            <span class="key">providers:</span><br>
            &nbsp;&nbsp;- <span class="key">name:</span> openai<br>
            &nbsp;&nbsp;&nbsp;&nbsp;<span class="key">enabled:</span> true<br>
            &nbsp;&nbsp;- <span class="key">name:</span> gemini<br>
            &nbsp;&nbsp;&nbsp;&nbsp;<span class="key">mirrors:</span> 2<br>
          </div>
        </div>
      </div>
    </div>`,
  )}`
}

function posterBody() {
  return `<style>${commonCss}
    .poster {
      position:relative;
      width:100%;
      height:100%;
      padding:70px;
      background:
        radial-gradient(circle at 22% 18%, rgba(245,158,11,.23), transparent 32%),
        radial-gradient(circle at 78% 24%, rgba(56,189,248,.12), transparent 34%),
        linear-gradient(135deg,#070b12,#0b1019 50%,#04060a);
      overflow:hidden;
    }
    .hero { width: 590px; position:absolute; left:78px; top:82px; }
    .hero-icon { width:112px; height:112px; margin-bottom:34px; }
    .hero h1 { font-size:76px; line-height:.95; letter-spacing:0; margin:0 0 24px; }
    .hero p { color:#cbd5e1; font-size:24px; line-height:1.38; margin:0; }
    .chips { display:flex; gap:12px; flex-wrap:wrap; margin-top:34px; }
    .chip { height:38px; padding:0 15px; border-radius:999px; display:flex; align-items:center; border:1px solid rgba(148,163,184,.18); background:rgba(15,23,34,.72); color:#dbe3ef; font-size:14px; }
    .poster-window { position:absolute; right:72px; bottom:64px; width:820px; height:560px; border-radius:24px; overflow:hidden; border:1px solid rgba(148,163,184,.2); box-shadow:0 44px 120px rgba(0,0,0,.55); background:#080d14; }
    .poster-window .window { inset:0; border:0; border-radius:0; box-shadow:none; }
    .glow-line { position:absolute; left:0; right:0; bottom:0; height:2px; background:linear-gradient(90deg,transparent,#f59e0b,transparent); opacity:.75; }
  </style>
  <div class="poster">
    <div class="hero">
      <div class="hero-icon">${markSvg.replace('width="96" height="96"', 'width="112" height="112"')}</div>
      <h1>CPA Desktop</h1>
      <p>A native control surface for CLIProxyAPI: managed downloads, silent background runtime, live logs, config editing, and one-click updates.</p>
      <div class="chips">
        <span class="chip">Tauri v2</span>
        <span class="chip">Rust + React</span>
        <span class="chip">Developer Tool</span>
        <span class="chip">Cross-platform</span>
      </div>
    </div>
    <div class="poster-window">${appFrame(
      'dashboard',
      `<div style="height:100%;display:grid;grid-template-rows:auto 1fr;gap:18px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div><p class="label">Dashboard</p><h1 class="title">Proxy runtime online</h1></div>
          <span class="pill"><span class="dot"></span> localhost:8317</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="panel" style="padding:18px"><div class="label">Managed Binary</div><div style="font-size:32px;font-weight:700;margin-top:10px">v0.2.1</div></div>
          <div class="panel" style="padding:18px"><div class="label">Log Stream</div><div style="font-size:32px;font-weight:700;margin-top:10px">Live</div></div>
          <div class="panel" style="grid-column:1/3;height:250px;padding:20px;background:radial-gradient(circle at 72% 30%,rgba(245,158,11,.16),transparent 36%),#0d1420">
            <div class="label">Routing health</div>
            <div style="margin-top:22px;display:grid;grid-template-columns:repeat(12,1fr);gap:8px;align-items:end;height:170px">${[34, 46, 52, 78, 66, 88, 58, 74, 92, 84, 69, 80].map((h) => `<div style="height:${h}%;border-radius:8px 8px 3px 3px;background:linear-gradient(#fbbf24,#a16207)"></div>`).join('')}</div>
          </div>
        </div>
      </div>`,
    )}</div>
    <div class="glow-line"></div>
  </div>`
}

renderHtml(
  'readme-poster',
  htmlShell(posterBody(), { width: 1600, height: 900 }),
  1600,
  900,
  path.join(readmeDir, 'poster.png'),
)
renderHtml(
  'readme-dashboard',
  htmlShell(dashboardBody(), { width: 1280, height: 800 }),
  1280,
  800,
  path.join(readmeDir, 'dashboard.png'),
)
renderHtml(
  'readme-logs',
  htmlShell(logsBody(), { width: 1280, height: 800 }),
  1280,
  800,
  path.join(readmeDir, 'logs.png'),
)
renderHtml(
  'readme-settings',
  htmlShell(settingsBody(), { width: 1280, height: 800 }),
  1280,
  800,
  path.join(readmeDir, 'settings.png'),
)

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
execFileSync(npmCmd, ['run', 'tauri', 'icon', '--', 'assets/brand/cpa-desktop-icon.png'], {
  cwd: root,
  stdio: 'inherit',
})

if (existsSync(tauriIconDir)) {
  for (const name of readdirSync(tauriIconDir)) {
    if (name !== 'icon.png') {
      rmSync(path.join(tauriIconDir, name), { recursive: true, force: true })
    }
  }
}

rmSync(tempDir, { recursive: true, force: true })
