# Session Canvas (가칭) — 시스템 명세서 (SPEC)

> 여러 개의 Claude Code 세션을 **하나의 무한 캔버스 위에 터미널 노드로 배치**해, 창을 찾고 켜고 끄는 시간 없이 한눈에 보고 조작하는 macOS 데스크톱 앱.

- 문서 버전: **v0.1** (착수용 초안)
- 최종 수정: 2026-09-20
- 상태: **구현 전.** 12장 구현 단계 0부터 시작한다.
- 대상 환경: macOS (Apple Silicon), 개인 개발 환경 전용
- 진행 상황과 함정은 구현하면서 **`HANDOVER.md`** 에 누적한다 (12.3 참조)

---

## 0. 이 문서를 읽는 Claude Code에게 — 작업 규칙

1. **이 문서가 정본이다.** 구현 중 문서와 다르게 해야 할 이유가 생기면, 코드만 바꾸지 말고 해당 절을 수정하고 15장 변경 이력에 한 줄 남긴다.
2. **12장의 단계 순서대로 진행한다.** 각 단계의 "완료 기준"을 모두 만족하기 전에 다음 단계로 넘어가지 않는다. 단계가 끝나면 커밋하고 `HANDOVER.md`를 갱신한다.
3. **13장 "확인 필요" 항목은 추측으로 구현하지 않는다.** 공식 문서나 실제 실행으로 확인한 뒤 구현하고, 확인 결과를 문서에 반영한다. 특히 Claude Code hooks 스키마(R1)는 반드시 최신 공식 문서(`https://docs.claude.com/en/docs/claude-code/hooks`)로 확인한다.
4. **사용자 전역 설정을 함부로 건드리지 않는다.** `~/.claude/settings.json`, `~/.tmux.conf`, `~/.zshrc` 등 앱 밖의 파일은 수정하지 않는다. 유일한 예외는 8.4의 훅 설치이며, 앱 UI에서 사용자가 명시적으로 동의했을 때만 백업 후 수행한다. 개발 중 테스트도 임시 HOME 또는 fixture 파일로 한다.
5. TypeScript `strict: true`, **`any` 금지**, React는 Function Component만 사용한다.
6. 사용자와의 대화·UI 문구는 한국어, 코드 식별자·커밋 메시지는 영어로 쓴다.

---

## 1. 개요

### 1.1 동기
macOS에서 여러 Claude Code 세션을 동시에 돌릴 때 iTerm 창을 여러 개 띄운다. 화면은 한정되어 있어 어떤 창은 줄이고, 어떤 창은 키우고, 어떤 창은 최소화하게 되고, 그 결과
- 필요한 터미널을 **찾는 시간**,
- 창을 **켜고 끄고 배치하는 조작 시간**,
- 어느 세션이 **내 입력을 기다리는지 모르는** 문제

가 작업 흐름을 계속 끊는다.

### 1.2 목표
1. 모든 세션을 **한 화면(무한 캔버스)** 에서 보고, 그 자리에서 바로 조작한다.
2. 각 터미널 위에 **이름과 설명**을 적어 무슨 작업인지 한눈에 구분한다.
3. **어느 세션이 입력을 기다리는지/끝났는지**를 색·기호·문구로 즉시 보여준다.
4. 앱을 끄거나 죽어도 **세션은 살아 있고**, 다시 켜면 그대로 붙는다.

### 1.3 한 줄 구조
```
[캔버스(React Flow)] ─ 노드마다 ─ [xterm.js] ⇄ IPC ⇄ [node-pty] ⇄ [tmux 세션] ⇄ [claude / zsh]
                                                                        │
                                              Claude Code hooks ──→ 상태 파일 ──→ 노드 상태 표시
```

---

## 2. 범위

### 2.1 MVP 범위
- 무한 캔버스(팬·줌) 위에 **터미널 노드** 생성·이동·리사이즈·닫기
- 노드마다 실제 PTY 터미널 (zsh, `claude`, 기타 CLI 모두 실행 가능)
- 노드 헤더의 **제목(한 줄)** + **설명(여러 줄)** 편집
- **tmux 기반 세션 영속성**: 앱 재시작 시 자동 재접속, 분리된 세션 복구
- **Claude Code 상태 감지**(hooks): 작업 중 / 입력 대기 / 완료 표시, macOS 알림, Dock 배지
- **줌 단계별 표시**(상세 / 미리보기 / 개요)와 WebGL 렌더러 개수 제한
- 레이아웃·메모 **자동 저장**
- 키보드 단축키(7.5)

### 2.2 명시적 비범위 (MVP 제외)
- 에이전트 간 출력 전달(터미널 → 터미널 파이프), 노드 간 연결선
- 브라우저 미리보기, 파일 에디터, git worktree 관리
- 원격(SSH) 세션, Windows/Linux 지원
- 다중 창, 다중 워크스페이스(워크스페이스는 1개)
- 클라우드 동기화, 공유
- 코드 서명·공증(notarization) — 로컬 빌드만
- Claude Code 외 CLI(Codex 등)의 상태 감지 — **실행은 되지만 상태 배지는 표시하지 않는다**

### 2.3 참고한 기존 프로젝트
같은 발상의 오픈소스가 있으므로 막히면 구현을 참고한다(코드 복사가 아니라 설계 참고).
- **Podium** (`github.com/abrahao-dev/podium-app`) — Tauri + React Flow + portable-pty. 무한 캔버스 위 터미널 노드, 헤더로만 드래그.
- **Mesa** (`github.com/Mesa-App/mesa-app`) — 프로젝트 노드에 터미널 부착, 레이아웃 자동 저장.
- **Cate** (`github.com/0-ai-ug/cate`) — 에이전트 인식 터미널이 있는 캔버스 IDE.

**차별점**: 이 앱은 tmux 영속성과 hooks 기반 "입력 대기" 감지를 핵심 기능으로 둔다.

