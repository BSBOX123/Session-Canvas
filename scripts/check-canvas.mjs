#!/usr/bin/env node
/**
 * 단계 2 완료 기준 기능 점검 (SPEC 12.1 / 14.3).
 *
 *   - 노드 3개 이상이 동시에 살아 움직이는지 (각자 PTY, 입력이 섞이지 않는지)
 *   - 헤더 드래그로 움직이고, 터미널 영역 드래그로는 안 움직이는지 (SPEC 7.1)
 *   - 리사이즈 핸들 드래그 → fit → pty.resize 가 셸까지 (SPEC 7.1)
 *   - 캔버스를 팬/줌해도 터미널 내용이 유지되는지 (SPEC 6.4)
 *   - Esc / Shift+Tab 이 터미널에 그대로 전달되는지 (SPEC 7.5)
 *   - 노드를 닫으면 터미널과 PTY가 정리되는지
 *
 *   npm run verify:canvas
 *   node scripts/check-canvas.mjs --attach --port 9222
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
  waitForPageTarget
} from './lib/cdp.mjs'

const options = parseArgs(process.argv.slice(2))

// 점검이 실제 tmux 세션·워크스페이스를 건드리지 않게 격리한다 (SPEC 14.2).
const launch = {
  ...options,
  env: {
    SESSION_CANVAS_TMUX_SOCKET: 'session-canvas-check-canvas',
    // 로그인 셸이 "업데이트할까요?" 같은 질문으로 멈춰 서면 점검이 막힌다.
    DISABLE_AUTO_UPDATE: 'true',
    DISABLE_UPDATE_PROMPT: 'true'
  },
  electronArgs: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'session-canvas-check-'))}`]
}

/** 점검이 끝나면 남은 세션을 정리한다. */
function killCheckServer() {
  try {
    execFileSync('tmux', ['-L', 'session-canvas-check-canvas', 'kill-server'], { stdio: 'ignore' })
  } catch {
    /* 서버가 없으면 그만이다 */
  }
}

