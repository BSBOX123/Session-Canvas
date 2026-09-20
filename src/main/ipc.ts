/**
 * IPC 핸들러 등록. SPEC 11에 따라 renderer가 보낸 값은 전부 여기서 검증한다.
 */
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { CHANNELS, type PtyOpenRequest } from '../shared/ipc'
import { MAX_COMMAND_LENGTH, NODE_ID_PATTERN, type NodeId, type Workspace } from '../shared/types'
import type { OpenDialogOptions } from 'electron'
import type { PtyManager } from './pty/PtyManager'
import type { TmuxService } from './tmux/TmuxService'
import type { WorkspaceStore } from './workspace/WorkspaceStore'
import { parseWorkspace } from './workspace/serialize'

/** cols/rows의 상한. 터무니없는 값으로 PTY를 흔들지 못하게 한다. */
const MAX_DIMENSION = 1000

function assertNodeId(value: unknown): NodeId {
  if (typeof value !== 'string' || !NODE_ID_PATTERN.test(value)) {
    throw new Error(`잘못된 nodeId: ${String(value)}`)
  }
  return value
}

function assertDimension(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
    throw new Error(`잘못된 ${label}: ${String(value)}`)
  }
  return value
}

function assertOpenRequest(value: unknown): PtyOpenRequest {
  if (typeof value !== 'object' || value === null) throw new Error('잘못된 open 요청')
  const req = value as Record<string, unknown>
  const id = assertNodeId(req.id)

  let cwd: string | null = null
  if (req.cwd !== null && req.cwd !== undefined) {
    if (typeof req.cwd !== 'string' || !isAbsolute(req.cwd)) {
      throw new Error(`cwd는 절대경로여야 합니다: ${String(req.cwd)}`)
    }
    if (!statSync(req.cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`cwd가 디렉터리가 아닙니다: ${req.cwd}`)
    }
    cwd = req.cwd
  }

  let command: string | null = null
  if (req.command !== null && req.command !== undefined) {
    if (typeof req.command !== 'string' || req.command.length > MAX_COMMAND_LENGTH) {
      throw new Error('잘못된 command')
    }
    command = req.command
  }

  return { id, cwd, command }
}

export interface IpcDeps {
  pty: PtyManager
  tmux: TmuxService
  store: WorkspaceStore
  getWindow(): BrowserWindow | null
}

export function registerIpcHandlers({ pty, tmux, store, getWindow }: IpcDeps): void {
  ipcMain.handle(
    CHANNELS.ptyOpen,
    (_event: IpcMainInvokeEvent, req: unknown, cols: unknown, rows: unknown) => {
      pty.open(assertOpenRequest(req), assertDimension(cols, 'cols'), assertDimension(rows, 'rows'))
    }
  )

  ipcMain.on(CHANNELS.ptyWrite, (_event, id: unknown, data: unknown) => {
    if (typeof data !== 'string') return
    pty.write(assertNodeId(id), data)
  })

  ipcMain.on(CHANNELS.ptyResize, (_event, id: unknown, cols: unknown, rows: unknown) => {
    pty.resize(assertNodeId(id), assertDimension(cols, 'cols'), assertDimension(rows, 'rows'))
  })

  ipcMain.handle(CHANNELS.ptyDetach, (_event, id: unknown) => {
    pty.detach(assertNodeId(id))
  })

  // 세션 종료 (SPEC 5.3): tmux 세션을 죽이고 PTY도 정리한다.
  ipcMain.handle(CHANNELS.ptyKill, async (_event, id: unknown) => {
    const nodeId = assertNodeId(id)
    await tmux.killSession(nodeId)
    pty.detach(nodeId)
  })

  ipcMain.handle(CHANNELS.workspaceLoad, () => store.load())

  ipcMain.on(CHANNELS.workspaceSave, (_event, raw: unknown) => {
    // renderer가 보낸 값도 믿지 않는다 (SPEC 11). 파서를 그대로 재사용한다.
    const parsed = parseWorkspace(JSON.stringify(raw))
    if (parsed.status !== 'ok') {
      console.warn('[session-canvas] 저장 요청이 형식에 맞지 않아 무시합니다:', parsed.status)
      return
    }
    store.save(parsed.workspace satisfies Workspace)
  })

  ipcMain.handle(CHANNELS.tmuxCheck, () => tmux.check())

  ipcMain.handle(CHANNELS.tmuxExists, (_event, id: unknown) => tmux.hasSession(assertNodeId(id)))

  ipcMain.handle(CHANNELS.tmuxListOrphans, async (_event, known: unknown) => {
    const knownIds = new Set(Array.isArray(known) ? known.filter((v) => typeof v === 'string') : [])
    const sessions = await tmux.listSessions()
    return sessions.filter((session) => !knownIds.has(session.id))
  })

  ipcMain.handle(CHANNELS.dialogPickDirectory, async () => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: '작업 폴더 선택'
    }
    const result =
      win === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(win, options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

/** main → renderer 단방향 이벤트. 창이 사라진 뒤에는 보내지 않는다. */
export function createForwarder(getWindow: () => BrowserWindow | null) {
  return (channel: string, ...args: unknown[]): void => {
    const win = getWindow()
    if (win === null || win.isDestroyed()) return
    win.webContents.send(channel, ...args)
  }
}
