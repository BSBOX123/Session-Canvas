#!/usr/bin/env node
/**
 * 실제 작업과 격리된 개발 모드 (SPEC 14.2).
 *
 * 그냥 `npm run dev`는 **패키징 앱과 같은 tmux 소켓, 같은 `workspace.json`을
 * 쓴다.** 둘이 동시에 떠 있으면 같은 세션에 클라이언트가 둘 붙어 창 크기가
 * 서로 맞춰지며 흔들리고, 두 앱이 배치 파일을 번갈아 덮어쓴다.
 *
 * 그래서 앱을 고치는 동안에는 이쪽으로 띄운다:
 *   - tmux 소켓: `session-canvas-dev` (실제 세션과 완전히 분리)
 *   - 워크스페이스: `<저장소>/.dev-userdata` (git 무시, 재시작해도 유지)
 *
 *   npm run dev:isolated
 *   npm run dev:isolated -- --remote-debugging-port=9222   # 인자는 그대로 전달
 *   npm run dev:isolated -- --clean                        # 개발용 배치·세션 초기화
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOCKET = 'session-canvas-dev'
const userDataDir = resolve(repoRoot, '.dev-userdata')

const args = process.argv.slice(2)
const clean = args.includes('--clean')
const electronArgs = args.filter((arg) => arg !== '--clean')

if (clean) {
  rmSync(userDataDir, { recursive: true, force: true })
  try {
    execFileSync('tmux', ['-L', SOCKET, 'kill-server'], { stdio: 'ignore' })
  } catch {
    /* 서버가 없으면 그만이다 */
  }
  console.log('개발용 워크스페이스와 tmux 세션을 지웠습니다.')
}

mkdirSync(userDataDir, { recursive: true })

console.log(`[격리 개발 모드] tmux 소켓=${SOCKET}, 워크스페이스=${userDataDir}`)
console.log('실제 세션과 배치는 건드리지 않습니다. 개발용 세션 목록: tmux -L ' + SOCKET + ' ls')

const child = spawn(
  process.execPath,
  [
    resolve(repoRoot, 'node_modules/electron-vite/bin/electron-vite.js'),
    'dev',
    '--',
    `--user-data-dir=${userDataDir}`,
    ...electronArgs
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      SESSION_CANVAS_TMUX_SOCKET: SOCKET,
      // 로그인 셸이 "업데이트할까요?" 같은 질문으로 노드를 붙잡지 않게 한다.
      DISABLE_AUTO_UPDATE: 'true',
      DISABLE_UPDATE_PROMPT: 'true'
    }
  }
)

// Ctrl+C를 그대로 넘겨 준다.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code) => process.exit(code ?? 0))
