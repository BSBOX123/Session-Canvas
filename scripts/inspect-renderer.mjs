#!/usr/bin/env node
/**
 * 렌더러 스모크 점검 (SPEC 14.3).
 *
 * 개발 앱을 CDP 원격 디버깅 포트와 함께 띄워, 살아 있는 페이지에 직접 물어본다:
 * 창이 떴는지, React가 마운트됐는지, 스타일이 먹었는지, preload 브리지가
 * 노출됐는지, 렌더러에 Node 접근이 없는지(SPEC 11), 콘솔 오류가 없는지.
 *
 *   npm run verify:renderer
 *   node scripts/inspect-renderer.mjs --attach      # 이미 떠 있는 앱에 붙기
 *   node scripts/inspect-renderer.mjs --keep        # 점검 후 앱을 끄지 않음
 *   node scripts/inspect-renderer.mjs --port 9333
 *   node scripts/inspect-renderer.mjs --verbose     # dev 로그 그대로 출력
 *
 * 모두 통과하면 0, 아니면 1로 끝난다.
 */
import {
  collectProblems,
  connect,
  createReporter,
  parseArgs,
  sleep,
  portInUse,
  startDevApp,
  stopDevApp,
  waitForPageTarget
} from './lib/cdp.mjs'

const options = parseArgs(process.argv.slice(2))
const READY_TIMEOUT_MS = 10_000

/** 페이지 안에서 평가할 식. JSON으로 직렬화할 수 있어야 한다. */
const PROBE = `JSON.stringify((() => {
  const terminals = (window.__sessionCanvas && window.__sessionCanvas.terminals) || {}
  const term = Object.values(terminals)[0]
  let terminal = null
  if (term) {
    const buffer = term.buffer.active
    const lines = []
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)
      const text = line ? line.translateToString(true) : ''
      if (text) lines.push(text)
    }
    terminal = {
      cols: term.cols,
      rows: term.rows,
      unicodeVersion: term.unicode.activeVersion,
      text: lines.join('\\n')
    }
  }
  return {
    title: document.title,
    rootChildren: document.querySelectorAll('#root > *').length,
    hasAppDiv: !!document.querySelector('div.app'),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    apiType: typeof window.api,
    requireType: typeof window.require,
    processType: typeof window.process,
    terminal
  }
})())`

/**
 * 고정 대기 대신 폴링한다. React가 마운트되고, PTY가 셸 프롬프트를 찍기까지
 * 시간이 걸린다. 둘 다 끝나면 바로 돌아온다.
 */
async function probeUntilReady(evaluate) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let snapshot
  while (Date.now() < deadline) {
    snapshot = JSON.parse(await evaluate(PROBE))
    const mounted = snapshot.rootChildren > 0
    const terminalReady = snapshot.terminal === null || snapshot.terminal.text.length > 0
    if (mounted && terminalReady) return snapshot
    await sleep(250)
  }
  return snapshot
}

function report(snapshot, problems, mainLog) {
  const reporter = createReporter('렌더러 점검')
  const s = snapshot ?? {}

  reporter.check('창이 떠 있고 렌더러가 로드됨', Boolean(s.title), `title="${s.title ?? ''}"`)
  reporter.check('React가 #root에 마운트됨', s.rootChildren > 0, `#root 자식 ${s.rootChildren}개`)
  reporter.check('App이 렌더됨 (div.app)', s.hasAppDiv === true, String(s.hasAppDiv))
  reporter.check('스타일 적용됨 (CSP가 막지 않음)', Boolean(s.bodyBackground), s.bodyBackground)
  reporter.check('preload 브리지 노출됨 (window.api)', s.apiType === 'object', s.apiType)
  reporter.check(
    '렌더러에 Node 접근 없음 (SPEC 11)',
    s.requireType === 'undefined' && s.processType === 'undefined',
    `require=${s.requireType}, process=${s.processType}`
  )
  reporter.check('콘솔 오류·CSP 위반 없음', problems.length === 0, `${problems.length}건`)

  if (mainLog === null) {
    reporter.skip('로그인 셸 환경 확보 (SPEC 4.4)', '--attach 모드: 확인 생략')
  } else {
    reporter.check(
      '로그인 셸 환경 확보 (SPEC 4.4)',
      /login env resolved, PATH entries: [1-9]/.test(mainLog),
      /PATH entries: \d+/.exec(mainLog)?.[0] ?? '로그 없음'
    )
  }

  // 터미널이 붙은 뒤(단계 1~)에만 확인한다.
  if (s.terminal) {
    const { cols, rows, unicodeVersion, text } = s.terminal
    reporter.check(
      'PTY가 열리고 셸 출력이 도착함 (node-pty)',
      text.length > 0,
      `${text.length}자 수신`
    )
    reporter.check('fit으로 크기가 잡힘', cols > 20 && rows > 5, `${cols}×${rows}`)
    reporter.check(
      'unicode11 활성화 (SPEC 6.1)',
      unicodeVersion === '11',
      `version ${unicodeVersion}`
    )
  }

  if (problems.length > 0) {
    console.log('\n  렌더러 로그:')
    for (const problem of problems) console.log(`    · ${problem}`)
  }
  return reporter.finish()
}

let dev = null
try {
  if (!options.attach) {
    if (await portInUse(options.port)) {
      throw new Error(
        `포트 ${options.port}에 이미 앱이 떠 있습니다. 그 앱을 점검하려면 --attach, ` +
          '새로 띄우려면 --port 로 다른 포트를 쓰세요.'
      )
    }
    dev = startDevApp(options)
  }

  const target = await waitForPageTarget(options)
  const client = await connect(target)

  // enable 이전에 난 오류는 오지 않는다. 켠 다음 reload해서 처음부터 다시 잡는다.
  await client.send('Log.enable')
  await client.send('Runtime.enable')
  await client.send('Page.enable')
  await client.send('Page.reload', { ignoreCache: true })
  await sleep(1500)

  const snapshot = await probeUntilReady(client.evaluate)
  const problems = collectProblems(client.events)
  client.close()

  process.exitCode = report(snapshot, problems, dev ? dev.mainLog.join('') : null) > 0 ? 1 : 0
} catch (error) {
  console.error(`\n❌ ${error.message}\n`)
  if (dev && !options.verbose) console.error(dev.mainLog.join(''))
  process.exitCode = 1
} finally {
  if (dev && !options.keep) stopDevApp(dev.child)
  else if (dev) console.log(`앱을 그대로 둡니다 (pid ${dev.child.pid}).`)
}
