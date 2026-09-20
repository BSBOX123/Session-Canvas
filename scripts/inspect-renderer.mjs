#!/usr/bin/env node
/**
 * Renderer smoke check (SPEC 12.1 단계 0 완료 기준).
 *
 * Starts the dev app with Chrome DevTools Protocol enabled, asks the live page
 * what it actually rendered, and reports console errors / exceptions. Needs no
 * macOS Accessibility permission and no screen capture, unlike osascript or
 * `screencapture`, and unlike a screenshot it can tell whether React mounted.
 *
 *   node scripts/inspect-renderer.mjs             # start dev, check, shut down
 *   node scripts/inspect-renderer.mjs --attach    # check an already running dev
 *   node scripts/inspect-renderer.mjs --port 9333 # use another debugging port
 *   node scripts/inspect-renderer.mjs --keep      # leave the app running
 *
 * Exits 0 when every check passes, 1 otherwise.
 *
 * SECURITY: the remote debugging port lets anything that can reach it run
 * arbitrary JS in the renderer. It is opened only for this check, bound to
 * 127.0.0.1, and closed again. Never enable it in `npm run dev`.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const attach = argv.includes('--attach')
const keep = argv.includes('--keep')
const portIndex = argv.indexOf('--port')
const port = portIndex === -1 ? 9222 : Number(argv[portIndex + 1])
const verbose = argv.includes('--verbose')

const STARTUP_TIMEOUT_MS = 90_000
const MOUNT_TIMEOUT_MS = 10_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The page-side expression. Keep it JSON-serializable. */
const PROBE = `JSON.stringify({
  title: document.title,
  url: location.href,
  rootChildren: document.querySelectorAll('#root > *').length,
  hasAppDiv: !!document.querySelector('div.app'),
  bodyBackground: getComputedStyle(document.body).backgroundColor,
  apiType: typeof window.api,
  requireType: typeof window.require,
  processType: typeof window.process
})`

function startDevApp() {
  const child = spawn(
    process.execPath,
    [
      resolve(repoRoot, 'node_modules/electron-vite/bin/electron-vite.js'),
      'dev',
      '--',
      `--remote-debugging-port=${port}`
    ],
    {
      cwd: repoRoot,
      // Own process group, so we can take the Electron children down with us.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  const mainLog = []
  const collect = (chunk) => {
    const text = String(chunk)
    mainLog.push(text)
    if (verbose) process.stdout.write(text)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return { child, mainLog }
}

function stopDevApp(child) {
  if (!child || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}

async function waitForPageTarget() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* devtools endpoint not up yet */
    }
    await sleep(500)
  }
  throw new Error(
    `DevTools 타깃을 ${STARTUP_TIMEOUT_MS / 1000}초 안에 찾지 못했습니다 (port ${port}).` +
      (attach ? ' --attach 모드입니다. 앱이 그 포트로 떠 있는지 확인하세요.' : '')
  )
}

/** Minimal CDP client over the built-in WebSocket (Node 22+), no dependencies. */
function connect(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  const events = []
  let nextId = 0

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
      return
    }
    events.push(message)
  }

  const ready = new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('DevTools 웹소켓 연결에 실패했습니다'))
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  return { ready, send, events, close: () => ws.close() }
}

function collectProblems(events) {
  const problems = []
  for (const event of events) {
    if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails
      problems.push(`예외: ${details.exception?.description ?? details.text}`)
    }
    if (event.method === 'Log.entryAdded') {
      const entry = event.params.entry
      if (entry.level === 'error' || entry.level === 'warning') {
        problems.push(`[${entry.level}] ${entry.text}`)
      }
    }
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') {
      const text = event.params.args.map((a) => a.description ?? a.value).join(' ')
      problems.push(`console.error: ${text}`)
    }
  }
  return problems
}

async function probeUntilMounted(send) {
  const deadline = Date.now() + MOUNT_TIMEOUT_MS
  let snapshot
  while (Date.now() < deadline) {
    const { result } = await send('Runtime.evaluate', {
      expression: PROBE,
      returnByValue: true
    })
    snapshot = JSON.parse(result.value)
    if (snapshot.rootChildren > 0) return snapshot
    await sleep(250)
  }
  return snapshot
}

function report(snapshot, problems, mainLog) {
  // SPEC 11 (격리), 12.1 단계 0 (빈 창), 13 R5 (node-pty).
  const checks = [
    ['창이 떠 있고 렌더러가 로드됨', Boolean(snapshot?.title), `title="${snapshot?.title ?? ''}"`],
    [
      'React가 #root에 마운트됨',
      snapshot?.rootChildren > 0,
      `#root 자식 ${snapshot?.rootChildren}개`
    ],
    ['App이 렌더됨 (div.app)', snapshot?.hasAppDiv === true, String(snapshot?.hasAppDiv)],
    [
      '스타일 적용됨 (CSP가 막지 않음)',
      Boolean(snapshot?.bodyBackground),
      snapshot?.bodyBackground
    ],
    ['preload 브리지 노출됨 (window.api)', snapshot?.apiType === 'object', snapshot?.apiType],
    [
      '렌더러에 Node 접근 없음 (SPEC 11)',
      snapshot?.requireType === 'undefined' && snapshot?.processType === 'undefined',
      `require=${snapshot?.requireType}, process=${snapshot?.processType}`
    ],
    ['콘솔 오류·CSP 위반 없음', problems.length === 0, `${problems.length}건`],
    [
      'node-pty 로드됨 (SPEC 13 R5)',
      mainLog === null || /node-pty loaded, spawn is function/.test(mainLog),
      mainLog === null ? '--attach 모드: 확인 생략' : 'main 프로세스 로그'
    ]
  ]

  console.log('')
  let failed = 0
  for (const [label, ok, detail] of checks) {
    const skipped = label.includes('node-pty') && mainLog === null
    if (skipped) {
      console.log(`  -  ${label} — ${detail}`)
      continue
    }
    if (!ok) failed += 1
    console.log(`  ${ok ? '✅' : '❌'} ${label} — ${detail}`)
  }
  if (problems.length > 0) {
    console.log('\n  렌더러 로그:')
    for (const problem of problems) console.log(`    · ${problem}`)
  }
  console.log('')
  return failed
}

async function main() {
  let dev = null
  if (!attach) {
    dev = startDevApp()
  }

  try {
    const target = await waitForPageTarget()
    const client = connect(target.webSocketDebuggerUrl)
    await client.ready

    // Enable before reloading, so nothing that happens during load is missed.
    await client.send('Log.enable')
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await client.send('Page.reload', { ignoreCache: true })
    await sleep(1500)

    const snapshot = await probeUntilMounted(client.send)
    const problems = collectProblems(client.events)
    client.close()

    const failed = report(snapshot, problems, dev ? dev.mainLog.join('') : null)
    if (failed > 0) {
      console.log(`실패한 확인 항목 ${failed}개.`)
      process.exitCode = 1
    } else {
      console.log('모든 확인 항목 통과.')
    }
  } catch (error) {
    console.error(`\n❌ ${error.message}\n`)
    if (dev && !verbose) console.error(dev.mainLog.join(''))
    process.exitCode = 1
  } finally {
    if (dev && !keep) stopDevApp(dev.child)
    else if (dev && keep) console.log(`앱을 그대로 둡니다 (pid ${dev.child.pid}).`)
  }
}

await main()