---

## 3. 결정 사항

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| D1 | 앱 프레임워크 | **Electron + electron-vite + React + TypeScript** | node-pty 예제·자료가 가장 많아 MVP 속도 우선. Tauri 이전은 비범위 |
| D2 | PTY | **node-pty** | VS Code 터미널과 동일 계열. Electron 버전에 맞춘 네이티브 재빌드 필요(13장 R5) |
| D3 | 터미널 렌더링 | **@xterm/xterm** + addons (6장) | 사실상 표준 |
| D4 | 캔버스 | **@xyflow/react (React Flow)** | 노드 드래그·리사이즈·줌·미니맵 기본 제공 |
| D5 | 세션 백엔드 | **tmux, 전용 소켓 `-L session-canvas`** | 앱이 죽어도 세션 유지. 사용자 기존 tmux와 격리 |
| D6 | 상태 감지 | **Claude Code hooks → 상태 파일 → fs watch** | 출력 파싱보다 정확. 앱이 꺼져 있어도 상태가 파일에 남음 |
| D7 | 훅 설치 위치 | **`~/.claude/settings.json`(사용자 전역)에 병합, 환경변수로 가드** | 노드 안에서 `claude`를 어떻게 실행하든 동작. 앱 밖 세션에서는 훅이 즉시 종료 |
| D8 | 상태 관리 | **zustand** (renderer) | 가볍고 React 밖(터미널 레지스트리)에서도 접근 쉬움 |
| D9 | 영속 저장 | **JSON 파일** (`app.getPath('userData')/workspace.json`) | DB 불필요 규모 |
| D10 | 테스트 | **vitest** (단위), 수동 인수 체크리스트 (단계별) | |

> D7 대안: `claude --settings <파일>` 로 앱 전용 훅만 주입하는 방식. 전역 설정을 건드리지 않는 장점이 있으나, 노드 안에서 사용자가 `claude`를 직접 다시 실행하면 훅이 빠진다. 단계 4에서 이 플래그의 동작(기존 hooks와 병합되는지)을 확인해 보고, 더 낫다면 D7을 개정한다.

---

## 4. 아키텍처

### 4.1 프로세스 모델
```
┌──────────────── Main process (Node) ────────────────┐
│ LoginEnv       로그인 셸 환경변수(PATH) 해석          │
│ TmuxService    tmux 명령 실행 (ls / kill / has)        │
│ PtyManager     노드별 node-pty 생성·입출력·리사이즈    │
│ StatusWatcher  ~/.session-canvas/status/ 감시          │
│ HookInstaller  훅 스크립트 복사 + settings.json 병합   │
│ WorkspaceStore workspace.json 읽기/쓰기                │
│ Notifier       macOS 알림, Dock 배지                   │
└───────────────▲──────────────────────────────────────┘
                │ IPC (contextBridge, 10장 계약)
┌───────────────┴────── Renderer (React) ─────────────┐
│ Canvas (React Flow) → TerminalNode → XtermView      │
│ TerminalRegistry  노드별 Terminal 인스턴스 보관      │
│ workspace store (zustand)                            │
└──────────────────────────────────────────────────────┘
```

### 4.2 디렉터리 구조
```
session-canvas/
├─ SPEC.md  HANDOVER.md  README.md
├─ package.json  electron.vite.config.ts  tsconfig*.json
├─ resources/
│  ├─ tmux.conf                      # 5.2
│  └─ hooks/session-canvas-hook.sh   # 8.3
├─ scripts/
│  ├─ lib/cdp.mjs                    # CDP 점검 공용 도구 (14.3)
│  ├─ inspect-renderer.mjs           # 렌더러 스모크 확인 (14.3)
│  ├─ check-terminal.mjs             # 터미널 기능 확인 (14.3)
│  ├─ check-canvas.mjs               # 캔버스·다중 노드 확인 (14.3)
│  └─ check-persistence.mjs          # tmux·영속성 확인 (14.3)
├─ src/
│  ├─ shared/
│  │  ├─ types.ts                    # 9장 데이터 모델
│  │  └─ ipc.ts                      # 10장 채널 이름·페이로드 타입
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ env/loginEnv.ts
│  │  ├─ tmux/TmuxService.ts
│  │  ├─ tmux/buildArgs.ts           # 순수 함수, 단위 테스트 대상
│  │  ├─ pty/PtyManager.ts
│  │  ├─ status/StatusWatcher.ts
│  │  ├─ status/mapEvent.ts          # 순수 함수, 단위 테스트 대상
│  │  ├─ hooks/HookInstaller.ts
│  │  ├─ hooks/mergeSettings.ts      # 순수 함수, 단위 테스트 대상
│  │  ├─ workspace/WorkspaceStore.ts
│  │  ├─ workspace/serialize.ts      # 순수 함수, 단위 테스트 대상
│  │  ├─ notify/Notifier.ts
│  │  ├─ resources.ts                # resources/ 실제 파일 경로 해석
│  │  └─ ipc.ts
│  ├─ preload/index.ts
│  └─ renderer/
│     ├─ App.tsx
│     ├─ canvas/Canvas.tsx
│     ├─ nodes/TerminalNode.tsx
│     ├─ nodes/NodeHeader.tsx
│     ├─ nodes/NodeDescription.tsx
│     ├─ nodes/NewNodeDialog.tsx     # 7.2
│     ├─ nodes/DetachedSession.tsx   # 5.4 "세션 없음"
│     ├─ canvas/OrphanSessions.tsx   # 5.4 "분리된 세션"
│     ├─ devBridge.ts                # 개발 모드 점검 훅 (14.3)
│     ├─ terminal/TerminalRegistry.ts
│     ├─ terminal/XtermView.tsx
│     ├─ state/workspace.ts
│     └─ shortcuts/useShortcuts.ts
└─ tests/  (vitest, fixtures/)
```

