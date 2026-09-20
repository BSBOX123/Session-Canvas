import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { HookInstaller } from '../src/main/hooks/HookInstaller'

const SOURCE = resolve(__dirname, '../resources/hooks/session-canvas-hook.sh')

let home = ''
let installer: HookInstaller
let settingsPath = ''
let targetPath = ''

beforeEach(async () => {
  // ⚠️ 진짜 ~/.claude는 절대 건드리지 않는다 (SPEC 0.4). 경로는 전부 주입한다.
  home = await mkdtemp(join(tmpdir(), 'session-canvas-installer-'))
  settingsPath = join(home, '.claude', 'settings.json')
  targetPath = join(home, '.session-canvas', 'bin', 'session-canvas-hook.sh')
  installer = new HookInstaller({ source: SOURCE, target: targetPath, settings: settingsPath })
})

async function writeSettings(value: string): Promise<void> {
  await mkdir(join(home, '.claude'), { recursive: true })
  await writeFile(settingsPath, value, 'utf8')
}

// SPEC 8.4
describe('HookInstaller', () => {
  it('설정 파일이 없어도 설치된다', async () => {
    expect(await installer.state()).toBe('not-installed')

    const { backup } = await installer.install()
    expect(backup).toBeNull()
    expect(await installer.state()).toBe('installed')

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(Object.keys(settings.hooks)).toContain('PermissionRequest')
  })

  it('스크립트를 실행 가능하게 복사한다', async () => {
    await installer.install()
    const info = await stat(targetPath)
    expect(info.mode & 0o111).not.toBe(0)
    expect(await readFile(targetPath, 'utf8')).toBe(await readFile(SOURCE, 'utf8'))
  })

  it('기존 설정을 백업하고 사용자 내용을 보존한다', async () => {
    const original = JSON.stringify({
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/my/hook' }] }] }
    })
    await writeSettings(original)

    const { backup } = await installer.install()
    expect(backup).not.toBeNull()
    expect(await readFile(backup as string, 'utf8')).toBe(original)

    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.model).toBe('opus')
    expect(settings.hooks.Stop[0]).toEqual({ hooks: [{ type: 'command', command: '/my/hook' }] })
    expect(settings.hooks.Stop).toHaveLength(2)
  })

  it('두 번 설치해도 항목이 늘지 않는다', async () => {
    await installer.install()
    await installer.install()
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(settings.hooks.Stop).toHaveLength(1)
  })

  it('제거하면 우리 항목만 사라진다', async () => {
    await writeSettings(JSON.stringify({ model: 'opus' }))
    await installer.install()
    await installer.uninstall()

    expect(await installer.state()).toBe('not-installed')
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ model: 'opus' })
  })

  // 가장 위험한 경우: 읽지 못하는 파일을 덮어쓰면 사용자 설정이 날아간다.
  it('JSON 파싱에 실패하면 아무것도 쓰지 않는다', async () => {
    await writeSettings('{ 이건 JSON이 아니다')

    await expect(installer.install()).rejects.toThrow(/JSON/)
    expect(await readFile(settingsPath, 'utf8')).toBe('{ 이건 JSON이 아니다')
    // 백업 파일도 만들지 않는다 — 읽기 단계에서 멈춘다.
    expect((await readdir(join(home, '.claude'))).filter((n) => n.includes('.bak-'))).toEqual([])
  })

  it('최상위가 객체가 아니면 거부한다', async () => {
    await writeSettings('[1,2,3]')
    await expect(installer.install()).rejects.toThrow(/객체/)
    expect(await readFile(settingsPath, 'utf8')).toBe('[1,2,3]')
  })

  it('빈 파일은 빈 설정으로 본다', async () => {
    await writeSettings('   ')
    await installer.install()
    expect(await installer.state()).toBe('installed')
  })

  it('일부 이벤트만 있으면 outdated', async () => {
    await installer.install()
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    delete settings.hooks.SessionEnd
    await writeFile(settingsPath, JSON.stringify(settings), 'utf8')

    expect(await installer.state()).toBe('outdated')
    await installer.install()
    expect(await installer.state()).toBe('installed')
  })
})
