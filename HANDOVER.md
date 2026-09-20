# HANDOVER — Session Canvas

> 구현 진행 상황과 삽질 기록. SPEC 12.3에 따라 단계가 끝날 때마다 갱신한다.
> 정본 명세는 `SPEC.md`.

- 최종 갱신: 2026-09-20
- 현재 단계: **단계 1 (단일 터미널) 완료.** 다음은 단계 2(캔버스·다중 노드).

---

## 1. 완료된 단계

| 단계 | 상태 | 비고 |
|---|---|---|
| 0 골격 | ✅ 완료 (2026-09-20) | electron-vite(react-ts), TS strict, ESLint+Prettier, vitest, node-pty + Electron 재빌드 |
| 1 단일 터미널 | ✅ 완료 (2026-09-20) | xterm + node-pty(직접 zsh), LoginEnv, fit·unicode11·clipboard·web-links |
| 2 캔버스·다중 노드 | ⬜ 미착수 | |
| 3 tmux·영속성 | ⬜ 미착수 | |
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
- `npm run verify:terminal` → 터미널 기능 9개 항목 자동 점검.

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
- [x] 한글 입력 — IME 조합(ㅎ→하→한) 후 확정 시 중복·누락 없이 1회 (아래 R3 주의)
- [x] 창 리사이즈 시 줄바꿈 정상 — 159→85열, 셸의 `tput cols`도 85
- [x] 트루컬러 — `\033[38;2;255;100;0m` → 셀이 RGB 모드 `#ff6400`
- [x] `npm test`(16) / `npm run lint` / `npm run typecheck` / `prettier --check` 통과

---

## 3. 13장 R 항목 확인 결과

| # | 결과 |
|---|---|
| **R5** node-pty Electron 재빌드 | ✅ **확인됨.** `package.json`의 `postinstall: electron-builder install-app-deps`가 `@electron/rebuild`를 호출해 node-pty 1.1.0을 Electron 39.8.10 / arm64로 빌드한다(`node_modules/node-pty/build/Release/pty.node`). Electron 런타임에서 import 성공. **주의: 이 바이너리는 Electron ABI이므로 순수 Node(= vitest)에서는 import할 수 없다.** 그래서 node-pty 검증은 단위 테스트가 아니라 main 프로세스 기동 로그로 한다. `npm install`/Electron 버전 변경 후에는 postinstall이 자동으로 다시 빌드한다. |
| **R3** 한글 IME 조합 입력 | ⚠️ **부분 확인.** CDP `Input.imeSetComposition` + `Input.insertText`로 조합→확정을 넣었을 때 중복·누락 없이 1회 입력된다. 다만 이것은 Chromium 레벨의 조합 이벤트 시뮬레이션이고, macOS 두벌식 IME로 실제 타이핑했을 때의 조합 중 커서 위치·깜빡임까지 보장하지는 않는다. **사용자가 직접 한글을 타이핑해 확인해야 한다.** |
| R1, R2, R4, R6, R7, R8 | 미확인 (각각 단계 3/4/5에서 확인 예정) |

---

## 4. 알려진 이슈 · 환경 준비물

1. **tmux 미설치.** 이 개발 머신에 `tmux`가 없다(`tmux -V` → command not found). SPEC 4.3은 3.3+를 요구한다. **단계 3 시작 전에 `brew install tmux` 필요.**
2. `npm audit`에 4건(moderate 2, high 2) — 모두 devDependency 체인. 단계 6 패키징 전에 재확인.
3. 렌더러 번들이 641 kB로 이미 크다(React). 단계 2에서 React Flow, xterm이 들어가면 더 커진다. 로컬 앱이라 당장 문제는 아니다.
4. 개발 모드는 터미널의 PATH를 물려받으므로 SPEC 4.4(PATH 문제)가 가려진다. 단계 6에서 패키징된 `.app`으로 반드시 재확인.

---

## 5. 다음에 할 일 (단계 2)

SPEC 12.1 단계 2 — 캔버스와 다중 노드. PTY는 아직 tmux 없이 직접 spawn.

- `@xyflow/react` 도입, `src/renderer/canvas/Canvas.tsx`
- `src/renderer/nodes/TerminalNode.tsx`, `nodes/NodeHeader.tsx` — 헤더 드래그(`dragHandle`), 터미널 영역에 `nodrag nowheel nopan`
- `src/renderer/terminal/TerminalRegistry.ts` — **SPEC 6.4: 언마운트돼도 `dispose`하지 않는다.** `terminal.open(hostEl)`은 최초 1회만
- 노드 생성 대화상자(SPEC 7.2) — `dialog.pickDirectory()`가 필요하니 SPEC 10의 `dialog` API를 이때 붙인다
- 제목·설명 인라인 편집, `src/renderer/state/workspace.ts` (zustand)
- 완료 기준: 노드 3개 이상 동시 동작 · 드래그/리사이즈 중 입력 충돌 없음 · 팬/줌해도 터미널 내용 유지 · **Esc / Shift+Tab이 Claude Code에 전달됨**

시작 전 확인할 것:
- 지금 `XtermView`는 마운트마다 `Terminal`을 새로 만들고 언마운트 때 `dispose`한다. 단계 2에서 `TerminalRegistry`로 옮기면서 이 수명 관리를 통째로 바꿔야 한다.
- `nodeId`는 `'main'` 하드코딩이다. 노드 생성이 생기면 nanoid(10)로 바꾸고 `NODE_ID_PATTERN` 검증을 태운다.

---

## 6. 삽질 기록

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
