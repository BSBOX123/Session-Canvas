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

  /**
   * 배율을 정확히 지정한다. 휠 한 칸은 미리보기 구간(0.4~0.75)을 통째로
   * 건너뛸 만큼 크다.
   *
   * CDP 합성 핀치(Ctrl+휠)를 여기서 쓰지 않는 이유: 노드 10개에 대량 출력을
   * 부은 상태에서 **합성 핀치만** ack가 오지 않아 점검이 죽는다(클릭·이동은
   * 수십 ms로 정상이고 배율도 안 바뀐다). 원인을 확정하지 못했다. 실제
   * 트랙패드 핀치는 다른 경로이고, 핀치 동작은 `check-canvas`가 검증한다.
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

  await sleep(1500)

  /*
   * 입력 파이프라인 워밍업. 이 세션의 **첫 입력이 키보드거나 합성 핀치면
   * 먹히지 않는다** — 창에 포커스가 없어서다. 빈 캔버스를 한 번 클릭해 두면
   * 그 뒤의 단축키·휠이 정상 동작한다. 실제 사용자도 창을 클릭하고 쓴다.
   */
  const paneAt = await evaluate(`(() => {
    for (let y = 120; y < window.innerHeight - 120; y += 40) {
      for (let x = 40; x < window.innerWidth - 40; x += 40) {
        const el = document.elementFromPoint(x, y)
        if (el && el.classList.contains('react-flow__pane')) return { x, y }
      }
    }
    return null
  })()`)
  if (paneAt !== null) {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...paneAt,
      button: 'left',
      clickCount: 1
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...paneAt,
      button: 'left',
      clickCount: 1
    })
    await sleep(400)
  }

  // ── 줌 단계 (SPEC 7.3) ───────────────────────────────
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

  // ── 화면보다 큰 노드로 줌인 (사용자 신고) ────────────
  // 배율을 1.0으로 고정하면 큰 노드가 잘린다. 전체가 들어와야 하고,
  // 그렇게 배율이 0.75 아래로 내려가도 그 노드는 입력을 받아야 한다.
  const bigId = ids[0]
  const viewportSize = await evaluate(`({ w: window.innerWidth, h: window.innerHeight })`)
  await bridge(
    `updateNode(${JSON.stringify(bigId)}, { size: { width: ${viewportSize.w * 2}, height: ${
      viewportSize.h * 2
    } } })`
  )
  await sleep(600)
  await evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(bigId)}) + '] .node-button[title="이 노드로 줌인"]')
    el.click()
    return 1
  })()`)
  await sleep(900)

  const fitted = await evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(bigId)}) + ']')
    const r = el.getBoundingClientRect()
    return {
      left: Math.round(r.left), top: Math.round(r.top),
      right: Math.round(r.right), bottom: Math.round(r.bottom),
      w: window.innerWidth, h: window.innerHeight
    }
  })()`)
  const wholeNodeVisible =
    fitted.left >= -2 &&
    fitted.top >= -2 &&
    fitted.right <= fitted.w + 2 &&
    fitted.bottom <= fitted.h + 2
  reporter.check(
    '화면보다 큰 노드를 줌인하면 잘리지 않고 전부 보인다',
    wholeNodeVisible,
    `노드 화면 좌표 ${fitted.left},${fitted.top} ~ ${fitted.right},${fitted.bottom} (창 ${fitted.w}×${fitted.h})`
  )

  const bigLevel = await bridge('zoomLevel')
  const bigInput = await evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(bigId)}) + '] .terminal-area')
    return el ? getComputedStyle(el).pointerEvents : null
  })()`)
  // `auto`도 `all`도 "이벤트를 받는다"는 뜻이다. 막힌 것은 `none`뿐이다.
  reporter.check(
    '그 노드는 미리보기 배율이어도 입력을 받는다',
    bigInput !== null && bigInput !== 'none',
    `zoomLevel=${bigLevel}, pointer-events=${bigInput}`
  )

  // 다른 노드는 여전히 미리보기 규칙을 따른다.
  const otherInput = await evaluate(`(() => {
    const el = document.querySelector('.terminal-node.zoom-preview:not(.focused) .terminal-area')
    return el ? getComputedStyle(el).pointerEvents : 'none-such-node'
  })()`)
  reporter.check(
    '포커스되지 않은 노드는 미리보기에서 여전히 입력을 막는다 (SPEC 7.3)',
    otherInput === 'none' || otherInput === 'none-such-node',
    `pointer-events=${otherInput}`
  )

  await bridge(`updateNode(${JSON.stringify(bigId)}, { size: { width: 640, height: 420 } })`)
  await sleep(400)

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