### 4.3 실행 환경 요구사항
- macOS 14+, Node.js 20+, **tmux 3.3+** (`brew install tmux`), Claude Code CLI 설치
- 앱 시작 시 `tmux -V`로 버전을 확인하고, 없거나 낮으면 **설치 안내 화면**을 띄운다(앱이 죽으면 안 된다).

### 4.4 ⚠️ PATH 문제 (반드시 처리)
Finder/Dock에서 실행한 macOS 앱은 **사용자 셸의 PATH를 물려받지 않는다.** `/opt/homebrew/bin`의 `tmux`, `claude`를 찾지 못한다.
- 앱 시작 시 `$SHELL -ilc 'env'` 로 로그인 셸 환경을 한 번 읽어 main 프로세스 환경으로 사용한다(`shell-env` 패키지 사용 가능).
- 모든 `tmux` 호출과 PTY 생성은 이 환경을 쓴다.
- PTY에는 `TERM=xterm-256color`, `COLORTERM=truecolor`를 더해 준다(트루컬러).
- 로케일이 UTF-8이 아니면 한글이 깨진다. 로그인 셸 환경에 `LANG`이 없으면 `ko_KR.UTF-8`을 기본값으로 넣는다.
- 개발 모드(`npm run dev`)에서는 터미널의 PATH를 물려받아 문제가 가려지므로, 단계 6에서 **패키징된 앱으로 반드시 재확인**한다.

---

## 5. 세션 백엔드 (tmux)

### 5.1 원칙
- 노드 1개 = tmux 세션 1개. 세션 이름은 **`sc-<nodeId>`**.
- 앱은 tmux의 **클라이언트(뷰어)** 일 뿐이다. 실제 프로세스는 tmux 서버가 소유한다.
- 모든 호출에 **`-L session-canvas -f <resources/tmux.conf>`** 를 붙여 사용자 기본 tmux 서버·설정과 격리한다.

### 5.2 `resources/tmux.conf`
tmux의 존재를 사용자가 거의 느끼지 않게 하는 것이 목표다.
```tmux
set -g status off                 # 상태줄 숨김
set -g prefix None                # 프리픽스 키 비활성 (Ctrl+B가 Claude Code로 그대로 전달)
unbind C-b
set -g escape-time 0              # Esc 지연 제거 — Claude Code의 Esc(중단) 반응성에 필수
set -g mouse on                   # 휠 스크롤 → tmux 스크롤백 (6.4)
set -g history-limit 50000
set -g default-terminal "tmux-256color"
set -as terminal-features ",xterm-256color:RGB"      # 트루컬러
set -g extended-keys on                              # Shift+Enter 등 (13장 R2)
set -as terminal-features ",xterm-256color:extkeys"
set -g set-clipboard on           # OSC 52 → xterm → 시스템 클립보드
set -g allow-passthrough on
set -g focus-events on
set -g window-size latest
```
> 옵션 이름·지원 여부는 설치된 tmux 버전에서 `tmux -L session-canvas -f resources/tmux.conf start-server \; show -g` 로 오류 없이 로드되는지 확인한다.

### 5.3 생명주기

| 동작 | 명령 (모두 `-L session-canvas -f conf` 포함) | 비고 |
|---|---|---|
| 생성/재접속 | node-pty로 `tmux new-session -A -s sc-<id> -c <cwd> -e SESSION_CANVAS_NODE_ID=<id> <launch>` 실행 | `-A`: 이미 있으면 붙기만 한다(이때 `-c`, `-e`, `<launch>`는 무시됨) |
| 노드 닫기(분리) | PTY만 kill | tmux 세션은 살아 있음. **기본 동작** |
| 세션 종료 | `tmux kill-session -t sc-<id>` 후 PTY 정리 | 확인 대화상자 필수 |
| 존재 확인 | `tmux has-session -t sc-<id>` | |
| 목록 | `tmux list-sessions -F '#{session_name}'` | 서버가 없으면 오류 → 빈 목록으로 처리 |

**`<launch>` 규칙** — 명령이 끝나도 셸이 남아야 한다(iTerm과 같은 경험):
- `command`가 있으면: `$SHELL -l -c '<command>; exec $SHELL -l'`
- 없으면: `$SHELL -l`
- 기본 `command`는 `claude`. 따옴표 이스케이프는 `buildArgs.ts`에서 처리하고 단위 테스트한다.

### 5.4 시작 시 복구 흐름
```
앱 시작 → workspace.json 로드 → tmux list-sessions
  ├─ 워크스페이스에 있고 세션도 있음   → 자동 재접속 (new-session -A)
  ├─ 워크스페이스에 있는데 세션이 없음 → 노드에 "세션 없음" 상태 표시 (재부팅 등)
  │      [새로 시작]  [이전 대화 이어서]  ← claudeSessionId가 있을 때만: `claude --resume <id>`
  └─ 세션은 있는데 워크스페이스에 없음 → "분리된 세션" 목록에 표시, 클릭 시 노드로 복원
```

---

## 6. 터미널 렌더링 (xterm.js)

### 6.1 애드온
| 애드온 | 용도 |
|---|---|
| `@xterm/addon-fit` | 노드 크기 → cols/rows 계산 → `pty.resize` |
| `@xterm/addon-webgl` | 빠른 렌더링 (개수 제한, 6.3) |
| `@xterm/addon-unicode11` | **한글 등 전각 문자 폭 계산** — 활성화 필수 |
| `@xterm/addon-clipboard` | OSC 52 처리 (tmux·Claude Code 클립보드) |
| `@xterm/addon-web-links` | URL 클릭 → 기본 브라우저 |

