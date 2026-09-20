#!/usr/bin/env node
/**
 * 단계 6 다듬기 점검 (SPEC 12.1 / 14.3).
 *
 *   - 헤더에 `경로 · 브랜치`가 뜨는지 (SPEC 7.1)
 *   - 색 라벨이 헤더 좌측 띠로 붙는지 (SPEC 7.1)
 *   - 설정의 글자 크기·폰트가 살아 있는 터미널에 반영되는지 (SPEC 9.1)
 *   - `claudeSessionId`가 있을 때만 [이전 대화 이어서]가 보이는지 (SPEC 5.4)
 *
 * 패키징 확인(SPEC 4.4)은 여기서 못 한다 — Finder에서 직접 실행해야 한다.
 *
 *   npm run verify:polish
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  connect,
  createReporter,
  parseArgs,
  portInUse,
  repoRoot,
  sleep,
  startDevApp,
  stopDevApp,
  waitForBridge,
  waitForPageTarget,
  watchdog
} from './lib/cdp.mjs'

const options = parseArgs(process.argv.slice(2))
const SOCKET = 'session-canvas-check-polish'

const launch = {
  ...options,
  env: {
    SESSION_CANVAS_TMUX_SOCKET: SOCKET,
    DISABLE_AUTO_UPDATE: 'true',
    DISABLE_UPDATE_PROMPT: 'true'
  },
  electronArgs: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'session-canvas-check-'))}`]
}

const killCheckServer = () => {
  try {
    execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' })
  } catch {
    /* 서버가 없으면 그만이다 */
  }
}

const stopWatchdog = watchdog(300, '단계 6 점검')
const reporter = createReporter('단계 6 다듬기 점검')
let dev = null

try {
  if (await portInUse(options.port)) {
    throw new Error(`포트 ${options.port}에 이미 앱이 떠 있습니다. --port 로 다른 포트를 쓰세요.`)
  }
  killCheckServer()

  dev = startDevApp(launch)
  const client = await connect(await waitForPageTarget(options))
  const { evaluate } = client
  await waitForBridge(client)

  const bridge = (expr) => evaluate(`window.__sessionCanvas.${expr}`)

  // 이 저장소를 cwd로 쓴다 — git 저장소라 브랜치가 나와야 한다.
  const nodeId = await bridge(`addNode({
    cwd: ${JSON.stringify(repoRoot)},
    title: '다듬기 점검',
    command: null,
    position: { x: 80, y: 80 }
  })`)

  const ready = Date.now() + 60_000
  while (!(await evaluate(`!!window.__sessionCanvas.terminals[${JSON.stringify(nodeId)}]`))) {
    if (Date.now() > ready) throw new Error('타임아웃: 터미널이 만들어지지 않았습니다')
    await sleep(400)
  }

  // ── 경로 · 브랜치 (SPEC 7.1) ─────────────────────────
  const expectedBranch = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'])
    .toString()
    .trim()
  const branchDeadline = Date.now() + 15_000
  let shown = null
  while (Date.now() < branchDeadline) {
    shown = await evaluate(`(() => {
      const el = document.querySelector('.node-location')
      if (!el) return null
      return {
        path: el.querySelector('.node-location-path')?.textContent ?? null,
        branch: el.querySelector('.node-location-branch')?.textContent ?? null
      }
    })()`)
    if (shown?.branch) break
    await sleep(400)
  }
  reporter.check(
    '헤더에 경로 · git 브랜치가 뜬다 (SPEC 7.1)',
    shown?.branch === expectedBranch && (shown?.path ?? '').includes('Session-Canvas'),
    `${shown?.path} · ${shown?.branch} (실제 브랜치 ${expectedBranch})`
  )

  // ── 색 라벨 (SPEC 7.1) ───────────────────────────────
  await bridge(`updateNode(${JSON.stringify(nodeId)}, { color: '#c96f6f' })`)
  await sleep(400)
  const stripe = await evaluate(`(() => {
    const el = document.querySelector('.node-color-stripe')
    if (!el) return null
    const s = getComputedStyle(el)
    return { background: s.backgroundColor, width: s.width }
  })()`)
  reporter.check(
    '색 라벨이 헤더 좌측 띠로 붙는다 (SPEC 7.1)',
    stripe !== null && stripe.background === 'rgb(201, 111, 111)',
    stripe === null ? '띠 없음' : `${stripe.background}, 너비 ${stripe.width}`
  )

  // ── 설정이 터미널에 반영되는지 (SPEC 9.1) ────────────
  const fontBefore = await evaluate(
    `window.__sessionCanvas.terminals[${JSON.stringify(nodeId)}].options.fontSize`
  )
  await evaluate(`(window.__sessionCanvas.setSettings({ fontSize: 18 }), 1)`)
  await sleep(600)
  const fontAfter = await evaluate(
    `window.__sessionCanvas.terminals[${JSON.stringify(nodeId)}].options.fontSize`
  )
  reporter.check(
    '설정의 글자 크기가 살아 있는 터미널에 반영된다 (SPEC 9.1)',
    fontAfter === 18 && fontBefore !== 18,
    `${fontBefore} → ${fontAfter}`
  )

  // ── 세션 없음 + 이전 대화 이어서 (SPEC 5.4) ──────────
  await bridge(`setMissingSessions([${JSON.stringify(nodeId)}])`)
  await sleep(500)
  const withoutSessionId = await evaluate(`(() => ({
    panel: !!document.querySelector('.detached-session'),
    resume: [...document.querySelectorAll('.detached-button')].some((b) =>
      b.textContent.includes('이전 대화')
    )
  }))()`)
  reporter.check(
    'claudeSessionId가 없으면 [새로 시작]만 보인다 (SPEC 5.4)',
    withoutSessionId.panel && !withoutSessionId.resume,
    `패널=${withoutSessionId.panel}, 이어서 버튼=${withoutSessionId.resume}`
  )

  await bridge(`updateNode(${JSON.stringify(nodeId)}, { claudeSessionId: 'sess-abc-123' })`)
  await sleep(500)
  const withSessionId = await evaluate(`(() =>
    [...document.querySelectorAll('.detached-button')].some((b) =>
      b.textContent.includes('이전 대화')
    ))()`)
  reporter.check(
    'claudeSessionId가 있으면 [이전 대화 이어서]가 보인다 (SPEC 5.4)',
    withSessionId === true,
    `이어서 버튼=${withSessionId}`
  )

  client.close()
  process.exitCode = reporter.finish() > 0 ? 1 : 0
} catch (error) {
  console.error(`\n❌ ${error.message}\n`)
  if (dev && !options.verbose) console.error(dev.mainLog.join(''))
  process.exitCode = 1
} finally {
  stopWatchdog()
  if (dev && !options.keep) stopDevApp(dev.child)
  killCheckServer()
}
