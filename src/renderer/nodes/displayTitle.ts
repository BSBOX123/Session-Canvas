import type { TerminalNodeData } from '@shared/types'

/** 빈 제목은 cwd의 폴더명으로 대신 보여준다 (SPEC 7.1). */
export function displayTitle(node: TerminalNodeData): string {
  if (node.title.trim().length > 0) return node.title
  const { cwd } = node.terminal
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}