### 6.2 한국어
- 한글 IME 조합 입력이 깨지지 않아야 한다(조합 중 글자 위치, 확정 시 중복 입력 없음). **단계 1 완료 기준에 포함.**
- 폰트: 사용자 설정 가능, 기본값 `"D2Coding", "Sarasa Mono K", Menlo, monospace`.

### 6.3 렌더러 정책 (WebGL 개수 제한)
Chromium은 동시에 살아 있는 WebGL 컨텍스트 수에 제한이 있어(대략 16개), 넘으면 오래된 것부터 끊긴다.
- **WebGL은 "포커스된 노드 + 최근 포커스된 노드" 최대 `WEBGL_MAX`(기본 4)개**에만 붙인다. 나머지는 DOM 렌더러.
- `webglcontextlost` 발생 시 해당 노드를 DOM 렌더러로 되돌린다(앱이 멈추면 안 됨).

### 6.4 터미널 인스턴스 보존
React 노드가 언마운트되어도 터미널 버퍼가 사라지면 안 된다.
- `TerminalRegistry`가 노드별 `{ terminal, hostEl }`을 React 바깥에서 보관한다. `terminal.open(hostEl)`은 **최초 1회만**.
- `XtermView`는 마운트 시 `hostEl`을 자기 DOM에 붙이고(append), 언마운트 시 떼어낼 뿐 `dispose`하지 않는다.
- `dispose`는 노드를 닫거나 세션을 종료할 때만.

### 6.5 확장 키 (Shift+Enter)
단계 3에서 확인한 결과(13장 R2): **xterm은 Shift+Enter를 그냥 Enter와 똑같이 보낸다.** 터미널이 구별해 주지 않으므로 tmux의 `extended-keys on`만으로는 Claude Code가 알 수 없다.
- `attachCustomKeyEventHandler`에서 Shift+Enter를 가로채 **`ESC CR`(`\u001b\r`)** 로 보낸다. iTerm에서 `claude`의 `/terminal-setup`이 설정하는 것과 같은 바이트다.
- Option+Enter는 원래부터 `ESC CR`이라 손대지 않는다.
- 이것은 터미널 전체에 적용된다. 셸에서 Shift+Enter는 이제 `M-RET`가 되는데, 원래 Enter와 구별되지 않던 키라 잃는 것이 없다.

### 6.6 스크롤·선택
- tmux `mouse on`이므로 휠은 tmux 스크롤백으로 간다.
- `macOptionClickForcesSelection: true` → Option+드래그로 xterm 자체 선택도 가능.
- `macOptionIsMeta`는 설정으로 둔다(기본 false).

---

## 7. 캔버스 · 노드 UX

### 7.1 노드 구성
```
┌──────────────────────────────────────────────────────┐
│ ● 입력 대기   LectureMate 백엔드          [⤢] [×]   │ ← 헤더 (드래그 핸들)
│ ~/dev/lecturemate · main                             │ ← 경로 · git 브랜치 (단계 6)
├──────────────────────────────────────────────────────┤
│ Spring Boot 3.5 업그레이드 중. 테스트 깨지면 멈춤     │ ← 설명 (접기/펼치기)
├──────────────────────────────────────────────────────┤
│                                                      │
│                 터미널 (xterm)                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```
- **제목**: 한 줄, 클릭하면 인라인 편집. 비어 있으면 placeholder로 `cwd`의 폴더명 표시.
- **설명**: 여러 줄 평문. 접힌 상태에서는 최대 2줄 + 말줄임, 클릭하면 편집.
- **드래그는 헤더로만** (React Flow `dragHandle`). 터미널 영역에는 `nodrag nowheel nopan` 클래스를 붙여 캔버스 조작과 충돌하지 않게 한다.
- 리사이즈: React Flow `NodeResizer`, 최소 360×220px. 리사이즈 종료 시 fit → `pty.resize`.
  - `NodeResizer`는 노드가 **선택됐을 때만** 핸들을 보여준다. React Flow를 제어 모드로 쓰면 선택 상태도 앱이 들고 있어야 한다 — 안 그러면 핸들이 영영 안 나타난다. 선택은 화면 상태라 `workspace.json`에는 넣지 않는다.
- 색 라벨(선택): 헤더 좌측 띠 색. 단계 6.
- 헤더 `×`를 누르면 **닫기(분리)** 와 **세션 종료** 중에서 고르게 한다. 기본은 분리이고, 종료만 파괴적이라 같은 자리에서 한 번 더 확인하는 셈이 된다 (5.3).
- **네이티브 `confirm`/`alert`을 쓰지 않는다.** 렌더러를 멈춰 세우고, CDP 기반 점검(14.3)도 막힌다. 확인 UI는 앱 안에서 그린다.

### 7.2 노드 생성
`Cmd+N` 또는 빈 캔버스 더블클릭 → 대화상자:
- 작업 폴더(필수, 디렉터리 선택 창) · 제목(선택) · 실행 명령(기본 `claude`, 비우면 셸만)
- 생성 위치: 더블클릭 지점 또는 현재 뷰포트 중앙. 기존 노드와 겹치면 오른쪽으로 밀어 배치.

### 7.3 줌 단계 (semantic zoom)
CSS transform으로 확대·축소된 터미널은 글자가 뭉개지므로, 줌 배율에 따라 역할을 나눈다.

| 단계 | 줌 | 표시 | 입력 |
|---|---|---|---|
| 상세 | ≥ 0.75 | 실제 터미널 | 가능 |
| 미리보기 | 0.4 ~ 0.75 | 실제 터미널 (흐려도 됨) | **불가** — 클릭하면 해당 노드로 줌인 |
| 개요 | < 0.4 | 터미널 숨기고 **큰 제목 + 설명 + 상태 배지** 카드 | 불가 — 클릭하면 줌인 |

- 경계값은 설정 상수로 둔다.
- "노드로 줌인" = 해당 노드가 화면에 들어오도록 **줌 1.0**으로 이동(애니메이션 200ms) 후 터미널 포커스.

