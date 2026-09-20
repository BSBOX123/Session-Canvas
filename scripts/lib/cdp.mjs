/**
 * 개발 앱을 띄우고 Chrome DevTools Protocol로 붙는 공용 도구 (SPEC 14.3).
 *
 * macOS 손쉬운 사용/화면 기록 권한이 필요 없고, 스크린샷과 달리 "실제로
 * 렌더됐는지"를 판정할 수 있다.
 *
 * SECURITY: 원격 디버깅 포트에 닿을 수 있는 누구나 렌더러에서 임의 JS를
 * 실행할 수 있다. 점검 중에만 127.0.0.1로 열고 바로 닫는다. `npm run dev`에는
 * 절대 넣지 않는다.
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 단일 CDP 명령이 이보다 오래 걸리면 뭔가 잘못된 것이다. */
const CDP_TIMEOUT_MS = 30_000

/**
 * 점검 전체가 이 시간을 넘으면 실패로 끝낸다. 멈춘 채 방치되는 것보다
 * 실패가 낫다.
 */
export function watchdog(seconds, label) {
  const timer = setTimeout(() => {
    console.error(`\n❌ ${label}: ${seconds}초 안에 끝나지 않아 중단합니다.\n`)
    process.exit(1)
  }, seconds * 1000)
  return () => clearTimeout(timer)
}

export function parseArgs(argv) {
  const portIndex = argv.indexOf('--port')
  return {
    attach: argv.includes('--attach'),
    keep: argv.includes('--keep'),
    verbose: argv.includes('--verbose'),
    port: portIndex === -1 ? 9222 : Number(argv[portIndex + 1])
  }
}

/** 그 포트에 이미 앱이 떠 있는지. 있으면 새로 띄우지 않고 알려준다. */
export async function portInUse(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(1000)
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * `env`와 `electronArgs`로 앱을 격리해 띄울 수 있다 — 점검이 실제 워크스페이스
 * 파일이나 tmux 세션을 건드리지 않게 한다 (SPEC 14.2).
 */
export function startDevApp({ port, verbose, env = {}, electronArgs = [] }) {
  const child = spawn(
    process.execPath,
    [
      resolve(repoRoot, 'node_modules/electron-vite/bin/electron-vite.js'),
      'dev',
      '--',
      `--remote-debugging-port=${port}`,
      ...electronArgs
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      // 자기 프로세스 그룹에서 띄운다. 그래야 electron-vite가 만든 Electron
      // 자식까지 그룹째 정리되고, 사용자가 따로 띄운 dev는 건드리지 않는다.
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

export function stopDevApp(child) {
  if (!child || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    /* already gone */
  }
}

export async function waitForPageTarget({ port, attach, timeoutMs = 90_000 }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* devtools endpoint not up yet */
    }
    await sleep(500)
  }
  throw new Error(
    `DevTools 타깃을 ${timeoutMs / 1000}초 안에 찾지 못했습니다 (port ${port}).` +
      (attach ? ' --attach 모드입니다. 앱이 그 포트로 떠 있는지 확인하세요.' : '')
  )
}

/** 의존성 없는 최소 CDP 클라이언트 (Node 22+ 내장 WebSocket). */
export async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
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

  // 앱이 죽으면 소켓이 닫힌다. 여기서 깨우지 않으면 대기 중인 요청이 영원히
  // 안 끝나고 점검 전체가 멈춘다 (실제로 멈췄다).
  let closed = false
  ws.onclose = () => {
    closed = true
    for (const [, entry] of pending) {
      entry.reject(new Error('DevTools 연결이 끊겼습니다 (앱이 종료됐을 수 있습니다)'))
    }
    pending.clear()
  }

  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('DevTools 웹소켓 연결에 실패했습니다'))
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('DevTools 연결이 이미 닫혔습니다'))
        return
      }
      const id = ++nextId
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`CDP 응답 없음: ${method}`))
      }, CDP_TIMEOUT_MS)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      ws.send(JSON.stringify({ id, method, params }))
    })

  /** 페이지 안에서 식을 평가하고 값을 돌려받는다. */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (exceptionDetails) {
      throw new Error(
        `${exceptionDetails.text} ${exceptionDetails.exception?.description ?? ''}`.trim()
      )
    }
    return result.value
  }

  return { send, evaluate, events, close: () => ws.close() }
}

/**
 * 개발 브리지가 뜨고 **부팅이 끝날 때까지** 기다린다 (SPEC 14.3).
 *
 * 브리지만 보고 노드를 추가하면 안 된다. 앱의 시작 흐름은 비동기라
 * (tmux 확인 → workspace 로드 → hydrate), 그 전에 추가한 노드는
 * `hydrate()`가 통째로 덮어써 사라진다. 캔버스가 그려졌는지까지 본다.
 */
export async function waitForBridge(client, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ready = await client.evaluate(
      `!!(window.__sessionCanvas && document.querySelector('.react-flow'))`
    )
    if (ready) return
    if (Date.now() > deadline) {
      throw new Error('타임아웃: 앱 시작이 끝나지 않았습니다 (개발 브리지 또는 캔버스 없음)')
    }
    await sleep(250)
  }
}

/** `Log.enable` 이후 모인 이벤트에서 오류만 골라낸다. */
export function collectProblems(events) {
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

/** 확인 항목을 모아 출력하고 실패 수를 돌려준다. */
export function createReporter(heading) {
  const rows = []
  console.log(`\n[${heading}]\n`)
  return {
    check(label, ok, detail) {
      rows.push(ok)
      console.log(`  ${ok ? '✅' : '❌'} ${label} — ${detail}`)
    },
    skip(label, detail) {
      console.log(`  -  ${label} — ${detail}`)
    },
    finish() {
      const failed = rows.filter((ok) => !ok).length
      console.log('')
      console.log(failed === 0 ? '모든 확인 항목 통과.' : `실패한 확인 항목 ${failed}개.`)
      return failed
    }
  }
}
