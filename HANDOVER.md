# HANDOVER — Session Canvas

> 구현 진행 상황과 삽질 기록. SPEC 12.3에 따라 단계가 끝날 때마다 갱신한다.
> 정본 명세는 `SPEC.md`.

- 최종 갱신: 2026-09-20
- 현재 단계: **단계 3 (tmux·영속성) 완료.** 다음은 단계 4(상태 감지).

---

## 1. 완료된 단계

| 단계 | 상태 | 비고 |
|---|---|---|
| 0 골격 | ✅ 완료 (2026-09-20) | electron-vite(react-ts), TS strict, ESLint+Prettier, vitest, node-pty + Electron 재빌드 |
| 1 단일 터미널 | ✅ 완료 (2026-09-20) | xterm + node-pty(직접 zsh), LoginEnv, fit·unicode11·clipboard·web-links |
| 2 캔버스·다중 노드 | ✅ 완료 (2026-09-20) | React Flow, TerminalNode, TerminalRegistry, 생성 대화상자, zustand |
| 3 tmux·영속성 | ✅ 완료 (2026-09-20) | TmuxService, buildArgs, tmux.conf, WorkspaceStore, 복구 흐름, 닫기 vs 종료 |
| 4 상태 감지 | ⬜ 미착수 | |
| 5 줌 단계·성능 | ⬜ 미착수 | |
| 6 다듬기·패키징 | ⬜ 미착수 | |

---

## 2. 지금 동작하는 것

- `npm run dev` → Electron 창 1개(1280×800, 어두운 빈 화면)가 뜬다. 렌더러는 React 19 + StrictMode.
- `npm run build` → `out/{main,preload,renderer}` 생성. `npm run build:mac`은 단계 6에서 검증 예정(미실행).
- `npm test`(vitest), `npm run lint`(ESLint 9 flat), `npm run typecheck`(tsc, strict), `npm run format`(Prettier).
- `npm run verify:renderer` → 개발 앱을 CDP 디버깅 포트와 함께 띄워 렌더러를 자동 점검하고 종료한다(SPEC 14.3). 옵션: `--attach`(이미 뜬 앱에 붙기), `--keep`(끄지 않기), `--port <n>`, `--verbose`(dev 로그 출력).
- main 프로세스가 기동 시 node-pty를 import하고 `[session-canvas] node-pty loaded, spawn is function`을 출력한다(R5 상시 확인용).

- 창 하나에 터미널 하나가 뜨고, zsh가 로그인 셸 환경(PATH 37개 항목)으로 돈다.
- 입력 → `xterm.onData` → IPC → node-pty, 출력 → node-pty → 8ms 묶음 → IPC → `xterm.write`.
- 창 크기 변경 → `ResizeObserver` → fit → `pty.resize` → 셸의 `COLUMNS`까지 반영.
- 무한 캔버스 위에 터미널 노드를 여러 개 만들고 옮기고 크기를 바꾼다. 노드마다 독립된 PTY.
- 헤더 드래그로만 이동, 터미널 영역은 캔버스 조작에서 제외(`nodrag nowheel nopan`).
- 제목·설명 인라인 편집, 빈 제목은 폴더명으로 표시.
- `Cmd+N` 또는 빈 캔버스 더블클릭 → 생성 대화상자(폴더 선택·제목·명령).
- 두 손가락 스크롤 = 팬, 핀치 = 줌 (SPEC 7.4). 미니맵·컨트롤 표시.
- 노드 닫기는 헤더 `×` → 인라인 확인. **네이티브 `confirm`은 쓰지 않는다**(렌더러가 멈춰 CDP 점검도 막힌다).
- **모든 PTY가 tmux 클라이언트다.** 노드 1개 = `sc-<nodeId>` 세션 1개, 전용 소켓 `-L session-canvas`로 사용자 기본 tmux와 격리.
- 앱을 강제 종료해도 세션이 살아 있고, 다시 켜면 자동 재접속한다.
- `workspace.json`(userData)에 레이아웃·제목·설명 저장. 500ms 디바운스, 임시 파일 + rename, `.bak` 1개 유지, 손상 시 백업 복구.
- 시작 시 tmux 확인 → 없으면 설치 안내 화면(앱이 죽지 않는다).
- 세션이 사라진 노드는 "세션 없음" 패널 + [새로 시작], 워크스페이스에 없는 세션은 우상단 "분리된 세션" 목록에서 복원.
- 헤더 `×` → [닫기(분리)] / [세션 종료] / [취소]. 분리는 tmux 세션을 살려 둔다.
- 점검: `npm run verify:renderer` / `verify:terminal`(9항목) / `verify:canvas`(12항목) / `verify:persistence`(13항목).