### 7.4 캔버스 조작
- 트랙패드 두 손가락 스크롤: 포인터가 **포커스된 터미널 위**면 터미널 스크롤, 아니면 캔버스 팬.
- 핀치: 항상 캔버스 줌.
- 미니맵: 우하단, 노드를 상태 색으로 표시.

### 7.5 키보드 단축키
**원칙: 포커스된 터미널에는 모든 키를 그대로 넘긴다.** 앱 단축키는 `Cmd` 조합만 쓴다. `Esc`, `Shift+Tab`, `Ctrl+*`, `Option+*`은 절대 가로채지 않는다(Claude Code가 사용).

> ⚠️ React Flow의 기본 `deleteKeyCode`는 `Backspace`다. 그대로 두면 터미널에서 백스페이스를 칠 때 노드가 삭제된다. `deleteKeyCode={null}`로 비워 둔다.

| 키 | 동작 |
|---|---|
| `Cmd+N` | 새 노드 |
| `Cmd+0` | 전체 보기 (fit view) |
| `Cmd+1` ~ `Cmd+9` | 생성 순서 n번째 노드로 줌인·포커스 |
| `Cmd+J` | 다음 "주의 필요"(입력 대기 → 완료 순) 노드로 이동 |
| `Cmd+Enter` | 현재 노드 줌인 ↔ 직전 뷰로 복귀 토글 |
| `Cmd+W` | 현재 노드 닫기(분리). 세션은 유지 |
| `Cmd+C` / `Cmd+V` | 복사(선택 있을 때) / 붙여넣기 |
| `Cmd+=` / `Cmd+-` | 포커스된 터미널 글자 크기 |

---

## 8. 상태 감지 (Claude Code hooks)

### 8.1 상태 정의
색만으로 전달하지 않는다. **기호 + 문구 + 색**을 함께 표시한다.

| 상태 | 기호 | 문구 | 색 | 의미 |
|---|---|---|---|---|
| `unknown` | ○ | 대기 | 회색 | Claude Code 외 명령, 또는 아직 이벤트 없음 |
| `working` | ◐ | 작업 중 | 파랑 | 프롬프트 제출 후 도구 실행 중 |
| `waiting` | ● | 입력 대기 | 주황, 테두리 펄스 | 권한 요청·입력 대기 알림 |
| `done` | ✓ | 완료 | 초록 | 응답 종료, 아직 확인 안 함 |
| `detached` | – | 세션 없음 | 회색 점선 | tmux 세션이 없음 (5.4) |

- `waiting`, `done`은 **unseen** 플래그를 가진다. 사용자가 그 노드에 포커스하면 unseen이 해제되고, `done`은 `unknown`으로 내려간다.

### 8.2 이벤트 → 상태 매핑 (`mapEvent.ts`, 순수 함수)
| hook 이벤트 | 상태 | 추가 처리 |
|---|---|---|
| `SessionStart` | `unknown` | `session_id` → 노드의 `claudeSessionId`에 저장 (resume용) |
| `UserPromptSubmit` | `working` | |
| `PreToolUse`, `PostToolUse` | `working` | 권한 승인 후 `waiting` → `working` 복귀에 필요 |
| `Notification` | `waiting` | |
| `Stop` | `done` | |
| `SessionEnd` | `unknown` | |

> ⚠️ 이벤트 이름, stdin JSON 필드(`session_id`, `hook_event_name`, `cwd` 등), matcher 문법은 **단계 4 시작 시 공식 문서로 확인**하고 이 표를 고친다(R1). 모르는 이벤트는 무시한다(앱이 죽으면 안 됨).

### 8.3 훅 스크립트 `resources/hooks/session-canvas-hook.sh`
- 외부 의존성 없음(jq 사용 금지). stdin JSON을 **그대로** 파일에 저장하고, 파싱은 앱이 한다.
- 앱 밖에서 실행된 Claude Code에서는 **즉시 종료**한다.
- 항상 `exit 0`, stdout 출력 없음 — Claude Code 동작에 절대 영향을 주지 않는다.
```sh
#!/bin/sh
# Claude Code hook → Session Canvas 상태 파일. 앱 밖 세션에서는 아무것도 하지 않는다.
id="$SESSION_CANVAS_NODE_ID"
[ -z "$id" ] && exit 0
case "$id" in *[!A-Za-z0-9_-]*) exit 0 ;; esac   # 경로 조작 방지
dir="$HOME/.session-canvas/status"
mkdir -p "$dir" 2>/dev/null || exit 0
tmp="$(mktemp "$dir/.tmp.XXXXXX" 2>/dev/null)" || exit 0
cat > "$tmp" 2>/dev/null
mv -f "$tmp" "$dir/$id.json" 2>/dev/null
exit 0
```
- 노드당 파일 1개, 항상 **최신 이벤트로 덮어쓴다**(원자적 mv).
- `SESSION_CANVAS_NODE_ID`는 5.3에서 tmux `-e`로 주입되며, 그 안에서 실행한 `claude`와 훅 프로세스가 상속한다.

### 8.4 훅 설치 (`HookInstaller`)
- 설정 화면의 **[상태 감지 켜기]** 버튼 + 동의 대화상자("~/.claude/settings.json에 훅을 추가합니다. 원본은 백업됩니다.")를 거쳐서만 실행한다.
- 절차:
  1. 스크립트를 `~/.session-canvas/bin/session-canvas-hook.sh`로 복사, `chmod 755`
  2. `~/.claude/settings.json`을 `settings.json.bak-<YYYYMMDD-HHmmss>`로 백업
  3. 8.2의 각 이벤트에 훅 항목을 **추가 병합**(`mergeSettings.ts`). 명령 경로는 **절대경로**(`~` 금지)
  4. JSON 파싱 실패 시 아무것도 쓰지 않고 오류 표시
