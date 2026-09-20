#!/usr/bin/env node
/**
 * 단계 3 완료 기준 점검 (SPEC 12.1 / 14.3).
 *
 *   - 앱을 **강제 종료(SIGKILL)** 해도 tmux 세션과 그 안의 내용이 남는지
 *   - 다시 켜면 레이아웃·제목·설명이 복원되고 세션에 자동 재접속하는지
 *   - tmux 상태줄이 보이지 않는지 (SPEC 5.2)
 *   - `Ctrl+B`가 tmux에 먹히지 않고 그대로 전달되는지 (prefix None)
 *   - 휠 스크롤이 tmux 스크롤백으로 가는지 (SPEC 6.4)
 *   - 사용자 기본 tmux 서버에 아무 영향이 없는지 (SPEC 5.1)
 *   - 노드 닫기(분리) 후 "분리된 세션"으로 되살아나는지 (SPEC 5.4)
 *
 * 격리: 전용 소켓에 접미사를 붙이고(SPEC 14.2), userData도 임시 폴더를 쓴다.
 *
 *   npm run verify:persistence
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  connect,
  createReporter,
  parseArgs,
  portInUse,
  repoRoot,
  sleep,
  startDevApp,
  stopDevApp,
  waitForPageTarget,
  watchdog
} from './lib/cdp.mjs'

const execFileAsync = promisify(execFile)
const options = parseArgs(process.argv.slice(2))

const SOCKET = 'session-canvas-check'
const CONFIG = resolve(repoRoot, 'resources/tmux.conf')
const tmux = (args) => execFileAsync('tmux', ['-L', SOCKET, '-f', CONFIG, ...args])
const killServer = () => execFileAsync('tmux', ['-L', SOCKET, 'kill-server']).catch(() => undefined)

const userDataDir = await mkdtemp(join(tmpdir(), 'session-canvas-check-'))
const launch = {
  ...options,
  env: {
    SESSION_CANVAS_TMUX_SOCKET: SOCKET,
    // 로그인 셸이 "업데이트할까요?" 같은 질문으로 멈춰 서면 점검이 막힌다.
    // 사용자의 실제 셸에서는 그대로 보이는 게 맞지만, 여기서는 꺼 둔다.
    DISABLE_AUTO_UPDATE: 'true',
    DISABLE_UPDATE_PROMPT: 'true'
  },
  electronArgs: [`--user-data-dir=${userDataDir}`]
}

/** 앱을 띄우고 개발 브리지가 준비될 때까지 기다린다. */
async function launchApp() {
  const dev = startDevApp(launch)
  const client = await connect(await waitForPageTarget(options))
  const deadline = Date.now() + 40_000
  while (!(await client.evaluate('!!window.__sessionCanvas'))) {
    if (Date.now() > deadline) throw new Error('타임아웃: 개발 브리지가 뜨지 않았습니다')
    await sleep(250)
  }
  return { dev, client }
}

/** 제어문자를 소스에 그대로 박으면 평가식이 깨진다. 반드시 JSON으로 넘긴다. */
const writeExpr = (id, data) =>
  `(window.api.pty.write(${JSON.stringify(id)}, ${JSON.stringify(data)}), 1)`

const bufferExpr = (id) => `(() => {
  const t = window.__sessionCanvas.terminals[${JSON.stringify(id)}]
  if (!t) return null
  const b = t.buffer.active, out = []
  for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) out.push(l.translateToString(true)) }
  return out.join('\\n')
})()`

async function waitForText(client, id, needle, label, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  for (;;) {
    last = await client.evaluate(bufferExpr(id))
    if (last && last.includes(needle)) return last
    if (Date.now() > deadline) {
      // 무엇을 기다리다 멈췄는지 보여준다. 셸이 프롬프트를 띄우고 멈춰 있는
      // 경우가 대부분이라, 화면을 봐야 원인을 안다.
      const tail = (last ?? '(터미널 없음)').split('\n').filter(Boolean).slice(-6).join(' / ')
      throw new Error(`타임아웃: ${label}\n   마지막 화면: ${tail}`)
    }
    await sleep(250)
  }
}

let first = null
let second = null
const stopWatchdog = watchdog(300, '단계 3 점검')
const reporter = createReporter('단계 3 tmux · 영속성 점검')