### 단계 0 완료 기준 체크리스트 (SPEC 12.1)

- [x] `npm run dev`로 빈 창이 뜬다 — 창 제목 `Session Canvas`, `#root` 아래 `div.app` 마운트 확인, 렌더러 콘솔 오류/CSP 위반 0건
- [x] `npm test` 통과 — `tests/toolchain.test.ts` 2 passed
- [x] `npm run lint` 통과 — 오류 0
- [x] node-pty import 시 오류 없음 — Electron 런타임에서 `spawn is function`
- [x] (추가) `npm run typecheck` 통과, `npx prettier --check .` 통과
- [x] (추가) `npm run verify:renderer` 8개 항목 전부 통과

### 단계 1 완료 기준 체크리스트 (SPEC 12.1)

`npm run verify:terminal`로 자동 확인(9/9 통과, 3회 연속 재현):

- [x] zsh에서 `ls` 정상 — CDP로 실제 키 이벤트를 넣어 홈 디렉터리 목록 확인
- [x] `vim` 정상 — 대체 화면 TUI 진입·복귀
- [x] `claude` 정상 — `claude --version` → 2.1.278. **로그인 셸 PATH 해석이 동작한다는 증거**(SPEC 4.4)
- [x] 한글 출력 정상 — `한글 출력 테스트 가나다라` 왕복
- [x] 한글 폭 계산 정상 — `abc`=3칸, `가나다`=6칸 (unicode11)
- [x] 한글 입력 — 자동(CDP 조합 시뮬레이션) + **사용자 직접 타이핑 확인 완료** (R3)
- [x] (기준 외 추가) **앱 터미널 안에서 Claude Code 실행** — 한글 질문·응답 렌더링, 입력 박스 테두리 정렬, 긴 한글 줄바꿈, `Esc`·`Shift+Tab` 전달까지 정상. 단계 3에서 tmux를 끼운 뒤 비교할 기준점이다
- [x] 창 리사이즈 시 줄바꿈 정상 — 159→85열, 셸의 `tput cols`도 85
- [x] 트루컬러 — `\033[38;2;255;100;0m` → 셀이 RGB 모드 `#ff6400`
- [x] `npm test`(16) / `npm run lint` / `npm run typecheck` / `prettier --check` 통과

### 단계 2 완료 기준 체크리스트 (SPEC 12.1)

`npm run verify:canvas`로 자동 확인(12/12 통과, 3회 연속 재현):

- [x] 노드 3개 이상 동시 동작 — 3개 생성, 각자 프롬프트 출력
- [x] 노드별 PTY 독립 — 각 노드에 다른 마커를 보내 서로 섞이지 않음을 확인
- [x] 드래그 중 터미널 입력과 충돌 없음 — 헤더 드래그는 이동, 터미널 영역 드래그는 이동 없음
- [x] 리사이즈 — 핸들 드래그 → fit → `pty.resize` → 셸 `tput cols`까지 일치
- [x] 캔버스를 팬/줌해도 터미널 내용 유지 — 버퍼 문자열 동일
- [x] Esc가 Claude Code에 전달됨 — `cat -v`가 `^[` 수신
- [x] Shift+Tab이 전달됨 — `cat -v`가 `^[[Z` 수신
- [x] 노드 닫기 → 노드·터미널·PTY 정리
- [x] `npm test`(21) / `lint` / `typecheck` / `prettier --check` 통과

### 단계 3 완료 기준 체크리스트 (SPEC 12.1)

`npm run verify:persistence`로 자동 확인:

- [x] **앱을 강제 종료(SIGKILL)해도 세션이 그대로** — 재시작 후 이전 화면까지 복원
- [x] 레이아웃·제목·설명 복원
- [x] tmux 상태줄 안 보임 — `status off`
- [x] Ctrl+B 그대로 전달 — `prefix None`, `cat -v`가 `^B` 수신
- [x] 휠 스크롤 → tmux 스크롤백 — `pane_in_mode=1`
- [x] 사용자 기본 tmux 서버에 영향 없음 — 기본 소켓에 `sc-*` 없음
- [x] 닫기(분리) → 노드만 사라지고 세션 유지 → "분리된 세션" 목록에 나타남
- [x] 세션 종료 → tmux 세션 제거
- [x] `npm test`(52) / `lint` / `typecheck` / `prettier --check` 통과