- **멱등**: 같은 명령 경로가 이미 있으면 추가하지 않는다. 사용자의 기존 hooks·기타 설정은 한 글자도 바꾸지 않는다.
- **[상태 감지 끄기]**: 우리 명령 경로를 가진 항목만 제거.
- 설치 상태(`installed | not-installed | outdated`)를 설정 화면에 표시.

### 8.5 StatusWatcher
- `~/.session-canvas/status/`를 감시(chokidar 또는 `fs.watch` + 디바운스 50ms). `.tmp.*`는 무시.
- 파일 → JSON 파싱 → `mapEvent` → renderer에 `status:changed` 전송.
- 앱 시작 시 기존 파일을 한 번 읽어 초기 상태로 쓴다. 단, 파일 mtime이 tmux 세션 생성 시각보다 오래되었으면 무시.
- 워크스페이스에 없는 노드 id의 파일은 무시(삭제하지 않음).

### 8.6 알림
- 상태가 `waiting` 또는 `done`으로 바뀌었고, **앱 창이 비활성이거나 그 노드가 화면 밖/개요 단계**일 때 macOS 알림을 띄운다.
  - 제목: 노드 제목 / 본문: `입력을 기다리고 있어요` 또는 `작업이 끝났어요`
  - 클릭 → 앱 활성화 + 해당 노드로 줌인
- Dock 배지 = unseen인 `waiting` + `done` 노드 수.
- 설정에서 알림 끄기 가능.

---

## 9. 데이터 모델 · 영속성

### 9.1 타입 (`src/shared/types.ts`)
```ts
export type NodeId = string; // nanoid(10), [A-Za-z0-9_-]만 허용

export interface TerminalNodeData {
  id: NodeId;
  title: string;                 // 빈 문자열 허용 → UI에서 폴더명 표시
  description: string;
  cwd: string;                   // 절대경로
  command: string | null;        // 기본 "claude", null이면 셸만
  tmuxSession: string;           // `sc-${id}`
  claudeSessionId: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  color: string | null;
  createdAt: string;             // ISO 8601
  updatedAt: string;
}

export interface Workspace {
  version: 1;
  viewport: { x: number; y: number; zoom: number };
  nodes: TerminalNodeData[];
  settings: {
    webglMax: number;            // 기본 4
    notifications: boolean;      // 기본 true
    fontFamily: string;
    fontSize: number;            // 기본 13
  };
}

export type SessionState = 'unknown' | 'working' | 'waiting' | 'done' | 'detached';

export interface NodeStatus {
  nodeId: NodeId;
  state: SessionState;
  unseen: boolean;
  at: string;                    // 이벤트 시각
}
```
- **상태(`NodeStatus`)는 저장하지 않는다.** 상태 파일과 tmux에서 매번 재구성한다.

### 9.2 저장
- 위치: `app.getPath('userData')/workspace.json`
- 변경 후 **500ms 디바운스**, 임시 파일에 쓰고 rename(원자적). 직전 버전 1개를 `workspace.json.bak`로 유지.
- 로드 실패(파싱 오류) 시 `.bak`로 시도, 그래도 실패하면 빈 워크스페이스로 시작하고 손상 파일은 `workspace.corrupt-<시각>.json`으로 보존.
- `version` 필드로 마이그레이션한다. 알 수 없는 상위 버전이면 읽기 전용 경고.

---

## 10. IPC 계약 (`src/shared/ipc.ts`)

preload가 `window.api`로 노출한다. **renderer는 Node API에 직접 접근하지 않는다.**

```ts
interface Api {
  pty: {
    // main이 실제로 필요한 것만 넘긴다(SPEC 11의 입력 검증 대상을 좁힌다).
    // cwd가 null이면 main이 홈 디렉터리를 쓴다.
    open(req: PtyOpenRequest, cols: number, rows: number): Promise<void>; // new-session -A
    write(id: NodeId, data: string): void;
    resize(id: NodeId, cols: number, rows: number): void;
    detach(id: NodeId): Promise<void>;          // PTY만 종료
    kill(id: NodeId): Promise<void>;            // tmux kill-session
    onData(cb: (id: NodeId, data: string) => void): Unsubscribe;
    onExit(cb: (id: NodeId, code: number) => void): Unsubscribe;
  };
  workspace: {
    // 9.2의 복구 경로(백업에서 복구·손상·상위 버전)를 renderer가 알아야 하므로
    // Workspace만 주지 않고 상태와 안내 문구를 함께 준다.
    load(): Promise<{
      workspace: Workspace;
      status: 'ok' | 'empty' | 'recovered-from-backup' | 'corrupt' | 'unsupported-version';
      message: string | null;
    }>;
    save(ws: Workspace): void;                  // main에서 디바운스
  };
  status: {
    onChange(cb: (s: NodeStatus & { claudeSessionId?: string }) => void): Unsubscribe;
  };
  tmux: {
    check(): Promise<{ ok: boolean; version: string | null }>;
    // 되살릴 때 폴더를 보여줘야 해서 세션의 `#{session_path}`까지 준다.
    listOrphans(known: NodeId[]): Promise<{ id: NodeId; cwd: string }[]>;
    exists(id: NodeId): Promise<boolean>;
  };
  hooks: {
    state(): Promise<'installed' | 'not-installed' | 'outdated'>;
    install(): Promise<void>;
    uninstall(): Promise<void>;
  };
  dialog: { pickDirectory(): Promise<string | null> };
  app: { setBadge(n: number): void; onNotificationClick(cb: (id: NodeId) => void): Unsubscribe };
}
```
```ts
type PtyOpenRequest = Pick<TerminalNodeData, 'id' | 'command'> & { cwd: string | null };
```

- PTY 출력은 노드별로 **약 8ms 단위로 묶어** 전송한다(대량 출력 시 IPC 폭주 방지).
- 같은 노드 id로 `open`이 다시 오면 이전 PTY를 정리하고 갈아끼운다. **교체된 PTY의 뒤늦은 data/exit 이벤트는 버린다** — id만 보고 처리하면 새 세션을 죽인다(단계 1에서 실제로 발생).

---

## 11. 보안
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`(preload 제외 가능 범위 내).
- 원격 URL을 로드하지 않는다. 외부 링크는 `shell.openExternal`로만 연다.
- CSP 설정: `default-src 'self'`.
- IPC 핸들러는 입력을 검증한다: `NodeId` 패턴, `cwd`는 존재하는 디렉터리, `command`는 문자열 길이 제한.
- 셸 명령은 문자열 연결이 아닌 **인자 배열**로 실행한다(`execFile`, node-pty args). 예외인 `<launch>` 문자열은 `buildArgs.ts`에서만 만들고 테스트한다.

