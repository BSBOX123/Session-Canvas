/**
 * SPEC 6.4 — React 노드가 언마운트되어도 터미널 버퍼가 사라지면 안 된다.
 *
 * 그래서 노드별 `{ terminal, host }`를 React 바깥인 이 모듈이 들고 있는다.
 *  - `terminal.open(host)`는 **최초 1회만**
 *  - `XtermView`는 마운트 시 host를 자기 DOM에 붙이고, 언마운트 시 떼어낼 뿐
 *  - `dispose`는 노드를 닫거나 세션을 종료할 때만
 *
 * PTY 출력 구독도 여기 있다. 뷰에 두면 언마운트된 노드의 출력이 유실된다.
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { DEFAULT_SETTINGS, type NodeId, type TerminalNodeData } from '@shared/types'
import type { ThemeSettings } from '@shared/types'
import { terminalTheme } from '../theme'
import { useWorkspace } from '../state/workspace'

export interface TerminalEntry {
  terminal: Terminal
  fit: FitAddon
  host: HTMLDivElement
  webgl: WebglAddon | null
}

const entries = new Map<NodeId, TerminalEntry>()
let subscribed = false

/**
 * SPEC 6.3 — Chromium은 동시에 살아 있는 WebGL 컨텍스트 수에 제한이 있어
 * (대략 16개) 넘으면 오래된 것부터 끊긴다. 그래서 **포커스된 노드 + 최근
 * 포커스된 노드** 최대 `webglMax`개에만 WebGL을 붙이고 나머지는 DOM 렌더러로 둔다.
 *
 * 최근 포커스 순서(가장 최근이 앞).
 */
const recentlyFocused: NodeId[] = []
/** 새로 만드는 터미널에도 같은 테마를 준다. */
let currentTheme: ThemeSettings = { ...DEFAULT_SETTINGS.theme }
let webglMax = DEFAULT_SETTINGS.webglMax
/** 컨텍스트를 잃은 노드는 다시 붙이지 않는다 — 앱이 멈추면 안 된다. */
const webglBlocked = new Set<NodeId>()

/**
 * 테마 색을 살아 있는 터미널 전부에 적용한다 (SPEC 9.1).
 * 터미널은 자기 배경을 직접 그리므로 CSS 변수만 바꿔서는 안 바뀐다.
 */
export function applyTerminalTheme(theme: ThemeSettings): void {
  const colors = terminalTheme(theme)
  currentTheme = theme
  for (const entry of entries.values()) {
    entry.terminal.options.theme = colors
  }
}

/** 설정의 폰트·크기를 살아 있는 터미널 전부에 적용한다 (SPEC 9.1). */
export function applyFontSettings(fontFamily: string, fontSize: number): void {
  for (const [id, entry] of entries) {
    const changed =
      entry.terminal.options.fontFamily !== fontFamily ||
      entry.terminal.options.fontSize !== fontSize
    if (!changed) continue
    entry.terminal.options.fontFamily = fontFamily
    entry.terminal.options.fontSize = fontSize
    fitAndResize(id)
  }
}

export function setWebglMax(max: number): void {
  webglMax = Math.max(0, Math.floor(max))
  applyWebglPolicy()
}

/** WebGL을 붙여야 할 노드 목록 (최근 포커스 상위 `webglMax`개). */
function webglTargets(): NodeId[] {
  return recentlyFocused.filter((id) => entries.has(id) && !webglBlocked.has(id)).slice(0, webglMax)
}

function attachWebgl(entry: TerminalEntry, id: NodeId): void {
  if (entry.webgl !== null || webglBlocked.has(id)) return
  try {
    const addon = new WebglAddon()
    addon.onContextLoss(() => {
      // 컨텍스트를 잃으면 조용히 DOM 렌더러로 되돌린다 (SPEC 6.3).
      console.warn(`[session-canvas] WebGL 컨텍스트 손실 (${id}) → DOM 렌더러로 되돌립니다`)
      webglBlocked.add(id)
      detachWebgl(entry)
    })
    entry.terminal.loadAddon(addon)
    entry.webgl = addon
  } catch (error) {
    console.warn(`[session-canvas] WebGL을 붙이지 못했습니다 (${id}):`, error)
    webglBlocked.add(id)
  }
}

