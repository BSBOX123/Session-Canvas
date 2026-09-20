#!/usr/bin/env node
/**
 * 단계 1 완료 기준 기능 점검 (SPEC 12.1 / 14.3).
 *
 * 살아 있는 터미널에 CDP로 실제 키 이벤트와 IME 조합 이벤트를 넣고, xterm
 * 버퍼를 직접 읽어 결과를 판정한다. 확인 항목:
 *   - 키보드 입력이 PTY까지 전달되는지 (xterm → IPC → node-pty)
 *   - 한글 출력과 전각 폭 계산 (unicode11, SPEC 6.1)
 *   - 한글 IME 조합 입력 (SPEC 13 R3)
 *   - 트루컬러 24bit
 *   - 창 리사이즈 → fit → pty.resize 가 셸까지 도달하는지
 *   - 로그인 셸 PATH로 claude를 찾는지 (SPEC 4.4)
 *   - vim 같은 전체화면 TUI
 *
 *   npm run verify:terminal
 *   node scripts/check-terminal.mjs --attach --port 9222
 *
 * 모두 통과하면 0, 아니면 1로 끝난다.
 */
import {
  connect,
  createReporter,
  parseArgs,
  portInUse,
  sleep,
  startDevApp,
  stopDevApp,
  waitForPageTarget
} from './lib/cdp.mjs'

const options = parseArgs(process.argv.slice(2))
const NODE_ID = 'main'
const TERM = `window.__sessionCanvas.terminals[${JSON.stringify(NODE_ID)}]`