---

## 12. 구현 단계

### 12.1 단계와 완료 기준

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **0** 골격 | electron-vite(react-ts) 생성, TS strict, ESLint+Prettier, vitest, node-pty 설치·Electron용 재빌드 | `npm run dev`로 빈 창이 뜬다 · `npm test` 통과 · `npm run lint` 통과 · node-pty import 시 오류 없음 |
| **1** 단일 터미널 | 창 하나에 xterm + node-pty(직접 zsh). fit·unicode11·clipboard·web-links. 4.4 LoginEnv | zsh에서 `ls`, `vim`, `claude` 정상 동작 · **한글 입력/출력 정상** · 창 리사이즈 시 줄바꿈 정상 · 트루컬러 표시 |
| **2** 캔버스 · 다중 노드 | React Flow, TerminalNode, 헤더 드래그, 리사이즈, 생성 대화상자, 제목·설명 편집, TerminalRegistry(6.4). PTY는 아직 직접 spawn | 노드 3개 이상 동시 동작 · 드래그/리사이즈 중 터미널 입력과 충돌 없음 · 캔버스를 팬/줌해도 터미널 내용 유지 · Esc/Shift+Tab이 Claude Code에 전달됨 |
| **3** tmux · 영속성 | TmuxService, tmux.conf, `new-session -A`, WorkspaceStore, 5.4 복구 흐름, 분리된 세션 목록, 닫기 vs 종료 | **앱을 강제 종료 후 재실행해도 모든 세션이 그대로** · 레이아웃·제목·설명 복원 · tmux 상태줄 안 보임 · Ctrl+B가 그대로 전달됨 · 휠 스크롤 동작 · 사용자 기본 tmux 서버에 영향 없음(`tmux ls`에 안 보임) |
| **4** 상태 감지 | R1 확인 → 8장 전체. 훅 스크립트, HookInstaller, StatusWatcher, 상태 배지, 알림, Dock 배지 | 프롬프트 제출 → "작업 중" · 권한 요청 → "입력 대기" · 응답 종료 → "완료" · 포커스 시 unseen 해제 · 앱 밖 iTerm의 Claude Code에는 영향 없음 · 설치/제거가 기존 settings.json을 보존(백업 확인) |
| **5** 줌 단계 · 성능 | 7.3 semantic zoom, 6.3 WebGL 정책, 7.5 단축키, 미니맵 | 노드 10개에서 스크롤·타이핑 끊김 없음 · WebGL 컨텍스트가 `WEBGL_MAX` 초과하지 않음 · 개요 단계에서 제목·상태만 보임 · 모든 단축키 동작 |
| **6** 다듬기 · 패키징 | git 브랜치 표시(포커스 시 + 30초 주기), 색 라벨, 설정 화면, electron-builder로 로컬 `.app` 빌드 | **패키징된 앱을 Finder에서 실행해도** tmux·claude를 찾음(4.4) · 설치 안내 화면 동작 |

### 12.2 이후 후보 (MVP 이후, 착수 전 문서 개정 필요)
- 커맨드 팔레트(`Cmd+K`)로 노드 검색
- 노드 그룹(프로젝트별 묶음)
- Codex 등 다른 CLI 상태 감지
- 노드 간 출력 전달

### 12.3 HANDOVER.md
단계가 끝날 때마다 다음을 갱신한다: 완료된 단계, 현재 동작하는 것, 알려진 버그, 13장 R 항목 확인 결과, 다음에 할 일, 삽질 기록(원인과 해결).

---

## 13. 위험 · 확인 필요

| # | 항목 | 확인 방법 | 시점 |
|---|---|---|---|
| R1 | Claude Code hooks 이벤트 이름·stdin 필드·matcher 문법, `--settings` 플래그 동작 | 공식 문서 + 실제 훅으로 stdin 덤프 | 단계 4 시작 |
| R2 | tmux 안에서 Claude Code의 **Shift+Enter(줄바꿈)** 등 확장 키 | 실행해 보고 안 되면 xterm/tmux 설정 조정 | 단계 3 |
| R3 | Electron + xterm.js의 **한글 IME** 조합 입력 | 직접 타이핑 테스트 | 단계 1 |
| R4 | tmux 안 Claude Code 렌더링(깜빡임, 색, 스피너) | iTerm 직접 실행과 비교 | 단계 3 |
| R5 | node-pty 네이티브 모듈의 Electron 버전 재빌드 | `@electron/rebuild` 또는 electron-vite 설정 | 단계 0 |
| R6 | WebGL 컨텍스트 제한 동작 | 노드 20개 생성 후 콘솔 경고 확인 | 단계 5 |
| R7 | 대량 출력(빌드 로그 등) 시 IPC·렌더링 성능 | `yes` / `cat 대용량파일`로 부하 테스트 | 단계 5 |
| R8 | 재부팅 후 tmux 세션 소멸 → resume 흐름 | tmux 서버 kill 후 앱 재시작 | 단계 4 |