function detachWebgl(entry: TerminalEntry): void {
  if (entry.webgl === null) return
  const addon = entry.webgl
  entry.webgl = null
  try {
    addon.dispose()
  } catch {
    /* 이미 정리됐다 */
  }
}

function applyWebglPolicy(): void {
  const targets = new Set(webglTargets())
  for (const [id, entry] of entries) {
    if (targets.has(id)) attachWebgl(entry, id)
    else detachWebgl(entry)
  }
}

/** 어떤 노드가 포커스를 받았다. 최근 순서를 갱신하고 정책을 다시 적용한다. */
function touch(id: NodeId): void {
  // 화면이 반응해야 하므로 스토어에도 알린다 (미리보기 입력 허용 판단, SPEC 7.3).
  useWorkspace.getState().setFocusedNode(id)
  const at = recentlyFocused.indexOf(id)
  if (at === 0) return
  if (at > 0) recentlyFocused.splice(at, 1)
  recentlyFocused.unshift(id)
  applyWebglPolicy()
}

/** 지금 포커스를 쥐고 있는 노드 (가장 최근에 포커스된 것). */
export function focusedNode(): NodeId | null {
  return recentlyFocused.find((id) => entries.has(id)) ?? null
}

/** 점검·디버깅용: 지금 WebGL이 붙어 있는 노드. */
export function webglNodes(): NodeId[] {
  return [...entries].filter(([, entry]) => entry.webgl !== null).map(([id]) => id)
}

/** 살아 있는 노드에만 출력을 흘린다. 앱 전체에서 한 번만 구독한다. */
function subscribeOnce(): void {
  if (subscribed) return
  subscribed = true
  window.api.pty.onData((id, data) => {
    entries.get(id)?.terminal.write(data)
  })
  window.api.pty.onExit((id, code) => {
    entries.get(id)?.terminal.write(`\r\n\x1b[90m[프로세스 종료: ${code}]\x1b[0m\r\n`)
  })
}

function createTerminal(id: NodeId): { terminal: Terminal; fit: FitAddon } {
  const terminal = new Terminal({
    fontFamily: DEFAULT_SETTINGS.fontFamily,
    fontSize: DEFAULT_SETTINGS.fontSize,
    // unicode11 애드온이 제안 API를 쓴다.
    allowProposedApi: true,
    // SPEC 6.5
    macOptionClickForcesSelection: true,
    macOptionIsMeta: false,
    cursorBlink: true,
    scrollback: 10_000,
    theme: terminalTheme(currentTheme)
  })

  const fit = new FitAddon()
  terminal.loadAddon(fit)
  // SPEC 6.1: 한글 등 전각 문자 폭 계산 — 활성화 필수.
  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'
  terminal.loadAddon(new ClipboardAddon())
  terminal.loadAddon(new WebLinksAddon())

  terminal.attachCustomKeyEventHandler((event) => {
    // SPEC 13 R2 — Shift+Enter로 Claude Code에 줄바꿈을 넣는다.
    //
    // 확인 결과(단계 3): xterm은 Shift+Enter를 그냥 Enter와 똑같이 보낸다.
    // 터미널이 구별해 주지 않으면 Claude Code도 알 수 없다. iTerm에서
    // `claude` 의 `/terminal-setup`이 하는 것과 같은 방식으로, 여기서
    // `ESC CR`(= Option+Enter와 같은 바이트)로 바꿔 보낸다.
    const plainShiftEnter =
      event.type === 'keydown' &&
      event.key === 'Enter' &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    if (plainShiftEnter) {
      window.api.pty.write(id, '\u001b\r')
      return false
    }
    return true
  })

  return { terminal, fit }
}

