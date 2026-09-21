/**
 * 테마 (SPEC 9.1 `settings.theme`).
 *
 * 화면 색은 전부 CSS 변수로 나가고, 같은 값을 xterm에도 넘긴다 — 터미널은
 * 자기 배경을 직접 그리기 때문에 CSS만 바꾸면 노드 안이 따로 논다.
 */
import type { ThemeSettings } from '@shared/types'

export interface ThemePalette {
  name: string
  bg: string
  panel: string
  panel2: string
  border: string
  fg: string
  fgDim: string
}

export const THEME_PRESETS: Record<string, ThemePalette> = {
  dark: {
    name: '다크',
    bg: '#14161a',
    panel: '#1b1f26',
    panel2: '#222832',
    border: '#2d3540',
    fg: '#e6e8eb',
    fgDim: '#9aa4b1'
  },
  midnight: {
    name: '미드나이트',
    bg: '#0d1117',
    panel: '#161b22',
    panel2: '#1c2430',
    border: '#30363d',
    fg: '#e6edf3',
    fgDim: '#8b949e'
  },
  graphite: {
    name: '그래파이트',
    bg: '#1c1c1e',
    panel: '#242426',
    panel2: '#2c2c2e',
    border: '#3a3a3c',
    fg: '#f2f2f7',
    fgDim: '#98989d'
  },
  forest: {
    name: '포레스트',
    bg: '#10171a',
    panel: '#182226',
    panel2: '#1f2b30',
    border: '#2c3b40',
    fg: '#e3ecec',
    fgDim: '#93a7a7'
  },
  latte: {
    name: '라떼 (밝음)',
    bg: '#f4f1ec',
    panel: '#fbf9f6',
    panel2: '#ece7e0',
    border: '#d6cfc5',
    fg: '#2c2a28',
    fgDim: '#6b665f'
  }
}

/** 강조색 선택지. 상태 색(파랑·주황·초록)과 겹치지 않게 고른다. */
export const ACCENT_CHOICES = [
  '#4c8dff',
  '#7c6cff',
  '#c96fd0',
  '#d9536f',
  '#e08a3c',
  '#3fb894',
  '#4bb3c9'
] as const

export const DEFAULT_THEME: ThemeSettings = { preset: 'dark', accent: '#4c8dff' }

export function paletteOf(theme: ThemeSettings): ThemePalette {
  return THEME_PRESETS[theme.preset] ?? THEME_PRESETS.dark
}

/** 밝은 테마인지 — xterm 커서·선택색과 `color-scheme`을 맞추는 데 쓴다. */
export function isLight(palette: ThemePalette): boolean {
  const hex = palette.bg.replace('#', '')
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  // 대충의 밝기. 정확한 색공간 변환까지는 필요 없다.
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}

/** CSS 변수에 반영한다. */
export function applyThemeToDocument(theme: ThemeSettings): void {
  const palette = paletteOf(theme)
  const root = document.documentElement
  root.style.setProperty('--bg', palette.bg)
  root.style.setProperty('--panel', palette.panel)
  root.style.setProperty('--panel-2', palette.panel2)
  root.style.setProperty('--border', palette.border)
  root.style.setProperty('--fg', palette.fg)
  root.style.setProperty('--fg-dim', palette.fgDim)
  root.style.setProperty('--accent', theme.accent)
  root.style.setProperty('color-scheme', isLight(palette) ? 'light' : 'dark')
}

/** xterm에 넘길 색. */
export function terminalTheme(theme: ThemeSettings): {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
} {
  const palette = paletteOf(theme)
  return {
    background: palette.bg,
    foreground: palette.fg,
    cursor: theme.accent,
    selectionBackground: isLight(palette) ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.22)'
  }
}
