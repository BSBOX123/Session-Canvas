#!/usr/bin/env node
/**
 * 패키징 앱(`.app`)에 지금 코드를 반영한다 (SPEC 4.3).
 *
 *   npm run app:update
 *
 * `npm run dev`는 고친 코드를 바로 띄우지만, Finder로 켜는 `.app`은 번들 **안에
 * 복사된** 코드를 쓴다. 그래서 고칠 때마다 다시 패키징해야 반영된다.
 *
 * 왜 스크립트가 따로 필요한가:
 *   - electron-builder는 출력 폴더를 **지우고** 다시 만든다. 지금 그 번들로 앱이
 *     돌고 있으면 실행 중인 파일을 갈아치우는 셈이다. 그래서 새 폴더(`dist-next`)에
 *     먼저 만들고, 앱이 꺼져 있을 때만 바꿔 넣는다
 *   - 앱을 **강제로 종료하지 않는다.** 노드 안에서 에이전트가 돌고 있을 수 있다.
 *     켜져 있으면 안내만 하고 새 번들은 `dist-next`에 남긴다
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const staging = join(root, 'dist-next')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`\n실패: ${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

/** `dist` 안의 번들로 돌고 있는 앱의 pid. 없으면 빈 배열. */
function runningPids() {
  const ps = execFileSync('ps', ['-axo', 'pid=,args='], { encoding: 'utf8' })
  return ps
    .split('\n')
    .filter((line) => line.includes(`${dist}/`) && line.includes('.app/Contents/MacOS/'))
    .map((line) => line.trim().split(/\s+/)[0])
}

console.log('1/3 코드 빌드')
run('npm', ['run', 'build'])

console.log('\n2/3 앱 패키징 →', staging)
rmSync(staging, { recursive: true, force: true })
run('npx', ['electron-builder', '--mac', `--config.directories.output=${staging}`])

console.log('\n3/3 번들 교체')
const pids = runningPids()
if (pids.length > 0) {
  console.log(`
  ⚠️  Session Canvas가 지금 돌고 있다 (pid ${pids.join(', ')}).

  실행 중인 번들을 갈아치우면 앱이 죽을 수 있어서 교체하지 않았다.
  새 번들은 여기에 있다:

    ${staging}

  앱을 끄고 (Cmd+Q — tmux 세션은 살아 있다) 다시 돌려라:

    npm run app:update
`)
  process.exit(1)
}

mkdirSync(dist, { recursive: true })
for (const entry of readdirSync(staging)) {
  const target = join(dist, entry)
  rmSync(target, { recursive: true, force: true })
  renameSync(join(staging, entry), target)
}
rmSync(staging, { recursive: true, force: true })

const bundle = readdirSync(dist)
  .filter((name) => name.startsWith('mac'))
  .map((name) => join(dist, name, 'Session Canvas.app'))
  .find((path) => existsSync(path))

console.log(`
  ✅ 반영됐다.

    ${bundle ?? dist}

  열기:  open "${bundle ?? dist}"
`)