---

## 3. 13장 R 항목 확인 결과

| # | 결과 |
|---|---|
| **R5** node-pty Electron 재빌드 | ✅ **확인됨.** `package.json`의 `postinstall: electron-builder install-app-deps`가 `@electron/rebuild`를 호출해 node-pty 1.1.0을 Electron 39.8.10 / arm64로 빌드한다(`node_modules/node-pty/build/Release/pty.node`). Electron 런타임에서 import 성공. **주의: 이 바이너리는 Electron ABI이므로 순수 Node(= vitest)에서는 import할 수 없다.** 그래서 node-pty 검증은 단위 테스트가 아니라 main 프로세스 기동 로그로 한다. `npm install`/Electron 버전 변경 후에는 postinstall이 자동으로 다시 빌드한다. |
| **R3** 한글 IME 조합 입력 | ✅ **확인됨 (2026-09-20, 사용자 수동 테스트).** macOS 두벌식 IME로 직접 타이핑해 전부 정상: 조합 중 글자가 커서 자리에서 바뀜 · 확정 시 중복·누락 없음 · 조합 중 백스페이스가 자모 단위 · 한글 뒤 영문이 겹치지 않음 · 커서 이동 후 삽입 정상 · `echo 한글테스트가나다` 왕복 일치. **tmux 없이 zsh를 직접 띄운 조건**에서의 결과다. 단계 3에서 tmux를 끼우면 다시 확인해야 한다(R2와 함께). 자동 점검(`verify:terminal`)의 CDP 조합 시뮬레이션은 회귀 감지용으로 남겨 둔다. |
| **R2** tmux 안 Claude Code의 Shift+Enter | ✅ **확인하고 고쳤다 (단계 3).** `cat -v`로 재보니 **xterm이 Shift+Enter를 그냥 Enter와 똑같이 보낸다.** tmux의 `extended-keys on`만으로는 소용이 없다 — 터미널이 애초에 구별해 주지 않기 때문이다. `attachCustomKeyEventHandler`에서 가로채 `ESC CR`(Option+Enter와 같은 바이트)로 보내도록 했고, 다시 재보니 `^[`가 도착한다. iTerm에서 `claude`의 `/terminal-setup`이 하는 것과 같은 방식. **Claude Code 프롬프트에서 실제로 줄바꿈이 되는지는 사용자 확인 필요.** |
| **R4** tmux 안 Claude Code 렌더링 | ⚠️ **부분 확인.** tmux를 거쳐도 한글 출력·전각 폭·트루컬러·리사이즈·vim(대체 화면)이 모두 정상이고 `claude --version`도 뜬다(`verify:terminal` 9/9). **깜빡임·스피너·색 같은 실제 렌더링 품질은 iTerm 직접 실행과 눈으로 비교해야 한다.** |
| R1, R6, R7, R8 | 미확인 (각각 단계 4/5에서 확인 예정) |

---

## 4. 알려진 이슈 · 환경 준비물

1. **tmux 미설치.** 이 개발 머신에 `tmux`가 없다(`tmux -V` → command not found). SPEC 4.3은 3.3+를 요구한다. **단계 3 시작 전에 `brew install tmux` 필요.**
2. `npm audit`에 4건(moderate 2, high 2) — 모두 devDependency 체인. 단계 6 패키징 전에 재확인.
3. 렌더러 번들이 641 kB로 이미 크다(React). 단계 2에서 React Flow, xterm이 들어가면 더 커진다. 로컬 앱이라 당장 문제는 아니다.
4. 개발 모드는 터미널의 PATH를 물려받으므로 SPEC 4.4(PATH 문제)가 가려진다. 단계 6에서 패키징된 `.app`으로 반드시 재확인.

---

## 5. 다음에 할 일 (단계 4)

SPEC 12.1 단계 4 — Claude Code hooks 기반 상태 감지. **SPEC 8장 전체.**

