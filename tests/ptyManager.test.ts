import { beforeEach, describe, expect, it, vi } from 'vitest'

// node-pty는 Electron ABI로 빌드되어 있어 순수 Node(vitest)에서는 못 읽는다.
// 여기서는 spawn을 통째로 갈아끼워 PtyManager의 로직만 본다.
const spawn = vi.fn()
vi.mock('node-pty', () => ({ spawn: (...args: unknown[]) => spawn(...args) }))

const { PtyManager } = await import('../src/main/pty/PtyManager')

interface FakePty {
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: (code: number) => void
}

function fakePty(): FakePty {
  let onData: (data: string) => void = () => {}
  let onExit: (e: { exitCode: number }) => void = () => {}
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (data) => onData(data),
    emitExit: (code) => onExit({ exitCode: code }),
    // node-pty가 노출하는 구독 API
    onData: (cb: (data: string) => void) => {
      onData = cb
    },
    onExit: (cb: (e: { exitCode: number }) => void) => {
      onExit = cb
    }
  } as unknown as FakePty
}

const REQ = { id: 'main', cwd: null, command: null }

describe('PtyManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    spawn.mockReset()
  })

  it('SPEC 10: 출력을 8ms 단위로 묶어 한 번에 보낸다', () => {
    const pty = fakePty()
    spawn.mockReturnValue(pty)
    const onData = vi.fn()
    const manager = new PtyManager({ SHELL: '/bin/zsh' }, { onData, onExit: vi.fn() })

    manager.open(REQ, 80, 24)
    pty.emitData('a')
    pty.emitData('b')
    pty.emitData('c')
    expect(onData).not.toHaveBeenCalled()

    vi.advanceTimersByTime(8)
    expect(onData).toHaveBeenCalledExactlyOnceWith('main', 'abc')
  })

  it('같은 id로 다시 열면 이전 PTY를 죽이고 갈아끼운다', () => {
    const first = fakePty()
    const second = fakePty()
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const manager = new PtyManager({ SHELL: '/bin/zsh' }, { onData: vi.fn(), onExit: vi.fn() })

    manager.open(REQ, 80, 24)
    manager.open(REQ, 80, 24)

    expect(first.kill).toHaveBeenCalled()
    manager.write('main', 'x')
    expect(second.write).toHaveBeenCalledWith('x')
    expect(first.write).not.toHaveBeenCalled()
  })

  // 회귀 테스트: React StrictMode의 이중 마운트에서 실제로 터졌다. 교체된
  // PTY의 늦은 exit 이벤트가 새 세션을 맵에서 지워, 이후 입력이 사라졌다.
  it('교체된 PTY의 늦은 exit 이벤트가 새 세션을 죽이지 않는다', () => {
    const first = fakePty()
    const second = fakePty()
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const onExit = vi.fn()
    const manager = new PtyManager({ SHELL: '/bin/zsh' }, { onData: vi.fn(), onExit })

    manager.open(REQ, 80, 24)
    manager.open(REQ, 80, 24)
    first.emitExit(0)

    expect(onExit).not.toHaveBeenCalled()
    manager.write('main', 'x')
    expect(second.write).toHaveBeenCalledWith('x')
  })

  it('교체된 PTY의 늦은 출력은 버린다', () => {
    const first = fakePty()
    const second = fakePty()
    spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const onData = vi.fn()
    const manager = new PtyManager({ SHELL: '/bin/zsh' }, { onData, onExit: vi.fn() })

    manager.open(REQ, 80, 24)
    manager.open(REQ, 80, 24)
    first.emitData('옛 세션 출력')
    vi.advanceTimersByTime(8)

    expect(onData).not.toHaveBeenCalled()
  })

  it('살아 있는 PTY가 끝나면 남은 출력을 흘려보내고 exit을 알린다', () => {
    const pty = fakePty()
    spawn.mockReturnValue(pty)
    const onData = vi.fn()
    const onExit = vi.fn()
    const manager = new PtyManager({ SHELL: '/bin/zsh' }, { onData, onExit })

    manager.open(REQ, 80, 24)
    pty.emitData('마지막 줄')
    pty.emitExit(3)

    expect(onData).toHaveBeenCalledWith('main', '마지막 줄')
    expect(onExit).toHaveBeenCalledWith('main', 3)
  })

  it('detach는 PTY만 죽이고, 이후 write는 조용히 무시된다', () => {
    const pty = fakePty()
    spawn.mockReturnValue(pty)
    const manager = new PtyManager({ SHELL: '/bin/zsh' }, { onData: vi.fn(), onExit: vi.fn() })

    manager.open(REQ, 80, 24)
    manager.detach('main')

    expect(pty.kill).toHaveBeenCalled()
    expect(() => manager.write('main', 'x')).not.toThrow()
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('로그인 셸과 UTF-8 로케일로 띄운다 (SPEC 4.4)', () => {
    const pty = fakePty()
    spawn.mockReturnValue(pty)
    const manager = new PtyManager(
      { SHELL: '/opt/homebrew/bin/zsh', PATH: '/opt/homebrew/bin' },
      { onData: vi.fn(), onExit: vi.fn() }
    )

    manager.open(REQ, 120, 40)

    const [file, args, opts] = spawn.mock.calls[0] as [string, string[], Record<string, unknown>]
    expect(file).toBe('/opt/homebrew/bin/zsh')
    expect(args).toEqual(['-l'])
    expect(opts.cols).toBe(120)
    const env = opts.env as Record<string, string>
    expect(env.PATH).toBe('/opt/homebrew/bin')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.LANG).toMatch(/UTF-8$/)
  })
})
