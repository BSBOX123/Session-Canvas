/// <reference types="vite/client" />

import type { Terminal } from '@xterm/xterm'

declare global {
  interface Window {
    /** 개발 모드 전용 점검 훅 (SPEC 14.3). 프로덕션 빌드에는 없다. */
    __sessionCanvas?: { terminals: Record<string, Terminal> }
  }
}

export {}
