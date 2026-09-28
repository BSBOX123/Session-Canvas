#!/usr/bin/env node
/**
 * 단계 6 다듬기 점검 (SPEC 12.1 / 14.3).
 *
 *   - 헤더에 `경로 · 브랜치`가 뜨는지 (SPEC 7.1)
 *   - 색 라벨이 헤더 좌측 띠로 붙는지 (SPEC 7.1)
 *   - 설정의 글자 크기·폰트가 살아 있는 터미널에 반영되는지 (SPEC 9.1)
 *   - `agentSessionId`가 있을 때만 [이전 대화 이어서]가 보이는지 (SPEC 5.4)
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

  // ── 상태 테두리 (SPEC 8.1) ───────────────────────────
  const borderOf = () =>
    evaluate(`(() => {
      const el = document.querySelector('.terminal-node')
      const s = getComputedStyle(el)
      return {
        width: s.borderTopWidth,
        color: s.borderTopColor,
        radius: s.borderTopLeftRadius,
        animation: s.animationName,
        classes: el.className
      }
    })()`)

  const idle = await borderOf()
  reporter.check(
    '작업 없음 → 흰색 테두리, 굵기 3px (SPEC 8.1)',
    idle.width === '3px' && idle.color === 'rgb(232, 235, 239)',
    `${idle.width} ${idle.color}`
  )
  reporter.check('노드 모서리가 둥글다', Number.parseInt(idle.radius, 10) >= 14, idle.radius)

  /**
   * 상태를 넣고 **테두리가 그 상태의 클래스로 바뀔 때까지** 기다린다.
   *
   * 고정 시간(350ms)만 기다리면 앱이 바쁠 때(터미널 기동 중) `transition:
   * border-color 160ms`가 끝나기 전에 읽어서 이전 색이 잡힌다. 실제로 그 때문에
   * `작업 중`이 흰색으로 읽히는 실패가 간헐적으로 났다.
   */
  const rgb = (color) => (/rgba?\((\d+), (\d+), (\d+)/.exec(color) ?? []).slice(1).map(Number)

  const apply = async (state) => {
    await evaluate(`(window.__sessionCanvas.applyStatus({
      nodeId: ${JSON.stringify(nodeId)},
      state: ${JSON.stringify(state)},
      at: new Date().toISOString(),
      agentSessionId: null,
      backgroundTasks: null
    }), 1)`)
    const deadline = Date.now() + 5000
    let border = await borderOf()
    while (!border.classes.includes(`state-${state}`) && Date.now() < deadline) {
      await sleep(100)
      border = await borderOf()
    }
    // 클래스가 붙은 뒤에도 transition이 남아 있다. 색이 멈출 때까지 본다.
    let previous = border.color
    for (let i = 0; i < 20; i += 1) {
      await sleep(80)
      border = await borderOf()
      // 깜빡이는 상태는 영원히 변하므로 애니메이션이 있으면 기다리지 않는다.
      if (border.animation !== 'none' || border.color === previous) break
      previous = border.color
    }
    return border
  }

  const working = await apply('working')
  reporter.check(
    '작업 중 → 파란 테두리',
    working.color === 'rgb(76, 155, 255)' && working.animation === 'none',
    `${working.color}, 애니메이션=${working.animation}`
  )

  // 깜빡이는 동안에는 테두리 색이 두 값 사이를 오간다. 정확한 값 대신
  // 색 계열로 본다.
  const waiting = await apply('waiting')
  const [wr, wg, wb] = rgb(waiting.color)
  reporter.check(
    '입력 대기 → 주황 테두리 + 깜빡임 (SPEC 8.1)',
    wr > 200 && wg > 120 && wg < wr && wb < wg && waiting.animation === 'status-pulse-waiting',
    `${waiting.color}, 애니메이션=${waiting.animation}`
  )

  const done = await apply('done')
  const [dr, dg, db] = rgb(done.color)
  reporter.check(
    '완료 → 초록 테두리 + 깜빡임',
    dg > 180 && dg > dr && dg > db && done.animation === 'status-pulse-done',
    `${done.color}, 애니메이션=${done.animation}`
  )

  await evaluate(`(window.__sessionCanvas.markSeen(${JSON.stringify(nodeId)}), 1)`)
  await sleep(350)
  const seen = await borderOf()
  reporter.check(
    '확인하면 깜빡임이 멈춘다',
    seen.animation === 'none',
    `애니메이션=${seen.animation}, 클래스="${seen.classes}"`
  )

  // ── 테마 (SPEC 9.1) ──────────────────────────────────
  const themeOf = () =>
    evaluate(`(() => {
      const root = getComputedStyle(document.documentElement)
      const term = window.__sessionCanvas.terminals[${JSON.stringify(nodeId)}]
      return {
        bg: root.getPropertyValue('--bg').trim(),
        accent: root.getPropertyValue('--accent').trim(),
        body: getComputedStyle(document.body).backgroundColor,
        terminalBg: term ? term.options.theme.background : null
      }
    })()`)

  const beforeTheme = await themeOf()
  await evaluate(
    `(window.__sessionCanvas.setSettings({ theme: { preset: 'latte', accent: '#3fb894' } }), 1)`
  )
  await sleep(500)
  const afterTheme = await themeOf()
  reporter.check(
    '테마를 바꾸면 화면 색이 바뀐다 (SPEC 9.1)',
    afterTheme.bg === '#f4f1ec' &&
      afterTheme.accent === '#3fb894' &&
      afterTheme.bg !== beforeTheme.bg,
    `${beforeTheme.bg} → ${afterTheme.bg}, 강조색 ${afterTheme.accent}`
  )
  reporter.check(
    '테마가 터미널 배경에도 반영된다',
    afterTheme.terminalBg === '#f4f1ec',
    `터미널 배경 ${beforeTheme.terminalBg} → ${afterTheme.terminalBg}`
  )

  // 상태 색은 테마와 무관하게 유지되어야 한다.
  const afterThemeBorder = await borderOf()
  // SPEC 8.1 — 백그라운드는 주황(입력 대기)과 확실히 달라야 한다.
  //
  // ⚠️ 이것도 깜빡이므로 **정확한 색을 단언하지 않는다.** `#b18cff`와 `#cdb4ff`
  // 사이를 오가서 중간값(예: 181,145,255)이 잡힌다. 보라 계열인지로 본다.
  const background = await apply('background')
  const [br, bg2, bb] = rgb(background.color)
  reporter.check(
    '백그라운드 → 보라 테두리 + 느린 숨쉬기 (SPEC 8.1)',
    bb > 240 &&
      br > 150 &&
      bb > br &&
      br > bg2 &&
      background.animation === 'status-pulse-background',
    `${background.color}, 애니메이션=${background.animation}`
  )
  reporter.check(
    '백그라운드는 입력 대기(주황)와 계열이 다르다',
    bb > br,
    `파랑 ${bb} > 빨강 ${br} (주황이면 반대다)`
  )

  reporter.check(
    '테마를 바꿔도 상태 테두리 색은 그대로',
    afterThemeBorder.color === 'rgb(232, 235, 239)',
    afterThemeBorder.color
  )

  await evaluate(
    `(window.__sessionCanvas.setSettings({ theme: { preset: 'dark', accent: '#4c8dff' } }), 1)`
  )
  await sleep(300)

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
    'agentSessionId가 없으면 [새로 시작]만 보인다 (SPEC 5.4)',
    withoutSessionId.panel && !withoutSessionId.resume,
    `패널=${withoutSessionId.panel}, 이어서 버튼=${withoutSessionId.resume}`
  )

  // v2에서 터미널 고유 필드는 `terminal` 페이로드 안에 있다 (SPEC 18.2). `updateNode`는
  // 얕은 병합이라 페이로드를 통째로 넘겨야 cwd·tmuxSession이 날아가지 않는다.
  //
  // `agent`도 함께 준다 — 세션 id만 있고 어떤 에이전트인지 모르면 무엇으로 이어야
  // 할지 알 수 없으므로 버튼이 뜨지 않는다 (SPEC 21.4). 이 노드는 `command: null`로
  // 만들어서 agent가 추측되지 않는다.
  await bridge(
    `updateTerminal(${JSON.stringify(nodeId)}, { agentSessionId: 'sess-abc-123', agent: 'claude' })`
  )
  await sleep(500)
  const withSessionId = await evaluate(`(() =>
    [...document.querySelectorAll('.detached-button')].some((b) =>
      b.textContent.includes('이전 대화')
    ))()`)
  reporter.check(
    'agentSessionId가 있으면 [이전 대화 이어서]가 보인다 (SPEC 5.4)',
    withSessionId === true,
    `이어서 버튼=${withSessionId}`
  )

  // SPEC 21.4 — 세션 id가 있어도 에이전트를 모르면 이어서 실행할 수 없다.
  await bridge(`updateTerminal(${JSON.stringify(nodeId)}, { agent: null })`)
  await sleep(400)
  const withoutAgent = await evaluate(`(() =>
    [...document.querySelectorAll('.detached-button')].some((b) =>
      b.textContent.includes('이전 대화')
    ))()`)
  reporter.check(
    '에이전트를 모르면 [이전 대화 이어서]가 숨는다 (SPEC 21.4)',
    withoutAgent === false,
    `이어서 버튼=${withoutAgent}`
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