---

## 14. 테스트

### 14.1 단위 테스트 (vitest) — 필수
- `buildArgs.ts`: 세션 이름, `-e` 환경변수, `<launch>` 인용 처리(공백·따옴표·한글 경로 포함 cwd)
- `mapEvent.ts`: 8.2 표의 모든 이벤트, 알 수 없는 이벤트, 깨진 JSON
- `mergeSettings.ts`: 빈 설정 / 기존 hooks 보존 / 멱등성(두 번 설치해도 1개) / 제거 시 우리 항목만 삭제 / 파싱 실패 시 무변경
- Workspace 직렬화: 저장→로드 왕복 동일, 버전 마이그레이션, 손상 파일 처리
- 상태 전이: unseen 설정·해제, 포커스 시 `done → unknown`

### 14.2 통합 테스트
- tmux가 설치된 환경에서만 실행(`describe.skipIf`): 세션 생성 → has-session → kill → 목록에서 사라짐. **전용 소켓 이름에 테스트용 접미사**를 붙여 실제 세션과 충돌하지 않게 한다.
- 앱을 띄워서 하는 점검(14.3)도 같은 격리가 필요하다. 소켓은 환경변수 `SESSION_CANVAS_TMUX_SOCKET`으로, 워크스페이스 파일은 Electron의 `--user-data-dir`로 갈아끼운다.
- 훅 스크립트: 임시 HOME으로 stdin 주입 → 상태 파일 생성 확인, 환경변수 없을 때 파일 미생성 확인, 잘못된 id 거부 확인.

### 14.3 수동 인수 테스트
12.1의 각 단계 완료 기준을 체크리스트로 `HANDOVER.md`에 기록하고 체크한다.

기계로 확인할 수 있는 항목은 `npm run verify:renderer`(`scripts/inspect-renderer.mjs`)와 `npm run verify:terminal`(`scripts/check-terminal.mjs`)로 대신한다. 앞의 것은 렌더러가 제대로 떴는지를, 뒤의 것은 터미널 기능(키 입력 전달, 한글 출력·전각 폭, IME 조합 입력, 트루컬러, 리사이즈 전달, PATH 해석, TUI)을 확인한다. 개발 앱을 Chrome DevTools Protocol 원격 디버깅 포트와 함께 띄워 렌더러에 직접 질의하고(창·React 마운트·`window.api`·Node 격리·콘솔 오류·node-pty 로드) 확인 후 종료한다. macOS 손쉬운 사용/화면 기록 권한이 필요 없고, 스크린샷과 달리 렌더 성공 여부를 판정할 수 있다.

> ⚠️ 원격 디버깅 포트는 이 확인 중에만 열고(127.0.0.1 바인딩) 바로 닫는다. **`npm run dev`에는 절대 넣지 않는다** — 그 포트에 접근할 수 있는 누구나 렌더러에서 임의 JS를 실행할 수 있다.

---

## 15. 변경 이력
| 버전 | 일자 | 내용 |
|---|---|---|
| v0.1 | 2026-09-20 | 초안. Electron + React Flow + xterm.js + node-pty + tmux 구조 확정, hooks 기반 상태 감지 설계, 단계 0~6 정의 |
| v0.1.1 | 2026-09-20 | 단계 0 진행 중 수정: §0.1의 "14장 변경 이력" → "15장 변경 이력"(14장은 테스트, 변경 이력은 15장). §4.2에 없지만 골격에 필요한 파일(`src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/index.css`, `vitest.config.ts`, `electron-builder.yml`, `eslint.config.mjs`, `build/`)을 추가. 렌더러 소스는 electron-vite 템플릿의 `src/renderer/src/` 대신 §4.2대로 `src/renderer/` 바로 아래에 둔다 |
| v0.1.2 | 2026-09-20 | §4.2에 `scripts/inspect-renderer.mjs` 추가, §14.3에 CDP 기반 렌더러 스모크 확인 절차와 원격 디버깅 포트 주의사항 명시 |
| v0.1.3 | 2026-09-20 | 단계 1 구현 중 개정: §10 `pty.open`이 `TerminalNodeData` 전체 대신 `PtyOpenRequest`(id·cwd·command)를 받는다, 재오픈 시 이전 PTY 이벤트 폐기 규칙 추가. §4.4에 PTY 환경변수(`TERM`·`COLORTERM`·`LANG`) 규칙 추가. §4.2·§14.3에 `scripts/check-terminal.mjs`와 `scripts/lib/cdp.mjs` 추가 |
| v0.1.4 | 2026-09-20 | 단계 2 구현 중 개정: §7.1에 `NodeResizer`의 선택 상태 요구사항, §7.5에 React Flow `deleteKeyCode` 주의 추가. §4.2에 `nodes/NodeDescription.tsx`·`nodes/NewNodeDialog.tsx`·`devBridge.ts`·`scripts/check-canvas.mjs` 추가 |
| v0.1.5 | 2026-09-20 | 단계 3 구현 중 개정: §10 `workspace.load`가 복구 상태·안내를 함께 주고 `tmux.listOrphans`가 세션 폴더까지 준다. §7.1에 닫기(분리)/세션 종료 선택과 네이티브 대화상자 금지 명시. §14.2에 점검용 소켓·userData 격리 방법 추가. §4.2에 `main/resources.ts`·`main/workspace/serialize.ts`·`nodes/DetachedSession.tsx`·`canvas/OrphanSessions.tsx`·`scripts/check-persistence.mjs` 추가 |
| v0.1.6 | 2026-09-20 | 단계 3 R2 확인 결과 반영: §6.5 신설 — xterm이 Shift+Enter를 Enter와 구별하지 않으므로 `ESC CR`로 바꿔 보낸다. 기존 6.5(스크롤·선택)는 6.6으로 밀림 |