- **가장 먼저 R1을 확인한다** (SPEC 0.3, 13장): 훅 이벤트 이름·stdin JSON 필드·matcher 문법·`--settings` 플래그 동작을 공식 문서(`https://docs.claude.com/en/docs/claude-code/hooks`)로 확인하고 §8.2 표를 고친다. **추측으로 구현하지 않는다.**
- `resources/hooks/session-canvas-hook.sh` (SPEC 8.3) — jq 금지, 항상 `exit 0`, stdout 없음
- `src/main/status/mapEvent.ts` (순수 함수, **단위 테스트 필수**), `status/StatusWatcher.ts`
- `src/main/hooks/mergeSettings.ts` (순수 함수, **단위 테스트 필수**), `hooks/HookInstaller.ts`
- `src/main/notify/Notifier.ts` — macOS 알림, Dock 배지
- 노드 헤더 상태 배지(SPEC 8.1) — 지금은 `○` 자리만 잡아 뒀다
- 완료 기준: 프롬프트 제출 → 작업 중 · 권한 요청 → 입력 대기 · 응답 종료 → 완료 · 포커스 시 unseen 해제 · **앱 밖 iTerm의 Claude Code에는 영향 없음** · 설치/제거가 기존 `settings.json`을 보존

시작 전 반드시 알아야 할 것:
- **`~/.claude/settings.json`은 사용자 전역 설정이다 (SPEC 0.4/8.4).** 앱 UI에서 명시적 동의를 받은 뒤에만, 백업하고 병합한다. 개발 중 테스트는 임시 HOME이나 fixture로 한다. 이 세션이 쓰는 Claude Code 설정이기도 하니 특히 조심할 것.
- `SESSION_CANVAS_NODE_ID`는 이미 tmux `-e`로 주입되고 있다(`buildArgs.ts`). 훅 스크립트는 이 값만 보면 된다.
- `claudeSessionId`는 `SessionStart` 훅에서 채워지고, 그래야 SPEC 5.4의 [이전 대화 이어서]가 동작한다. 지금은 `DetachedSession.tsx`에 [새로 시작]만 있다.
- R8(재부팅 후 tmux 세션 소멸 → resume 흐름)도 단계 4에서 확인한다.

## 6. 삽질 기록

### 3-1. 점검 스크립트가 영원히 멈췄다 ⭐
증상: `verify:persistence`가 첫 확인 항목도 못 찍고 10분 넘게 매달려 있었다.

원인: CDP 클라이언트가 보낸 요청을 `pending` 맵에 넣고 응답만 기다렸다. 앱을 SIGKILL하면 웹소켓이 닫히는데, **닫힘을 아무도 처리하지 않아 대기 중인 프로미스가 영원히 미결**로 남았다.

해결: `ws.onclose`에서 대기 중인 요청을 전부 reject하고, 명령마다 30초 타임아웃을, 점검 전체에 5분 워치독을 뒀다. **멈춘 채 방치되는 것보다 실패가 낫다.**

### 3-2. 로그인 셸이 질문을 던지면 점검이 막힌다
`oh-my-zsh`가 "Would you like to update? [Y/n]"을 띄우고 셸이 멈춰 있었다. 앱은 멀쩡했다 — 사용자의 로그인 셸을 충실히 띄운 결과이고, iTerm에서도 똑같이 나온다.
→ 점검에서만 `DISABLE_AUTO_UPDATE=true`로 끈다. 타임아웃 메시지에 **마지막 화면**을 함께 찍도록 해서 다음엔 바로 알 수 있게 했다.

### 3-3. 재접속 후 화면에는 "마지막 화면"만 돌아온다
강제 종료 전에 남긴 마커를 재시작 후에 찾다가 실패했다. 그 사이 `seq 1 200`을 돌려 마커가 화면 밖으로 밀려난 것.
→ tmux가 재접속 때 다시 그려 주는 것은 **보이는 화면뿐**이고, 그 위 내용은 tmux 스크롤백에 있지 xterm 버퍼에는 없다. 점검 순서를 바꿔 해결.

### 3-4. `index.d.ts`는 `index.ts` 옆에 두면 무시된다 ⭐
`src/preload/index.d.ts`의 `declare global { Window.api }`가 tsconfig.node에서 안 먹혀 `window.api` 타입 오류가 났다. TypeScript가 **같은 이름의 `.ts`가 있으면 `.d.ts`를 그 출력물로 보고 건너뛴다.**
→ `src/preload/api.d.ts`로 이름을 바꿨다.

### 3-5. 점검이 실제 tmux 세션과 워크스페이스를 건드렸다
`verify:terminal`이 갑자기 실패했는데, 원인은 이전 점검이 남긴 노드를 `workspace.json`에서 읽어와 "세션 없음" 상태로 띄운 것이었다(그 노드엔 터미널이 없다).
→ 모든 점검이 전용 소켓(`SESSION_CANVAS_TMUX_SOCKET`)과 임시 `--user-data-dir`을 쓰도록 격리했다. 끝나면 그 소켓의 서버를 죽인다.