let dev = null
try {
  if (!options.attach) {
    if (await portInUse(options.port)) {
      throw new Error(
        `포트 ${options.port}에 이미 앱이 떠 있습니다. --attach 또는 --port 를 쓰세요.`
      )
    }
    dev = startDevApp(options)
  }

  const client = await connect(await waitForPageTarget(options))
  const { evaluate, send } = client

  const bufferText = () =>
    evaluate(`(() => {
      const b = ${TERM}.buffer.active, out = []
      for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) out.push(l.translateToString(true)) }
      return out.join('\\n')
    })()`)
  const cursorX = () => evaluate(`${TERM}.buffer.active.cursorX`)
  const write = (data) =>
    evaluate(`(window.api.pty.write(${JSON.stringify(NODE_ID)}, ${JSON.stringify(data)}), 1)`)
  const clearLine = async () => {
    await write('\u0015') // Ctrl+U
    await sleep(300)
  }

  const waitFor = async (predicate, label, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const text = await bufferText()
      if (predicate(text)) return text
      await sleep(200)
    }
    throw new Error(`타임아웃: ${label}`)
  }

  /** 마커로 감싸 실행하고 마커 사이 출력만 돌려준다. */
  let seq = 0
  const run = async (command) => {
    const tag = `SCM${++seq}`
    await write(`clear; echo ${tag}_S; ${command}; echo ${tag}_E\r`)
    const text = await waitFor(
      (t) => t.includes(`${tag}_E`) && !t.includes(`echo ${tag}_S`),
      command
    )
    return text
      .slice(text.indexOf(`${tag}_S`) + tag.length + 2, text.lastIndexOf(`${tag}_E`))
      .trim()
  }

  const key = async (text, code, k, vk) => {
    const base = { code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text, ...base })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  // 렌더러가 터미널을 만들 때까지 기다린다. 앱이 막 뜬 직후에는 아직 없다.
  const terminalDeadline = Date.now() + 30_000
  for (;;) {
    const ready = await evaluate(
      `!!(window.__sessionCanvas && window.__sessionCanvas.terminals && ${TERM})`
    )
    if (ready) break
    if (Date.now() > terminalDeadline) throw new Error('타임아웃: 터미널이 만들어지지 않았습니다')
    await sleep(250)
  }

  // 셸이 프롬프트를 찍을 때까지 기다린다.
  await waitFor((t) => t.trim().length > 0, '셸 프롬프트')
  const reporter = createReporter('단계 1 터미널 점검')

  // 1. 키보드 입력 경로 (xterm → IPC → node-pty)
  await evaluate(`(${TERM}.focus(), 1)`)
  await clearLine()
  await key('l', 'KeyL', 'l', 76)
  await key('s', 'KeyS', 's', 83)
  await key('\r', 'Enter', 'Enter', 13)
  const lsText = await waitFor((t) => /Applications|Documents|Downloads/.test(t), '키보드 ls')
  const lsLine = lsText.split('\n').find((l) => /Applications|Documents/.test(l)) ?? ''
  reporter.check('키보드 입력이 PTY에 전달됨 (ls)', lsLine.length > 0, lsLine.trim().slice(0, 52))

  // 2. 한글 출력
  const hangul = await run(`echo '한글 출력 테스트 가나다라'`)
  reporter.check('한글 출력', hangul.includes('한글 출력 테스트 가나다라'), JSON.stringify(hangul))

  // 3. 전각 폭 계산 — 커서가 몇 칸 움직이는지로 본다.
  const advance = async (text) => {
    await clearLine()
    const before = await cursorX()
    await write(text)
    await sleep(600)
    const after = await cursorX()
    await clearLine()
    return after - before
  }
  const ascii = await advance('abc')
  const wide = await advance('가나다')
  reporter.check(
    '전각 문자 폭 계산 (unicode11, SPEC 6.1)',
    ascii === 3 && wide === 6,
    `abc=${ascii}칸, 가나다=${wide}칸`
  )

  // 4. 한글 IME 조합 입력 (SPEC 13 R3)
  await evaluate(`(${TERM}.focus(), 1)`)
  await clearLine()
  for (const text of ['ㅎ', '하', '한']) {
    await send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length
    })
  }
  await send('Input.insertText', { text: '한글' })
  await sleep(800)
  const imeLine = await evaluate(
    `(() => { const b = ${TERM}.buffer.active; return b.getLine(b.cursorY).translateToString(true) })()`
  )
  const imeCount = (imeLine.match(/한글/g) ?? []).length
  reporter.check(
    '한글 IME 조합 입력 (SPEC 13 R3)',
    imeCount === 1,
    `조합 후 "한글" ${imeCount}회 (중복·누락 없이 1회여야 함)`
  )
  await clearLine()

  // 5. 트루컬러
  await run(`printf '\\033[38;2;255;100;0mTRUECOLOR\\033[0m\\n'`)
  const color = await evaluate(`(() => {
    const b = ${TERM}.buffer.active
    for (let i = b.length - 1; i >= 0; i--) {
      const line = b.getLine(i); if (!line) continue
      const text = line.translateToString(true)
      const col = text.indexOf('TRUECOLOR')
      if (col !== -1) { const cell = line.getCell(col); return { rgb: cell.isFgRGB(), color: cell.getFgColor() } }
    }
    return null
  })()`)
  reporter.check(
    '트루컬러 (24bit RGB)',
    color?.rgb === true && color.color === 0xff6400,
    `isFgRGB=${color?.rgb}, color=#${color?.color?.toString(16)}`
  )

  // 6. 리사이즈 → fit → pty.resize 가 셸까지
  const before = await evaluate(`({ cols: ${TERM}.cols, rows: ${TERM}.rows })`)
  await evaluate(`(document.querySelector('.app').style.width = '700px', 1)`)
  await sleep(1200)
  const after = await evaluate(`({ cols: ${TERM}.cols, rows: ${TERM}.rows })`)
  const shellCols = await run('tput cols')
  reporter.check(
    '리사이즈 → xterm cols 변경',
    after.cols < before.cols,
    `${before.cols}×${before.rows} → ${after.cols}×${after.rows}`
  )
  reporter.check(
    '리사이즈 → PTY까지 전달됨 (tput cols)',
    Number(shellCols.trim()) === after.cols,
    `셸이 보는 cols=${shellCols.trim()}, xterm cols=${after.cols}`
  )
  await evaluate(`(document.querySelector('.app').style.width = '', 1)`)
  await sleep(1000)

  // 7. 로그인 셸 PATH로 claude를 찾는지 (SPEC 4.4)
  const claudeVersion = await run('claude --version 2>&1 | head -1')
  reporter.check(
    'claude 실행 가능 (PATH 해석, SPEC 4.4)',
    /\d+\.\d+/.test(claudeVersion),
    claudeVersion.trim()
  )

  // 8. 전체화면 TUI
  await write('vim\r')
  await sleep(2500)
  const vimText = await bufferText()
  reporter.check(
    'vim 실행 (대체 화면 TUI)',
    /VIM|~/.test(vimText),
    vimText.split('\n').filter(Boolean)[0]?.trim().slice(0, 40) ?? ''
  )
  await write('\u001b:q!\r')
  await sleep(800)

  client.close()
  process.exitCode = reporter.finish() > 0 ? 1 : 0
} catch (error) {
  console.error(`\n❌ ${error.message}\n`)
  if (dev && !options.verbose) console.error(dev.mainLog.join(''))
  process.exitCode = 1
} finally {
  if (dev && !options.keep) stopDevApp(dev.child)
  else if (dev) console.log(`앱을 그대로 둡니다 (pid ${dev.child.pid}).`)
}