try {
  if (await portInUse(options.port)) {
    throw new Error(`포트 ${options.port}에 이미 앱이 떠 있습니다. --port 로 다른 포트를 쓰세요.`)
  }
  await killServer()

  // ── 1회차: 노드를 만들고 흔적을 남긴다 ────────────────
  first = await launchApp()
  const nodeId = await first.client.evaluate(`window.__sessionCanvas.addNode({
    cwd: ${JSON.stringify(homedir())},
    title: '영속성 점검',
    command: null,
    position: { x: 120, y: 90 }
  })`)
  await first.client.evaluate(
    `(window.__sessionCanvas.updateNode(${JSON.stringify(nodeId)}, { description: '재시작해도 남아야 하는 설명' }), 1)`
  )

  const MARK = `PERSIST_${Date.now()}`
  await waitForText(first.client, nodeId, '❯', '셸 프롬프트').catch(() => undefined)
  await sleep(1200)
  await first.client.evaluate(writeExpr(nodeId, `echo ${MARK}\r`))
  await waitForText(first.client, nodeId, MARK, '마커 출력')

  const sessions = await tmux(['list-sessions', '-F', '#{session_name}']).then((r) => r.stdout)
  reporter.check('tmux 세션이 생겼다', sessions.includes(`sc-${nodeId}`), `sc-${nodeId}`)

  // SPEC 5.1: 사용자 기본 tmux 서버와 격리
  const defaultServer = await execFileAsync('tmux', ['list-sessions'])
    .then((r) => r.stdout)
    .catch(() => '')
  reporter.check(
    '사용자 기본 tmux 서버에 영향 없음 (SPEC 5.1)',
    !defaultServer.includes('sc-'),
    defaultServer.trim().length === 0 ? '기본 서버에 세션 없음' : '기본 서버에 sc-* 없음'
  )

  // SPEC 5.2: 상태줄 숨김 · prefix 비활성
  const status = await tmux(['show', '-g', 'status']).then((r) => r.stdout.trim())
  const prefix = await tmux(['show', '-g', 'prefix']).then((r) => r.stdout.trim())
  const escapeTime = await tmux(['show', '-g', 'escape-time']).then((r) => r.stdout.trim())
  reporter.check('tmux 상태줄 숨김 (SPEC 5.2)', status === 'status off', status)
  reporter.check('prefix 비활성 — Ctrl+B가 가로채이지 않음', prefix === 'prefix None', prefix)
  reporter.check('escape-time 0 — Esc 반응성', escapeTime === 'escape-time 0', escapeTime)

  // Ctrl+B가 실제로 터미널까지 가는지
  await first.client.evaluate(writeExpr(nodeId, 'cat -v\r'))
  await sleep(900)
  await first.client.evaluate(writeExpr(nodeId, '\u0002'))
  await sleep(900)
  const ctrlB = await first.client.evaluate(bufferExpr(nodeId))
  reporter.check('Ctrl+B가 그대로 전달됨 (SPEC 5.2)', ctrlB.includes('^B'), 'cat -v 가 ^B 를 받음')
  await first.client.evaluate(writeExpr(nodeId, '\u0003'))
  await sleep(400)

  // ── 강제 종료 ────────────────────────────────────────
  first.client.close()
  process.kill(-first.dev.child.pid, 'SIGKILL')
  first = null
  await sleep(3000)

  const afterKill = await tmux(['list-sessions', '-F', '#{session_name}']).then((r) => r.stdout)
  reporter.check(
    '앱을 강제 종료해도 tmux 세션이 살아 있다',
    afterKill.includes(`sc-${nodeId}`),
    afterKill.trim()
  )

  // ── 2회차: 재시작 복구 ───────────────────────────────
  second = await launchApp()
  const restored = await second.client.evaluate(
    `window.__sessionCanvas.nodes.find((n) => n.id === ${JSON.stringify(nodeId)}) ?? null`
  )
  reporter.check(
    '재시작 후 노드가 복원됨 (레이아웃·제목·설명)',
    restored !== null &&
      restored.title === '영속성 점검' &&
      restored.description === '재시작해도 남아야 하는 설명' &&
      restored.position.x === 120,
    restored === null
      ? '노드 없음'
      : `"${restored.title}" (${restored.position.x}, ${restored.position.y})`
  )

  const reattached = await waitForText(second.client, nodeId, MARK, '재접속 후 이전 출력')
  reporter.check(
    '세션에 자동 재접속 — 이전 화면이 그대로',
    reattached.includes(MARK),
    `이전 출력 ${MARK} 가 그대로 보임`
  )

  // 휠 스크롤 → tmux 스크롤백 (copy-mode 진입으로 확인).
  // 재시작 점검 뒤에 한다 — `seq` 출력이 마커를 화면 밖으로 밀어내기 때문이다.
  await second.client.evaluate(writeExpr(nodeId, 'seq 1 200\r'))
  await sleep(1200)
  // 노드를 특정해서 집는다. `.terminal-area`만 쓰면 다른 노드를 굴린다.
  const termRect = await second.client.evaluate(`(() => {
    const node = document.querySelector('.react-flow__node[data-id=' + ${JSON.stringify(JSON.stringify(nodeId))} + ']')
    const r = node.querySelector('.terminal-area').getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  for (let i = 0; i < 4; i++) {
    await second.client.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: termRect.x,
      y: termRect.y,
      deltaX: 0,
      // 음수가 "위로" — 스크롤백으로 들어가는 방향이다.
      deltaY: -120
    })
    await sleep(120)
  }
  await sleep(600)
  const inMode = await tmux([
    'display-message',
    '-p',
    '-t',
    `sc-${nodeId}`,
    '#{pane_in_mode}'
  ]).then((r) => r.stdout.trim())
  reporter.check('휠 스크롤 → tmux 스크롤백 (SPEC 6.4)', inMode === '1', `pane_in_mode=${inMode}`)
  await tmux(['send-keys', '-t', `sc-${nodeId}`, '-X', 'cancel']).catch(() => undefined)

  // ── 닫기(분리) → 분리된 세션으로 복원 ────────────────
  await second.client.evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(nodeId)}) + ']')
    ;[...el.querySelectorAll('.node-button')].find((b) => b.textContent.trim() === '×').click()
    return 1
  })()`)
  await sleep(300)
  await second.client.evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(nodeId)}) + ']')
    ;[...el.querySelectorAll('.node-button')].find((b) => b.textContent.includes('분리')).click()
    return 1
  })()`)
  await sleep(1500)
  const stillAlive = await tmux(['has-session', '-t', `sc-${nodeId}`])
    .then(() => true)
    .catch(() => false)
  const nodeGone = (await second.client.evaluate('window.__sessionCanvas.nodes.length')) === 0
  reporter.check(
    '닫기(분리) — 노드는 사라지고 tmux 세션은 살아 있다 (SPEC 5.3)',
    stillAlive && nodeGone,
    `세션 유지=${stillAlive}, 노드 수=0`
  )

  const orphans = await second.client.evaluate(
    `window.api.tmux.listOrphans(window.__sessionCanvas.nodes.map((n) => n.id))`
  )
  reporter.check(
    '분리된 세션 목록에 나타남 (SPEC 5.4)',
    orphans.some((o) => o.id === nodeId),
    orphans.map((o) => `sc-${o.id}`).join(', ')
  )

  // ── 세션 종료 ────────────────────────────────────────
  await second.client.evaluate(`window.api.pty.kill(${JSON.stringify(nodeId)})`)
  await sleep(1000)
  const killed = await tmux(['has-session', '-t', `sc-${nodeId}`])
    .then(() => true)
    .catch(() => false)
  reporter.check('세션 종료 — tmux 세션이 사라진다 (SPEC 5.3)', !killed, `has-session=${killed}`)

  process.exitCode = reporter.finish() > 0 ? 1 : 0
} catch (error) {
  console.error(`\n❌ ${error.message}\n`)
  if (first && !options.verbose) console.error(first.dev.mainLog.join(''))
  if (second && !options.verbose) console.error(second.dev.mainLog.join(''))
  process.exitCode = 1
} finally {
  stopWatchdog()
  if (first) stopDevApp(first.dev.child)
  if (second) stopDevApp(second.dev.child)
  await killServer()
  await rm(userDataDir, { recursive: true, force: true })
}
