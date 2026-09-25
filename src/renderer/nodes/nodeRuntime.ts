/**
 * 노드 런타임 계약 (SPEC 18.3).
 *
 * 노드는 종류마다 무거운 자원을 쥔다 — 터미널은 PTY와 xterm 인스턴스,
 * 앞으로 생길 종류는 파일 와처나 transcript 리더를 쥘 것이다.
 *
 * 공통 규칙(SPEC 6.4에서 터미널로 먼저 확립한 것):
 *  - 자원은 **React 바깥**에 둔다. 컴포넌트가 언마운트돼도 살아 있어야 한다
 *  - 화면에서 떼는 것(`detach`)과 실제로 끝내는 것(`dispose`)은 다르다
 *  - `dispose`는 노드를 닫을 때만 부른다
 *
 * 지금 이 계약을 만족하는 것은 `TerminalRegistry` 하나다. 추상 레지스트리를
 * 미리 만들지 않는다 — 두 번째 종류가 생길 때 실제 필요에 맞춰 만든다.
 * 여기서는 **따라갈 모양**만 정의한다.
 */
import type { NodeId } from '@shared/types'

export interface NodeRuntime<TEntry, TNode> {
  /** 없으면 만들고, 있으면 `container`에 다시 붙인다. */
  acquire(node: TNode, container: HTMLElement): TEntry
  /** 지금 쥐고 있는 것을 돌려준다. 없으면 undefined. */
  get(id: NodeId): TEntry | undefined
  /** 노드를 닫을 때만. `mode`는 종류마다 뜻이 다르다(터미널: 분리/종료). */
  dispose(id: NodeId, mode: string): void
  /** 화면에서 떼어내도 자원이 살아 있어야 하는가. */
  readonly survivesUnmount: boolean
}
