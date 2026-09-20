import { join } from 'path'
import { app, shell, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { CHANNELS } from '../shared/ipc'
import { resolveLoginEnv } from './env/loginEnv'
import { PtyManager } from './pty/PtyManager'
import { createForwarder, registerIpcHandlers } from './ipc'

let mainWindow: BrowserWindow | null = null
let ptyManager: PtyManager | null = null

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

  const forward = createForwarder(() => mainWindow)
  ptyManager = new PtyManager(loginEnv, {
    onData: (id, data) => forward(CHANNELS.ptyData, id, data),
    onExit: (id, code) => forward(CHANNELS.ptyExit, id, code)
  })
  registerIpcHandlers(ptyManager, () => mainWindow)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ptyManager?.detachAll()
})

// macOS only (SPEC 2.2): keep the app alive until the user quits explicitly.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
