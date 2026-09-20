import { homedir } from 'node:os'
import { join } from 'path'
import { app, shell, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { CHANNELS } from '../shared/ipc'
import { resolveLoginEnv } from './env/loginEnv'
import { resourcePath } from './resources'
import { TmuxService } from './tmux/TmuxService'
import { TMUX_SOCKET, type TmuxContext } from './tmux/buildArgs'
import { WorkspaceStore } from './workspace/WorkspaceStore'
import { HookInstaller } from './hooks/HookInstaller'
import { StatusWatcher } from './status/StatusWatcher'
import { Notifier } from './notify/Notifier'
import { PtyManager } from './pty/PtyManager'
import { createForwarder, registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null
let workspaceStore: WorkspaceStore | null = null
let statusWatcher: StatusWatcher | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#14161a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // SPEC 11
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // SPEC 11: no remote URLs in the window; external links open in the browser.
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.sessioncanvas.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // SPEC 4.4: 로그인 셸의 PATH를 먼저 확보한 뒤에 PTY를 만든다.
  const loginEnv = await resolveLoginEnv()
  console.log(
    `[session-canvas] login env resolved, PATH entries: ${loginEnv.PATH?.split(':').length ?? 0}`
  )

  const tmuxContext: TmuxContext = {
    // 점검 스크립트가 실제 세션과 충돌하지 않게 소켓을 갈아끼울 수 있다 (SPEC 14.2).
    socket: process.env.SESSION_CANVAS_TMUX_SOCKET ?? TMUX_SOCKET,
    configPath: resourcePath('tmux.conf')
  }
  const tmuxService = new TmuxService(tmuxContext, loginEnv)
  const tmux = await tmuxService.check()
  console.log(`[session-canvas] tmux: ${tmux.ok ? 'ok' : '사용 불가'} (${tmux.version ?? '없음'})`)

  const forward = createForwarder(() => mainWindow)
  ptyManager = new PtyManager(loginEnv, tmuxContext, {
    onData: (id, data) => forward(CHANNELS.ptyData, id, data),
    onExit: (id, code) => forward(CHANNELS.ptyExit, id, code)
  })
  workspaceStore = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'))

  // SPEC 8.3~8.6. HOME을 통째로 바꿀 수 있게 해 둔다 — 점검이 진짜
  // `~/.claude`를 건드리지 않게 하기 위한 유일한 통로다 (SPEC 14.2).
  const home = process.env.SESSION_CANVAS_HOME ?? homedir()
  const hookInstaller = new HookInstaller({
    source: resourcePath('hooks/session-canvas-hook.sh'),
    target: join(home, '.session-canvas', 'bin', 'session-canvas-hook.sh'),
    settings: join(home, '.claude', 'settings.json')
  })
  const notifier = new Notifier(
    () => mainWindow,
    (nodeId) => forward(CHANNELS.appNotificationClick, nodeId)
  )
  statusWatcher = new StatusWatcher(join(home, '.session-canvas', 'status'), (change) =>
    forward(CHANNELS.statusChanged, change)
  )
  // 앱을 켜기 전에 남은 상태 파일은 무시한다 (SPEC 8.5).
  await statusWatcher.start(new Date())

  registerIpcHandlers({
    pty: ptyManager,
    tmux: tmuxService,
    store: workspaceStore,
    status: statusWatcher,
    hooks: hookInstaller,
    notifier,
    getWindow: () => mainWindow
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  statusWatcher?.stop()
  // PTY(= tmux 클라이언트)만 정리한다. 세션은 tmux 서버에 그대로 남는다.
  ptyManager?.detachAll()
  void workspaceStore?.flush()
})

// macOS only (SPEC 2.2): keep the app alive until the user quits explicitly.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
