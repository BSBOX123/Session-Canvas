import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TmuxService } from '../src/main/tmux/TmuxService'
import { buildNewSessionArgs, type TmuxContext } from '../src/main/tmux/buildArgs'

const execFileAsync = promisify(execFile)

// SPEC 14.2: tmux가 설치된 환경에서만 돌린다. 전용 소켓에 **테스트용 접미사**를
// 붙여 실제 세션과 충돌하지 않게 한다.
const ctx: TmuxContext = {
  socket: 'session-canvas-vitest',
  configPath: resolve(__dirname, '../resources/tmux.conf')
}

const tmuxAvailable = await execFileAsync('tmux', ['-V'])
  .then(() => true)
  .catch(() => false)

async function killServer(): Promise<void> {
  await execFileAsync('tmux', ['-L', ctx.socket, 'kill-server']).catch(() => undefined)
}

describe.skipIf(!tmuxAvailable)('TmuxService (통합)', () => {
  const service = new TmuxService(ctx, process.env)

  beforeAll(killServer)
  afterAll(killServer)

  it('설치된 tmux 버전을 읽고 3.3+ 인지 판단한다 (SPEC 4.3)', async () => {
    const result = await service.check()
    expect(result.version).toMatch(/\d+\.\d+/)
    expect(result.ok).toBe(true)
  })

  it('서버가 없으면 빈 목록이고 존재 확인은 false다 (SPEC 5.3)', async () => {
    expect(await service.listSessions()).toEqual([])
    expect(await service.hasSession('nosuch1234')).toBe(false)
  })

  it('세션 생성 → 존재 확인 → 목록 → 종료 → 사라짐', async () => {
    const id = 'vitest1234'
    // 앱이 쓰는 인자 그대로 띄운다. `resources/tmux.conf`가 실제 tmux에서 오류
    // 없이 로드되는지도 함께 확인된다 (SPEC 5.2). 붙지 않도록 `-d`만 더한다.
    const args = buildNewSessionArgs(ctx, {
      id,
      cwd: homedir(),
      command: null,
      shell: '/bin/zsh'
    })
    args.splice(args.indexOf('new-session') + 1, 0, '-d')
    await execFileAsync('tmux', args)

    expect(await service.hasSession(id)).toBe(true)
    const sessions = await service.listSessions()
    expect(sessions.map((s) => s.id)).toContain(id)
    expect(sessions.find((s) => s.id === id)?.cwd).toBe(homedir())

    await service.killSession(id)
    expect(await service.hasSession(id)).toBe(false)
  })

  it('없는 세션을 종료해도 던지지 않는다', async () => {
    await expect(service.killSession('ghost12345')).resolves.toBeUndefined()
  })

  // SPEC 5.1: 사용자 기본 tmux 서버와 격리되어야 한다.
  it('전용 소켓을 쓰므로 기본 서버에는 보이지 않는다', async () => {
    const id = 'isolated12'
    await execFileAsync('tmux', [
      '-L',
      ctx.socket,
      '-f',
      ctx.configPath,
      'new-session',
      '-d',
      '-s',
      `sc-${id}`
    ])
    expect(await service.hasSession(id)).toBe(true)

    const defaultServer = await execFileAsync('tmux', ['list-sessions'])
      .then(({ stdout }) => stdout)
      .catch(() => '')
    expect(defaultServer).not.toContain(`sc-${id}`)

    await service.killSession(id)
  })
})