let dev = null
try {
  if (!options.attach) {
    if (await portInUse(options.port)) {
      throw new Error(
        `포트 ${options.port}에 이미 앱이 떠 있습니다. --attach 또는 --port 를 쓰세요.`
      )
    }
    dev = startDevApp(launch)
  }

  const client = await connect(await waitForPageTarget(options))
  const { evaluate, send } = client

  await waitForBridge(client)

  const term = (id) => `window.__sessionCanvas.terminals[${JSON.stringify(id)}]`
  const bufferOf = (id) =>
    evaluate(`(() => {
      const t = ${term(id)}
      if (!t) return null
      const b = t.buffer.active, out = []
      for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) out.push(l.translateToString(true)) }
      return out.join('\\n')
    })()`)
  const write = (id, data) =>
    evaluate(`(window.api.pty.write(${JSON.stringify(id)}, ${JSON.stringify(data)}), 1)`)

  const waitUntil = async (fn, label, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (await fn()) return
      if (Date.now() > deadline) throw new Error(`타임아웃: ${label}`)
      await sleep(200)
    }
  }

  const nodeRect = (id) =>
    evaluate(`(() => {
      const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(id)}) + ']')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)

  const drag = async (from, to, steps = 10) => {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: from.x,
      y: from.y,
      button: 'left',
      clickCount: 1
    })
    // React Flow의 nodeDragThreshold가 첫 이동을 삼킨다. 실제 마우스는 1px씩
    // 움직여 티가 안 나지만, 큰 걸음으로 뛰면 그 걸음이 통째로 사라진다.
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + 1,
      y: from.y + 1,
      button: 'left',
      buttons: 1
    })
    await sleep(30)
    for (let i = 1; i <= steps; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        button: 'left',
        buttons: 1
      })
      await sleep(16)
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: to.x,
      y: to.y,
      button: 'left',
      clickCount: 1
    })
    await sleep(300)
  }

  // ── 노드 3개 생성 ────────────────────────────────────
  const ids = []
  for (let i = 0; i < 3; i++) {
    ids.push(
      await evaluate(`window.__sessionCanvas.addNode({
        cwd: ${JSON.stringify(homedir())},
        title: ${JSON.stringify(`점검 ${i + 1}`)},
        command: null,
        position: { x: ${60 + i * 40}, y: ${60 + i * 40} }
      })`)
    )
  }
  await waitUntil(
    async () => (await Promise.all(ids.map(bufferOf))).every((b) => b && b.trim().length > 0),
    '노드 3개의 셸 프롬프트'
  )

  const reporter = createReporter('단계 2 캔버스 점검')
  reporter.check(
    '노드 3개가 동시에 살아 있음',
    (await evaluate('window.__sessionCanvas.nodes.length')) === 3,
    `${ids.length}개 생성, 모두 프롬프트 출력`
  )

  // ── 입력이 섞이지 않는지 ─────────────────────────────
  for (const [i, id] of ids.entries()) {
    await write(id, `echo NODE_MARK_${i}\r`)
  }
  await sleep(1500)
  const buffers = await Promise.all(ids.map(bufferOf))
  const isolated = buffers.every(
    (buf, i) =>
      buf.includes(`NODE_MARK_${i}`) &&
      ids.every((_, j) => j === i || !buf.includes(`NODE_MARK_${j}`))
  )
  reporter.check(
    '노드별 PTY가 독립적임 (입력이 섞이지 않음)',
    isolated,
    '각 노드가 자기 마커만 출력'
  )

  // ── 헤더 드래그 ──────────────────────────────────────
  const target = ids[0]
  const beforeDrag = await evaluate(
    `window.__sessionCanvas.nodes.find(n => n.id === ${JSON.stringify(target)}).position`
  )
  const rect = await nodeRect(target)
  await drag(
    { x: rect.x + rect.width / 2, y: rect.y + 12 },
    { x: rect.x + rect.width / 2 + 160, y: rect.y + 12 + 90 }
  )
  const afterDrag = await evaluate(
    `window.__sessionCanvas.nodes.find(n => n.id === ${JSON.stringify(target)}).position`
  )
  reporter.check(
    '헤더 드래그로 노드가 움직임 (SPEC 7.1)',
    Math.abs(afterDrag.x - beforeDrag.x - 160) < 12 &&
      Math.abs(afterDrag.y - beforeDrag.y - 90) < 12,
    `(${Math.round(beforeDrag.x)}, ${Math.round(beforeDrag.y)}) → (${Math.round(afterDrag.x)}, ${Math.round(afterDrag.y)})`
  )

  // ── 터미널 영역 드래그는 노드를 움직이면 안 된다 ─────
  const rect2 = await nodeRect(target)
  await drag(
    { x: rect2.x + rect2.width / 2, y: rect2.y + rect2.height - 40 },
    { x: rect2.x + rect2.width / 2 + 120, y: rect2.y + rect2.height - 40 }
  )
  const afterTermDrag = await evaluate(
    `window.__sessionCanvas.nodes.find(n => n.id === ${JSON.stringify(target)}).position`
  )
  reporter.check(
    '터미널 영역 드래그는 노드를 움직이지 않음 (nodrag)',
    Math.abs(afterTermDrag.x - afterDrag.x) < 2 && Math.abs(afterTermDrag.y - afterDrag.y) < 2,
    `위치 그대로 (${Math.round(afterTermDrag.x)}, ${Math.round(afterTermDrag.y)})`
  )

  // ── 캔버스 팬/줌 후에도 터미널 내용 유지 (SPEC 6.4) ──
  /** 노드·미니맵·컨트롤이 없는, 정말 빈 캔버스 지점을 찾는다. */
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

  const transform = () =>
    evaluate(`document.querySelector('.react-flow__viewport').style.transform`)
  const scaleOf = (t) => Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? 1)

  const beforePan = await bufferOf(target)
  const transformBefore = await transform()
  const pane = await emptyPoint()
  if (pane === null) throw new Error('빈 캔버스 지점을 찾지 못했습니다')

  // 빈 캔버스 위에서 두 손가락 스크롤 → 팬 (SPEC 7.4).
  // 우하단은 미니맵(zoomable)이라 피한다 — 거기서 굴리면 줌이 된다.
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: pane.x,
    y: pane.y,
    deltaX: 0,
    deltaY: 160
  })
  await sleep(500)
  const transformPanned = await transform()
  reporter.check(
    '두 손가락 스크롤 → 캔버스 팬 (SPEC 7.4)',
    transformPanned !== transformBefore && scaleOf(transformPanned) === scaleOf(transformBefore),
    `${transformBefore} → ${transformPanned}`
  )

  // 핀치(브라우저는 ctrlKey가 붙은 wheel로 전달한다) → 줌
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: pane.x,
    y: pane.y,
    deltaX: 0,
    deltaY: -120,
    modifiers: 2
  })
  await sleep(500)
  const transformZoomed = await transform()
  reporter.check(
    '핀치 → 캔버스 줌 (SPEC 7.4)',
    scaleOf(transformZoomed) !== scaleOf(transformPanned),
    `scale ${scaleOf(transformPanned)} → ${scaleOf(transformZoomed)}`
  )

  const afterPan = await bufferOf(target)
  reporter.check(
    '팬/줌해도 터미널 내용 유지 (SPEC 6.4)',
    afterPan === beforePan && afterPan.includes('NODE_MARK_0'),
    '버퍼 동일'
  )

  // 이후 좌표 계산이 틀어지지 않게 줌을 1로 되돌린다.
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: pane.x,
    y: pane.y,
    deltaX: 0,
    deltaY: 120,
    modifiers: 2
  })
  await sleep(500)

  // ── Esc / Shift+Tab 전달 (SPEC 7.5) ──────────────────
  await evaluate(`(${term(target)}.focus(), 1)`)
  await write(target, 'cat -v\r')
  await sleep(800)
  const key = async (code, k, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      code,
      key: k,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers
    })
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      code,
      key: k,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers
    })
    await sleep(400)
  }
  await key('Escape', 'Escape', 27)
  await key('Tab', 'Tab', 9, 8) // modifiers 8 = Shift
  await sleep(600)
  const catBuffer = await bufferOf(target)
  const sawEsc = catBuffer.includes('^[')
  const sawShiftTab = catBuffer.includes('^[[Z')
  reporter.check(
    'Esc가 터미널로 전달됨 (SPEC 7.5)',
    sawEsc,
    sawEsc ? 'cat -v 가 ^[ 를 받음' : '받지 못함'
  )
  reporter.check(
    'Shift+Tab이 터미널로 전달됨 (SPEC 7.5)',
    sawShiftTab,
    sawShiftTab ? 'cat -v 가 ^[[Z 를 받음' : '받지 못함'
  )
  await write(target, '\u0003') // Ctrl+C
  await sleep(300)

  // ── 리사이즈 핸들 드래그 ─────────────────────────────
  const headerRect = await nodeRect(target)
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: headerRect.x + 60,
    y: headerRect.y + 12,
    button: 'left',
    clickCount: 1
  })
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: headerRect.x + 60,
    y: headerRect.y + 12,
    button: 'left',
    clickCount: 1
  })
  await sleep(400)
  const selected = await evaluate(
    `document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(target)}) + ']').classList.contains('selected')`
  )
  reporter.check(
    '노드 클릭 → 선택됨 (리사이즈 핸들 표시 조건)',
    selected === true,
    `selected=${selected}`
  )

  const beforeResize = await evaluate(
    `({ cols: ${term(target)}.cols, rows: ${term(target)}.rows })`
  )
  const handleRect = await evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(target)}) + '] .react-flow__resize-control.bottom.right')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })()`)
  if (handleRect) {
    await drag(handleRect, { x: handleRect.x - 220, y: handleRect.y - 120 })
    await sleep(800)
    const afterResize = await evaluate(
      `({ cols: ${term(target)}.cols, rows: ${term(target)}.rows })`
    )
    await write(target, 'tput cols\r')
    await sleep(1200)
    // `tput cols` 출력은 프롬프트 사이에 끼어 있다. 마지막 숫자만 줄만 고른다.
    const shellCols =
      (await bufferOf(target))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line))
        .pop() ?? ''
    reporter.check(
      '리사이즈 핸들 드래그 → fit → pty.resize (SPEC 7.1)',
      afterResize.cols < beforeResize.cols && shellCols === String(afterResize.cols),
      `${beforeResize.cols}×${beforeResize.rows} → ${afterResize.cols}×${afterResize.rows}, 셸 cols=${shellCols}`
    )
  } else {
    reporter.check(
      '리사이즈 핸들 드래그 → fit → pty.resize (SPEC 7.1)',
      false,
      '리사이즈 핸들을 찾지 못했습니다'
    )
  }

  // ── 노드 닫기 ────────────────────────────────────────
  const closing = ids[2]
  await evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(closing)}) + ']')
    const close = [...el.querySelectorAll('.node-button')].find((b) => b.textContent.trim() === '×')
    close.click()
    return 1
  })()`)
  await sleep(300)
  await evaluate(`(() => {
    const el = document.querySelector('.react-flow__node[data-id=' + JSON.stringify(${JSON.stringify(closing)}) + ']')
    // 단계 3부터 닫기는 "분리"다 — tmux 세션은 살아남는다 (SPEC 5.3).
    const confirm = [...el.querySelectorAll('.node-button')].find((b) =>
      b.textContent.includes('분리')
    )
    confirm.click()
    return 1
  })()`)
  await sleep(600)
  const remaining = await evaluate('window.__sessionCanvas.nodes.length')
  const terminalGone = (await evaluate(`!${term(closing)}`)) === true
  reporter.check(
    '노드 닫기 → 노드와 터미널 정리됨',
    remaining === 2 && terminalGone,
    `노드 ${remaining}개 남음, 터미널 해제됨=${terminalGone}`
  )

  client.close()
  process.exitCode = reporter.finish() > 0 ? 1 : 0
} catch (error) {
  console.error(`\n❌ ${error.message}\n`)
  if (dev && !options.verbose) console.error(dev.mainLog.join(''))
  process.exitCode = 1
} finally {
  killCheckServer()
  if (dev && !options.keep) stopDevApp(dev.child)
  else if (dev) console.log(`앱을 그대로 둡니다 (pid ${dev.child.pid}).`)
}
