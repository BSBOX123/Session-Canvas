#!/usr/bin/env node
/**
 * 단계 8 완료 기준 점검 (SPEC 19 단계 8 / 14.3).
 *
 *   - 작업 기록 패널이 열리고 캔버스를 **덮지 않고 밀어내는지**
 *   - 포커스한 노드의 기록을 보여 주는지
 *   - git이 본 변경 파일이 뜨는지 (R20 — 셸로 고쳐도 잡혀야 한다)
 *   - 저장소가 아닌 노드를 "git 저장소 아님"으로 처리하는지
 *   - transcript가 없을 때 **"못 읽음"과 "비어 있음"을 구별**하는지 (SPEC 16.3)
 *   - 빈 제목만 자동으로 채우고 사용자 제목은 건드리지 않는지
 *
 *   npm run verify:worklog
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
const SOCKET = 'session-canvas-check-worklog'

const launch = {
  ...options,
  env: { SESSION_CANVAS_TMUX_SOCKET: SOCKET },
  electronArgs: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'session-canvas-check-'))}`]
}

const killCheckServer = () => {
  try {
    execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' })
  } catch {
    /* 없으면 그만 */
  }
}

/** git 저장소 하나를 만들고 **셸로** 파일을 고친다 (R20 재현). */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'session-canvas-wl-repo-'))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'check@example.com')
  git('config', 'user.name', 'check')
  writeFileSync(join(dir, 'a.txt'), 'hello\n', 'utf8')
  git('add', '.')
  git('commit', '-q', '-m', 'init', '--no-verify')
  // 커밋 뒤에 고친다 — Edit 도구가 아니라 셸이 고친 것이다.
  writeFileSync(join(dir, 'a.txt'), 'changed\n', 'utf8')
  writeFileSync(join(dir, '새 파일.txt'), 'x\n', 'utf8')
  return dir
}

const reporter = createReporter('단계 8 작업 기록 점검')
let dev = null

try {
  if (await portInUse(options.port)) {
    throw new Error(`포트 ${options.port}에 이미 앱이 떠 있습니다. --port 로 다른 포트를 쓰세요.`)
  }
  killCheckServer()

  const repo = makeRepo()
  const plain = mkdtempSync(join(tmpdir(), 'session-canvas-wl-plain-'))
  mkdirSync(join(plain, 'sub'), { recursive: true })

  dev = startDevApp(launch)
  const client = await connect(await waitForPageTarget(options))
  const { evaluate } = client
  await waitForBridge(client)

  const bridge = (expr) => evaluate(`window.__sessionCanvas.${expr}`)

  // 저장소 노드와 저장소 아닌 노드를 하나씩.
  const repoNode = await bridge(`addNode({
    cwd: ${JSON.stringify(repo)}, title: '', command: null, position: { x: 60, y: 60 }
  })`)
  const plainNode = await bridge(`addNode({
    cwd: ${JSON.stringify(plain)}, title: '내가 쓴 제목', command: null, position: { x: 760, y: 60 }
  })`)
  await sleep(1500)

  // ── 패널 열기 ──────────────────────────────────────
  await evaluate(`(document.querySelector('.worklog-open')?.click(), 1)`)
  await sleep(400)
  const layout = await evaluate(`(() => {
    const panel = document.querySelector('.worklog')
    const flow = document.querySelector('.react-flow')
    if (!panel || !flow) return null
    const p = panel.getBoundingClientRect(), f = flow.getBoundingClientRect()
    return { panelLeft: Math.round(p.left), flowRight: Math.round(f.right), width: Math.round(p.width) }
  })()`)
  reporter.check(
    '작업 기록 패널이 열린다',
    layout !== null && layout.width > 200,
    layout === null ? '패널 없음' : `너비 ${layout.width}px`
  )
  // SPEC 15.2 — 덮으면 그 아래 노드를 못 쓴다. 밀어내야 한다.
  reporter.check(
    '패널이 캔버스를 덮지 않고 밀어낸다',
    layout !== null && layout.flowRight <= layout.panelLeft + 2,
    layout === null ? '-' : `캔버스 우단 ${layout.flowRight} ≤ 패널 좌단 ${layout.panelLeft}`
  )

  // ── 저장소 노드: git 변경 (R20) ─────────────────────
  await bridge(`focus(${JSON.stringify(repoNode)})`)
  await sleep(1800)
  const repoView = await evaluate(`(() => {
    const files = [...document.querySelectorAll('.worklog-file-path')].map((e) => e.textContent)
    const head = document.querySelector('.worklog-head h2')?.textContent ?? ''
    return { files, head, note: document.querySelector('.worklog-note')?.textContent ?? null }
  })()`)
  reporter.check(
    '셸로 고친 파일이 변경 목록에 뜬다 (R20)',
    repoView.files.includes('a.txt'),
    repoView.files.join(', ') || '(없음)'
  )
  reporter.check(
    '한글 파일명도 그대로 뜬다',
    repoView.files.some((f) => f.includes('새 파일.txt')),
    repoView.files.join(', ') || '(없음)'
  )
  // SPEC 16.3 — 기록이 없는 것과 못 읽은 것은 다르다.
  reporter.check(
    'transcript가 없으면 "못 읽음"을 알려 준다 (SPEC 16.3)',
    typeof repoView.note === 'string' && repoView.note.includes('읽지 못했습니다'),
    repoView.note ?? '(안내 없음)'
  )

  // ── 저장소 아닌 노드 ────────────────────────────────
  await bridge(`focus(${JSON.stringify(plainNode)})`)
  await sleep(1800)
  const plainView = await evaluate(`(() => ({
    counts: [...document.querySelectorAll('.worklog-count')].map((e) => e.textContent),
    head: document.querySelector('.worklog-head h2')?.textContent ?? ''
  }))()`)
  reporter.check(
    '저장소가 아니면 "git 저장소 아님"으로 보여 준다',
    plainView.counts.some((c) => (c ?? '').includes('저장소 아님')),
    plainView.counts.join(' | ') || '(없음)'
  )
  reporter.check(
    '사용자가 쓴 제목은 자동 채우기가 건드리지 않는다',
    plainView.head.includes('내가 쓴 제목'),
    plainView.head
  )

  // 빈 제목 노드는 폴더명으로 보인다 (ai-title이 없으므로 채워지지 않는다).
  const repoTitle = await evaluate(
    `(window.__sessionCanvas.nodes.find((n) => n.id === ${JSON.stringify(repoNode)})?.title ?? '')`
  )
  reporter.check(
    'ai-title이 없으면 제목을 비워 둔다 (폴더명 표시가 유지된다)',
    repoTitle === '',
    `제목=${JSON.stringify(repoTitle)}`
  )

  await evaluate(`(document.querySelector('.worklog-close')?.click(), 1)`)
  await sleep(300)
  reporter.check(
    '패널을 닫으면 캔버스가 다시 넓어진다',
    await evaluate(`(() => {
      const flow = document.querySelector('.react-flow').getBoundingClientRect()
      return flow.width > window.innerWidth - 50
    })()`),
    '닫힘 확인'
  )

  client.close()
  process.exitCode = reporter.finish() > 0 ? 1 : 0
} catch (error) {
  console.error(`\n❌ ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (dev && !options.keep) stopDevApp(dev.child)
  killCheckServer()
}