### 3-6. 휠 방향을 반대로 보내고 앱을 의심했다
`deltaY: 120`(아래로)을 보내 놓고 tmux 스크롤백에 안 들어간다고 판단했다. 위로 굴리는 건 **음수**다. 게다가 `document.querySelector('.terminal-area')`가 다른 노드를 집고 있었다.
→ 단계 2의 2-4와 같은 실수다. **점검 실패는 앱 버그보다 점검 코드 문제일 때가 더 많다.**

### 2-1. 노드를 클릭해도 선택되지 않아 리사이즈 핸들이 안 나왔다 ⭐
증상: `NodeResizer`를 붙였는데 핸들이 아무리 해도 안 보였다.

원인: React Flow를 **제어 모드**(`nodes` prop을 우리 스토어에서 내려줌)로 쓰면서 `onNodesChange`의 `select` 변경을 버리고 있었다. 그래서 `selected`가 영원히 false였고, `isVisible={selected}`인 `NodeResizer`는 영원히 숨어 있었다.

해결: `Canvas`가 `selectedIds`를 들고 `select` 변경을 반영한다. 선택은 화면 상태라 `workspace.json`(SPEC 9.1)에는 넣지 않는다. SPEC 7.1에 못 박았다.

### 2-2. React Flow 기본 `deleteKeyCode`가 Backspace다
그대로 두면 **터미널에서 백스페이스를 칠 때 노드가 지워진다.** `deleteKeyCode={null}`, `multiSelectionKeyCode={null}`, `selectionKeyCode={null}`로 비웠다. SPEC 7.5에 기록.

### 2-3. 점검 스크립트의 드래그가 한 걸음씩 짧았다
헤더를 160px 끌었는데 144px만 움직였다. React Flow의 `nodeDragThreshold`가 **첫 이동을 통째로 삼킨다**. 실제 마우스는 1px씩 움직여 티가 안 나지만, 큰 걸음으로 뛰면 그 걸음이 사라진다.
→ 드래그 시작 직후 1px 이동을 먼저 보내 임계값을 소진한다.

### 2-4. 점검 좌표가 미니맵·노드 위였다
휠 이벤트를 고정 좌표에 쐈더니 우하단 **미니맵(`zoomable`)** 위였고, 다음엔 노드 위였다. 앱이 아니라 점검이 틀렸다.
→ `document.elementFromPoint`로 `.react-flow__pane`인 지점을 찾아서 쏜다.

### 2-5. 네이티브 `confirm`을 쓰지 않는 이유
노드 닫기 확인에 `window.confirm`을 쓰면 렌더러가 멈춰 **CDP 점검 자체가 막힌다**(모달이 모든 이벤트를 삼킨다). 헤더 안 인라인 확인 UI로 대신했다. 대화상자도 같은 이유로 직접 만든다.

### 1-1. 교체된 PTY의 늦은 exit 이벤트가 새 세션을 죽였다 ⭐
증상: 앱을 띄우면 프롬프트가 한 번 뜨고 바로 `[프로세스 종료: 0]`이 찍히며 키 입력이 전부 무시됐다.

원인: React StrictMode가 effect를 두 번 실행한다 → `open(main)` → `detach(main)` → `open(main)`. 첫 PTY가 죽으면서 보낸 `onExit`이 **뒤늦게** 도착했는데, 핸들러가 노드 id만 보고 `sessions.delete(id)`를 했다. 그 시점 맵에 들어 있던 것은 **두 번째(살아 있는) 세션**이었다. 맵에서 사라진 세션에는 `write`가 도달하지 않는다.

해결: PTY 이벤트 핸들러가 자기 `session` 객체를 클로저로 들고 있다가 `this.sessions.get(id) !== session`이면 무시한다. `onData`도 같다. 회귀 테스트 `tests/ptyManager.test.ts`에 고정했다(수정을 되돌리면 실패하는 것까지 확인).

교훈: **노드 id는 "지금 그 노드의 세션"을 가리키지 않는다.** 단계 3에서 tmux 재접속을 붙이면 같은 함정이 더 자주 나온다.

### 1-2. node-pty를 쓰는 코드의 단위 테스트
`tests/ptyManager.test.ts`는 `vi.mock('node-pty')`로 네이티브 모듈을 통째로 갈아끼운다. 이렇게 해야 Electron ABI 바이너리를 Node에서 로드하지 않는다(0-3 참조).

