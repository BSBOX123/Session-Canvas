#!/usr/bin/env node
/**
 * 단계 4 완료 기준 점검 (SPEC 12.1 / 14.3).
 *
 *   - 프롬프트 제출 → "작업 중", 권한 요청 → "입력 대기", 응답 종료 → "완료"
 *   - `SessionStart`의 session_id가 노드에 저장되는지 (SPEC 5.4 resume용)
 *   - 포커스하면 unseen이 풀리고 `done`이 `unknown`으로 내려가는지 (SPEC 8.1)
 *   - 앱 밖(노드 id 없음)에서 실행한 Claude Code에는 영향이 없는지 (SPEC 8.3)
 *
 * ⚠️ **사용자의 `~/.claude/settings.json`을 건드리지 않는다.** 훅은 점검용
 * 임시 폴더의 **프로젝트 설정**(`<temp>/.claude/settings.json`)으로만 등록한다.
 * 전역 설치 경로는 단위 테스트(`tests/hookInstaller.test.ts`)가 임시 HOME으로
 * 검증한다.
 *
 *   npm run verify:status
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
const SOCKET = 'session-canvas-check-status'
const HOOK = resolve(repoRoot, 'resources/hooks/session-canvas-hook.sh')

const projectDir = mkdtempSync(join(tmpdir(), 'session-canvas-status-'))
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

const stopWatchdog = watchdog(360, '단계 4 점검')
const reporter = createReporter('단계 4 상태 감지 점검')
let dev = null
let nodeId = null

try {
  if (await portInUse(options.port)) {
    throw new Error(`포트 ${options.port}에 이미 앱이 떠 있습니다. --port 로 다른 포트를 쓰세요.`)
  }
  killCheckServer()

  // 프로젝트 설정으로만 훅을 건다 — 전역 설정은 건드리지 않는다.
  await mkdir(join(projectDir, '.claude'), { recursive: true })
  const events = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'PermissionRequest',
    'Notification',
    'Stop',
    'StopFailure',
    'SessionEnd'
  ]
  await writeFile(
    join(projectDir, '.claude', 'settings.json'),
    JSON.stringify(
      {
        hooks: Object.fromEntries(
          events.map((event) => [
            event,
            [{ hooks: [{ type: 'command', command: HOOK, timeout: 5 }] }]
          ])
        )
      },
      null,
      2
    ),
    'utf8'
  )

  dev = startDevApp(launch)
  const client = await connect(await waitForPageTarget(options))
  const { evaluate } = client

  await waitForBridge(client)

  nodeId = await evaluate(`window.__sessionCanvas.addNode({
    cwd: ${JSON.stringify(projectDir)},
    title: '상태 점검',
    command: null,
    position: { x: 80, y: 80 }
  })`)

  const statusOf = () =>
    evaluate(`(window.__sessionCanvas.statuses[${JSON.stringify(nodeId)}] ?? null)`)
  const nodeOf = () =>
    evaluate(
      `(window.__sessionCanvas.nodes.find((n) => n.id === ${JSON.stringify(nodeId)}) ?? null)`
    )
  const write = (data) =>
    evaluate(`(window.api.pty.write(${JSON.stringify(nodeId)}, ${JSON.stringify(data)}), 1)`)
  const bufferText = () =>
    evaluate(`(() => {
      const t = window.__sessionCanvas.terminals[${JSON.stringify(nodeId)}]
      if (!t) return ''
      const b = t.buffer.active, out = []
      for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) out.push(l.translateToString(true)) }
      return out.join('\\n')
    })()`)

  // 셸이 준비될 때까지
  const shellDeadline = Date.now() + 30_000
  while ((await bufferText()).trim().length === 0) {
    if (Date.now() > shellDeadline) throw new Error('타임아웃: 셸 프롬프트')
    await sleep(300)
  }
  await sleep(1000)

  /**
   * 상태가 바뀔 때마다 기록한다. 마지막 상태만 보면 중간 단계를 놓친다.
   * 훅은 파일 하나를 덮어쓰므로, 짧게 스쳐 가는 상태는 못 볼 수도 있다 —
   * 그래서 사용자가 **답할 때까지 머무르는** 진짜 권한 프롬프트로 확인한다.
   */
  const seen = []
  let sessionId = null
  const poll = async () => {
    const status = await statusOf()
    if (status && seen.at(-1)?.state !== status.state) seen.push(status)
    const node = await nodeOf()
    if (node?.claudeSessionId) sessionId = node.claudeSessionId
    return status
  }
  const until = async (predicate, label, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      await poll()
      if (predicate()) return true
      if (Date.now() > deadline) return false
      await sleep(300)
    }
  }

  // `-p` 모드는 권한 요청이 즉시 거부돼 "입력 대기"가 스쳐 지나간다.
  // 대화형으로 띄워야 프롬프트가 남아 있고, 그게 실제 사용 모습이다.
  await write('claude\r')

  // 새 폴더에서는 "이 폴더를 신뢰합니까?"가 먼저 뜨고 **기본값이 "No, exit"** 다.
  // 그대로 두면 Claude Code가 켜지지도 않는다.
  const trustDeadline = Date.now() + 60_000
  for (;;) {
    const text = await bufferText()
    if (/trust this folder/i.test(text)) {
      await write('\u001b[B') // 아래 화살표: "Yes, I trust this folder"
      await sleep(400)
      await write('\r')
      break
    }
    if (seen.length > 0 || /Claude Code/.test(text)) break
    if (Date.now() > trustDeadline) break
    await poll()
    await sleep(500)
  }

  const started = await until(
    () => seen.some((s) => s.state !== 'detached'),
    'Claude Code 시작',
    90_000
  )
  if (!started) throw new Error('타임아웃: Claude Code가 시작되지 않았습니다')
  await sleep(3000)

  await write('Run the bash command: echo SC_STATUS_OK')
  await sleep(800)
  await write('\r')

  const sawWorking = await until(() => seen.some((s) => s.state === 'working'), '작업 중', 60_000)
  const sawWaiting = await until(() => seen.some((s) => s.state === 'waiting'), '입력 대기', 90_000)

  // 권한 프롬프트에 "예"로 답한다 (기본 선택).
  if (sawWaiting) {
    await write('\r')
    await sleep(500)
  }
  await until(() => seen.some((s) => s.state === 'done'), '완료', 90_000)

  // unseen 판정은 **세션이 살아 있는 동안** 해야 한다. `/exit`을 보내면
  // SessionEnd가 상태를 `unknown`으로 내려버려 다 지워진 뒤를 보게 된다.
  const doneStatus = seen.find((s) => s.state === 'done') ?? null
  const unseenOk = doneStatus?.unseen === true

  const currentIsDone = (await statusOf())?.state === 'done'
  if (currentIsDone) {
    await evaluate(`(window.__sessionCanvas.markSeen(${JSON.stringify(nodeId)}), 1)`)
    await sleep(300)
  }
  const afterSeen = currentIsDone ? await statusOf() : null

  // Claude Code를 닫는다.
  await write('\u001b')
  await sleep(300)
  await write('/exit\r')
  await sleep(1500)
  void sawWorking

  const states = seen.map((s) => s.state)
  const order = `관측 순서: ${states.join(' → ')}`
  reporter.check('프롬프트 제출 → 작업 중', states.includes('working'), order)
  reporter.check(
    '권한 요청 → 입력 대기',
    states.includes('waiting'),
    states.includes('waiting') ? 'PermissionRequest 수신' : '관측되지 않음'
  )
  reporter.check('응답 종료 → 완료', states.includes('done'), order)
  reporter.check(
    'SessionStart의 session_id가 노드에 저장됨 (SPEC 5.4)',
    typeof sessionId === 'string' && sessionId.length > 0,
    sessionId ?? '없음'
  )
  reporter.check('완료는 unseen 상태다 (SPEC 8.1)', unseenOk, `unseen=${doneStatus?.unseen}`)

  if (afterSeen === null) {
    reporter.skip(
      '포커스하면 unseen 해제 + done → unknown (SPEC 8.1)',
      '판정 시점에 done 상태가 아니었다 (다음 이벤트가 먼저 도착했다)'
    )
  } else {
    reporter.check(
      '포커스하면 unseen 해제 + done → unknown (SPEC 8.1)',
      afterSeen.unseen === false && afterSeen.state === 'unknown',
      `state=${afterSeen.state}, unseen=${afterSeen.unseen}`
    )
  }

  // 앱 밖에서 실행한 Claude Code에는 영향이 없어야 한다 (SPEC 8.3).
  const outsideId = 'outsidechk'
  await write(`env -u SESSION_CANVAS_NODE_ID sh -c 'echo "{}" | ${HOOK}'\r`)
  await sleep(1500)
  const outsideFile = join(homedir(), '.session-canvas', 'status', `${outsideId}.json`)
  const outsideExists = await import('node:fs/promises')
    .then((fs) => fs.stat(outsideFile))
    .then(() => true)
    .catch(() => false)
  reporter.check(
    '앱 밖 Claude Code에는 영향 없음 (SPEC 8.3)',
    !outsideExists,
    '노드 id 없이 실행하면 상태 파일을 만들지 않는다'
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
  await rm(projectDir, { recursive: true, force: true })
  // 점검이 만든 상태 파일만 지운다.
  if (nodeId) {
    await rm(join(homedir(), '.session-canvas', 'status', `${nodeId}.json`), { force: true })
  }
}
