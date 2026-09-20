import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, type Api, type StatusChange, type Unsubscribe } from '../shared/ipc'
import type { NodeId } from '../shared/types'

/**
 * renderer는 Node API에 직접 접근하지 않는다 (SPEC 10/11). 모든 통신은
 * 이 브리지를 지난다.
 */
function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  pty: {
    open: (req, cols, rows) => ipcRenderer.invoke(CHANNELS.ptyOpen, req, cols, rows),
    write: (id, data) => ipcRenderer.send(CHANNELS.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(CHANNELS.ptyResize, id, cols, rows),
    detach: (id) => ipcRenderer.invoke(CHANNELS.ptyDetach, id),
    kill: (id) => ipcRenderer.invoke(CHANNELS.ptyKill, id),
    onData: (cb) => subscribe<[NodeId, string]>(CHANNELS.ptyData, cb),
    onExit: (cb) => subscribe<[NodeId, number]>(CHANNELS.ptyExit, cb)
  },
  workspace: {
    load: () => ipcRenderer.invoke(CHANNELS.workspaceLoad),
    save: (workspace) => ipcRenderer.send(CHANNELS.workspaceSave, workspace)
  },
  tmux: {
    check: () => ipcRenderer.invoke(CHANNELS.tmuxCheck),
    listOrphans: (known) => ipcRenderer.invoke(CHANNELS.tmuxListOrphans, known),
    exists: (id) => ipcRenderer.invoke(CHANNELS.tmuxExists, id)
  },
  status: {
    onChange: (cb) => subscribe<[StatusChange]>(CHANNELS.statusChanged, cb),
    setKnownNodes: (ids) => ipcRenderer.send(CHANNELS.statusSetKnownNodes, ids)
  },
  hooks: {
    state: () => ipcRenderer.invoke(CHANNELS.hooksState),
    install: () => ipcRenderer.invoke(CHANNELS.hooksInstall),
    uninstall: () => ipcRenderer.invoke(CHANNELS.hooksUninstall)
  },
  app: {
    setBadge: (n) => ipcRenderer.send(CHANNELS.appSetBadge, n),
    notify: (nodeId, title, state) => ipcRenderer.send(CHANNELS.appNotify, nodeId, title, state),
    setNotificationsEnabled: (enabled) => ipcRenderer.send(CHANNELS.appSetNotifications, enabled),
    onNotificationClick: (cb) => subscribe<[NodeId]>(CHANNELS.appNotificationClick, cb)
  },
  clipboard: {
    read: () => ipcRenderer.invoke(CHANNELS.clipboardRead),
    write: (text) => ipcRenderer.send(CHANNELS.clipboardWrite, text)
  },
  git: {
    branch: (cwd) => ipcRenderer.invoke(CHANNELS.gitBranch, cwd)
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke(CHANNELS.dialogPickDirectory)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}