### 1-3. CDP 점검 스크립트의 경쟁 조건
`check-terminal.mjs`를 처음 돌렸을 때 간헐적으로 `Cannot read properties of undefined (reading 'terminals')`가 났다. 앱이 뜨자마자 붙어서 렌더러가 아직 터미널을 만들기 전이었다.
→ 터미널이 생길 때까지, 그리고 셸 프롬프트가 찍힐 때까지 폴링한 뒤 점검을 시작한다. 3회 연속 통과 확인.

또 `ls` 출력 확인이 한 번 실패했는데, 이것도 점검 스크립트 쪽 문제였다(명령이 에코되자마자 통과 판정 → 실제 목록이 오기 전에 읽음). 앱은 멀쩡했다. **점검 실패를 앱 버그로 단정하기 전에 점검 코드를 먼저 의심할 것.**

### 1-4. 같은 디버깅 포트에 앱이 이미 떠 있으면 조용히 그쪽을 점검한다
점검 스크립트가 새 앱을 띄우고도, 포트 9222에 남아 있던 **이전 앱**에 붙어 점검했다. 결과는 통과였지만 점검 대상이 틀렸다.
→ `portInUse()`로 먼저 막고 `--attach` / `--port`를 안내한다.

### 0-1. electron-vite 스캐폴더가 비대화형 환경에서 멈춤
`npm create @quick-start/electron@latest`는 TTY가 없으면 두 번째 프롬프트에서 종료된다.
→ `script -q /dev/null npx @quick-start/create-electron@1.0.30 ...`로 의사 TTY를 줘서 해결. 생성물은 임시 폴더에 만든 뒤 `SPEC.md`/`.git`을 보존하며 프로젝트 폴더로 복사했다.

### 0-2. 렌더러 디렉터리 레이아웃이 SPEC 4.2와 다름
템플릿은 `src/renderer/src/*`를 쓰지만 SPEC 4.2는 `src/renderer/App.tsx`다.
→ SPEC을 따라 `src/renderer/` 바로 아래로 옮기고 `tsconfig.web.json`의 `include`/`paths`, `electron.vite.config.ts`의 `@renderer` 별칭, `index.html`의 `<script src="/main.tsx">`를 맞췄다. SPEC 15장에 기록.

### 0-3. node-pty를 vitest로 검증하려다 실패할 뻔함
재빌드된 `pty.node`는 Electron ABI라서 Node 24에서 돌아가는 vitest가 import하면 깨진다.
→ 단위 테스트에서 node-pty를 건드리지 않고(`vitest.config.ts` 주석 참조), main 프로세스 기동 로그로 확인한다.

### 0-4. 창이 실제로 떴는지 비대화형으로 확인하기
osascript(System Events)는 손쉬운 사용 권한이 없어 막혔다(-25211). 시스템 설정은 건드리지 않았다.
→ `electron-vite dev -- --remote-debugging-port=9222` 로 띄우고 CDP(`/json` + WebSocket `Runtime.evaluate`)로 확인했다. 이 방법을 `scripts/inspect-renderer.mjs` (`npm run verify:renderer`)로 정리해 두었다(SPEC 14.3).

알아둘 점:
- 의존성 0. Node 22+의 내장 `fetch`/`WebSocket`만 쓴다.
- `Log.enable`/`Runtime.enable`은 **켜진 뒤의 이벤트만** 받는다. 그래서 켠 다음 `Page.reload`로 로드를 다시 돌려 초기 오류까지 잡는다.
- React 마운트는 고정 대기 대신 `#root` 자식이 생길 때까지 250ms 간격으로 폴링한다(최대 10초).
- 앱은 `detached: true`로 **자기 프로세스 그룹**에서 띄우고 `process.kill(-pid)`로 그룹째 정리한다. 이렇게 해야 electron-vite가 띄운 Electron 자식까지 같이 죽고, 사용자가 따로 띄운 `npm run dev`는 건드리지 않는다.
- 이미 `npm run dev`가 떠 있으면 5173이 점유되어 스크립트 쪽 vite가 다른 포트를 쓴다. 동작에는 문제 없지만 창이 두 개 뜬다.

### 0-5. Prettier가 SPEC.md를 다시 포맷하려 함
`.prettierignore`에 `SPEC.md`, `HANDOVER.md`, `README.md`를 넣어 정본 문서가 자동 포맷으로 훼손되지 않게 했다.
