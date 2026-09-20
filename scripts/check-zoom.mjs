#!/usr/bin/env node
/**
 * 단계 5 완료 기준 점검 (SPEC 12.1 / 14.3).
 *
 *   - 줌 단계 전환: 상세 / 미리보기(입력 불가) / 개요(터미널 숨김) — SPEC 7.3
 *   - WebGL 컨텍스트가 `webglMax`를 넘지 않는지 — SPEC 6.3 / R6
 *   - 노드 10개에서 대량 출력·타이핑이 버티는지 — R7
 *   - 단축키 (`Cmd+0`, `Cmd+1..9`, `Cmd+J`, `Cmd+Enter`, `Cmd+W`, `Cmd+=`) — SPEC 7.5
 *
 *   npm run verify:zoom
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  connect,
  createReporter,
  parseArgs,
  portInUse,
  sleep,
  startDevApp,
  stopDevApp,
  waitForBridge,
  waitForPageTarget,
  watchdog
} from './lib/cdp.mjs'

const options = parseArgs(process.argv.slice(2))
const SOCKET = 'session-canvas-check-zoom'
const NODE_COUNT = 10

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

const stopWatchdog = watchdog(420, '단계 5 점검')
const reporter = createReporter('단계 5 줌 단계 · 성능 점검')
let dev = null

try {
  if (await portInUse(options.port)) {
    throw new Error(`포트 ${options.port}에 이미 앱이 떠 있습니다. --port 로 다른 포트를 쓰세요.`)
  }
  killCheckServer()

  dev = startDevApp(launch)
  const client = await connect(await waitForPageTarget(options))
  const { evaluate, send } = client
  await waitForBridge(client)

  const bridge = (expr) => evaluate(`window.__sessionCanvas.${expr}`)

  /** 노드·미니맵·컨트롤이 없는 빈 캔버스 지점 (거기서 굴려야 캔버스가 받는다). */
  const emptyPoint = () =>
    evaluate(`(() => {
      for (let y = 120; y < window.innerHeight - 120; y += 40) {
        for (let x = 40; x < window.innerWidth - 40; x += 40) {
          const el = document.elementFromPoint(x, y)
          if (el && el.classList.contains('react-flow__pane')) return { x, y }
        }
      }
      return null
    })()`)

  /** 핀치(= ctrlKey가 붙은 wheel)로 줌을 바꾼다. UI 경로 그대로 확인한다. */
  const pinch = async (direction, times = 1) => {
    const pane = await emptyPoint()
    if (pane === null) throw new Error('빈 캔버스 지점을 찾지 못했습니다')
    for (let i = 0; i < times; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: pane.x,
        y: pane.y,
        deltaX: 0,
        deltaY: direction === 'in' ? -120 : 120,
        modifiers: 2
      })
      await sleep(250)
    }
  }

  /**
   * 배율을 정확히 지정한다. 휠 한 칸은 미리보기 구간(0.4~0.75)을 통째로
   * 건너뛸 만큼 커서, 단계별 동작을 확인하려면 배율을 직접 줘야 한다.
   * (핀치 경로 자체는 아래에서 따로 확인한다.)
   */
  const setZoom = async (zoom) => {
    await bridge(`zoomTo(${zoom})`)
    await sleep(400)
  }

  const key = async (code, k, vk, modifiers = 4) => {
    const base = { code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
    await sleep(500)
  }

  const viewportZoom = () =>
    evaluate(`(() => {
      const t = document.querySelector('.react-flow__viewport').style.transform
      return Number(/scale\\(([\\d.]+)\\)/.exec(t)?.[1] ?? 1)
    })()`)

  // ── 노드 10개 ────────────────────────────────────────
  const ids = []
  for (let i = 0; i < NODE_COUNT; i++) {
    ids.push(
      await bridge(`addNode({
        cwd: ${JSON.stringify(homedir())},
        title: ${JSON.stringify(`점검 ${i + 1}`)},
        command: null,
        position: { x: ${(i % 5) * 700}, y: ${Math.floor(i / 5) * 500} }
      })`)
    )
  }

  const terminalsReady = async () =>
    (await evaluate(`Object.keys(window.__sessionCanvas.terminals).length`)) === NODE_COUNT
  const readyDeadline = Date.now() + 90_000
  while (!(await terminalsReady())) {
    if (Date.now() > readyDeadline) throw new Error('타임아웃: 노드 10개가 준비되지 않았습니다')
    await sleep(500)
  }
  reporter.check('노드 10개가 동시에 살아 있음', true, `${NODE_COUNT}개 터미널`)

  // ── WebGL 개수 제한 (SPEC 6.3 / R6) ──────────────────
  const webgl = await bridge('webglNodes')
  reporter.check(
    'WebGL이 webglMax(4)개를 넘지 않는다 (SPEC 6.3 / R6)',
    webgl.length <= 4,
    `WebGL 노드 ${webgl.length}개 / 터미널 ${NODE_COUNT}개`
  )

  // 포커스를 옮기면 WebGL도 따라온다.
  await bridge(`focus(${JSON.stringify(ids[9])})`)
  await sleep(400)
  const afterFocus = await bridge('webglNodes')
  reporter.check(
    '포커스한 노드가 WebGL을 갖는다',
    afterFocus.includes(ids[9]) && afterFocus.length <= 4,
    `WebGL: ${afterFocus.length}개, 포커스 포함=${afterFocus.includes(ids[9])}`
  )

  // ── 대량 출력 (R7) ───────────────────────────────────
  const heavyStart = Date.now()
  for (const id of ids.slice(0, 3)) {
    await evaluate(
      `(window.api.pty.write(${JSON.stringify(id)}, ${JSON.stringify('seq 1 20000\r')}), 1)`
    )
  }
  await sleep(6000)
  const responsive = await evaluate(`(() => {
    const t0 = performance.now()
    document.querySelector('.react-flow__pane').getBoundingClientRect()
    return performance.now() - t0
  })()`)
  const heavyElapsed = Date.now() - heavyStart
  reporter.check(
    '대량 출력 중에도 렌더러가 살아 있다 (R7)',
    responsive < 200,
    `노드 3개에 20000줄, 레이아웃 질의 ${responsive.toFixed(1)}ms (${heavyElapsed}ms 경과)`
  )

  // 출력이 끝난 뒤 입력이 여전히 전달되는지
  await evaluate(
    `(window.api.pty.write(${JSON.stringify(ids[0])}, ${JSON.stringify('echo AFTER_HEAVY\r')}), 1)`
  )
  const typedDeadline = Date.now() + 20_000
  let typedOk = false
  while (Date.now() < typedDeadline) {
    const text = await evaluate(`(() => {
      const t = window.__sessionCanvas.terminals[${JSON.stringify(ids[0])}]
      const b = t.buffer.active, out = []
      for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) out.push(l.translateToString(true)) }
      return out.join('\\n')
    })()`)
    if (text.includes('AFTER_HEAVY')) {
      typedOk = true
      break
    }
    await sleep(400)
  }
  reporter.check(
    '대량 출력 뒤에도 입력이 전달된다 (R7)',
    typedOk,
    typedOk ? 'echo 결과 확인' : '응답 없음'
  )

  // ── 줌 단계 (SPEC 7.3) ───────────────────────────────
  // 핀치로 실제 줌이 바뀌고 단계가 따라오는지 먼저 본다.
  const levelBefore = await bridge('zoomLevel')
  await pinch('out', 2)
  const levelAfterPinch = await bridge('zoomLevel')
  reporter.check(
    '핀치로 줌 단계가 바뀐다 (SPEC 7.3/7.4)',
    levelAfterPinch !== levelBefore,
    `${levelBefore} → ${levelAfterPinch}`
  )

  await setZoom(0.6)
  const toPreview = (await bridge('zoomLevel')) === 'preview'
  reporter.check('0.6 배율 → 미리보기 단계', toPreview, `zoomLevel=${await bridge('zoomLevel')}`)

  const previewBlocksInput = await evaluate(`(() => {
    const area = document.querySelector('.terminal-node.zoom-preview .terminal-area')
    if (!area) return null
    return getComputedStyle(area).pointerEvents
  })()`)
  reporter.check(
    '미리보기 단계는 터미널 입력을 받지 않는다 (SPEC 7.3)',
    previewBlocksInput === 'none',
    `pointer-events=${previewBlocksInput}`
  )

  // 전체 보기로 개요 단계에 들어간다(배율 ~0.34). 배율만 낮추면 노드가
  // 화면 밖으로 밀려나 "카드를 클릭한다"를 확인할 수 없다.
  await key('Digit0', '0', 48)
  await sleep(500)
  const toOverview = (await bridge('zoomLevel')) === 'overview'
  const overview = await evaluate(`(() => ({
    cards: document.querySelectorAll('.node-overview').length,
    terminals: document.querySelectorAll('.terminal-area').length,
    title: document.querySelector('.node-overview-title')?.textContent ?? null,
    status: document.querySelector('.node-overview-status')?.textContent?.trim() ?? null
  }))()`)
  reporter.check(
    '개요 단계는 터미널을 숨기고 제목·상태만 보여준다 (SPEC 7.3)',
    toOverview && overview.cards > 0 && overview.terminals === 0,
    `카드 ${overview.cards}개, 터미널 ${overview.terminals}개, "${overview.title}" / ${overview.status}`
  )

  // 개요에서 노드를 클릭하면 줌인된다.
  // 화면 안에 실제로 보이는 카드를 고른다. 축소하면 첫 노드가 화면 밖으로
  // 나가 있을 수 있고, 그 좌표로 클릭을 쏘면 아무 데도 닿지 않는다.
  const cardPoint = await evaluate(`(() => {
    for (const el of document.querySelectorAll('.react-flow__node')) {
      const r = el.getBoundingClientRect()
      const x = r.x + r.width / 2
      const y = r.y + r.height / 2
      if (x > 20 && y > 40 && x < window.innerWidth - 20 && y < window.innerHeight - 20) {
        return { x, y }
      }
    }
    return null
  })()`)
  if (cardPoint === null) throw new Error('화면 안에 보이는 노드 카드가 없습니다')
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...cardPoint,
    button: 'left',
    clickCount: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...cardPoint,
    button: 'left',
    clickCount: 1
  })
  await sleep(700)
  reporter.check(
    '개요에서 노드를 클릭하면 줌인된다 (SPEC 7.3)',
    (await bridge('zoomLevel')) === 'detail',
    `zoomLevel=${await bridge('zoomLevel')}, scale=${(await viewportZoom()).toFixed(2)}`
  )

  // ── 단축키 (SPEC 7.5) ────────────────────────────────
  await key('Digit0', '0', 48)
  const fitZoom = await viewportZoom()
  reporter.check('Cmd+0 전체 보기', fitZoom < 1, `scale=${fitZoom.toFixed(2)}`)

  await key('Digit2', '2', 50)
  const focusedAfter2 = await bridge('focusedNode')
  reporter.check(
    'Cmd+2 → 두 번째 노드로 줌인·포커스',
    focusedAfter2 === ids[1] && (await viewportZoom()) > 0.9,
    `focused=${focusedAfter2 === ids[1] ? '2번 노드' : focusedAfter2}`
  )

  // Cmd+Enter 토글: 줌인 ↔ 직전 뷰
  await key('Digit0', '0', 48)
  const beforeToggle = await viewportZoom()
  await bridge(`focus(${JSON.stringify(ids[3])})`)
  await key('Enter', 'Enter', 13)
  const zoomedIn = await viewportZoom()
  await key('Enter', 'Enter', 13)
  const backAgain = await viewportZoom()
  reporter.check(
    'Cmd+Enter 줌인 ↔ 직전 뷰 토글 (SPEC 7.5)',
    zoomedIn > beforeToggle && Math.abs(backAgain - beforeToggle) < 0.05,
    `${beforeToggle.toFixed(2)} → ${zoomedIn.toFixed(2)} → ${backAgain.toFixed(2)}`
  )

  await bridge(`focus(${JSON.stringify(ids[0])})`)
  const fontBefore = await evaluate(
    `window.__sessionCanvas.terminals[${JSON.stringify(ids[0])}].options.fontSize`
  )
  await key('Equal', '=', 187)
  const fontAfter = await evaluate(
    `window.__sessionCanvas.terminals[${JSON.stringify(ids[0])}].options.fontSize`
  )
  reporter.check(
    'Cmd+= 글자 크기 키우기 (SPEC 7.5)',
    fontAfter === fontBefore + 1,
    `${fontBefore} → ${fontAfter}`
  )

  // Cmd+W: 닫기(분리)
  const beforeClose = (await bridge('nodes')).length
  await bridge(`focus(${JSON.stringify(ids[8])})`)
  await key('KeyW', 'w', 87)
  const afterClose = (await bridge('nodes')).length
  reporter.check(
    'Cmd+W 노드 닫기(분리) (SPEC 7.5)',
    afterClose === beforeClose - 1,
    `${beforeClose} → ${afterClose}개`
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