/**
 * 노드의 터미널을 가져온다. 없으면 만들고 PTY를 연다.
 * `container`는 최초 1회 `terminal.open()`에 쓸 부모 엘리먼트다 — xterm이
 * 글자 크기를 재려면 화면에 붙어 있어야 한다.
 */
export function acquire(node: TerminalNodeData, container: HTMLElement): TerminalEntry {
  subscribeOnce()

  const existing = entries.get(node.id)
  if (existing) {
    // 재마운트: host를 새 컨테이너로 옮기기만 한다. open은 다시 부르지 않는다.
    if (existing.host.parentElement !== container) container.appendChild(existing.host)
    existing.fit.fit()
    return existing
  }

  const host = document.createElement('div')
  host.className = 'xterm-host'
  container.appendChild(host)

  const { terminal, fit } = createTerminal(node.id)
  terminal.open(host)
  fit.fit()

  const entry: TerminalEntry = { terminal, fit, host, webgl: null }
  entries.set(node.id, entry)
  touch(node.id)

  terminal.onData((data) => window.api.pty.write(node.id, data))

  void window.api.pty
    .open({ id: node.id, cwd: node.cwd, command: node.command }, terminal.cols, terminal.rows)
    .catch((error: unknown) => {
      terminal.write(`\r\n\x1b[31m터미널을 열지 못했습니다: ${String(error)}\x1b[0m\r\n`)
    })

  return entry
}

/** 크기 변경 → fit → `pty.resize`. 값이 안 바뀌면 IPC를 보내지 않는다. */
export function fitAndResize(id: NodeId): void {
  const entry = entries.get(id)
  if (!entry) return
  const { terminal, fit } = entry
  const before = { cols: terminal.cols, rows: terminal.rows }
  fit.fit()
  if (terminal.cols === before.cols && terminal.rows === before.rows) return
  window.api.pty.resize(id, terminal.cols, terminal.rows)
}

export function get(id: NodeId): TerminalEntry | undefined {
  return entries.get(id)
}

export function focus(id: NodeId): void {
  const entry = entries.get(id)
  if (!entry) return
  touch(id)
  entry.terminal.focus()
}

/**
 * 노드를 닫을 때만 부른다 (SPEC 6.4).
 *
 *  - `detach`: PTY(= tmux 클라이언트)만 끊는다. **tmux 세션은 살아남는다** —
 *    노드 닫기의 기본 동작이고, 그 세션은 "분리된 세션"으로 되살릴 수 있다.
 *  - `kill`: `tmux kill-session`까지 해서 세션을 완전히 끝낸다.
 */
/** 포커스된 터미널의 글자 크기 (SPEC 7.5의 `Cmd+=`/`Cmd+-`). */
export function changeFontSize(id: NodeId, delta: number): void {
  const entry = entries.get(id)
  if (!entry) return
  const next = Math.min(32, Math.max(8, entry.terminal.options.fontSize ?? 13) + delta)
  entry.terminal.options.fontSize = next
  fitAndResize(id)
}

export function dispose(id: NodeId, mode: 'detach' | 'kill'): void {
  const entry = entries.get(id)
  if (!entry) return
  entries.delete(id)
  const at = recentlyFocused.indexOf(id)
  if (at >= 0) recentlyFocused.splice(at, 1)
  webglBlocked.delete(id)
  if (useWorkspace.getState().focusedNodeId === id) {
    useWorkspace.getState().setFocusedNode(focusedNode())
  }
  detachWebgl(entry)
  applyWebglPolicy()
  void (mode === 'kill' ? window.api.pty.kill(id) : window.api.pty.detach(id))
  entry.terminal.dispose()
  entry.host.remove()
}

/** 개발 모드 점검용 (SPEC 14.3). */
export function debugTerminals(): Record<NodeId, Terminal> {
  return Object.fromEntries([...entries].map(([id, entry]) => [id, entry.terminal]))
}
