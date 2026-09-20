# HANDOVER — Session Canvas

> 구현 진행 상황과 삽질 기록. SPEC 12.3에 따라 단계가 끝날 때마다 갱신한다.
> 정본 명세는 `SPEC.md`.

- 최종 갱신: 2026-09-20
- 현재 단계: **단계 0 (골격) 완료.** 다음은 단계 1(단일 터미널).

---

## 1. 완료된 단계

| 단계 | 상태 | 비고 |
|---|---|---|
| 0 골격 | ✅ 완료 (2026-09-20) | electron-vite(react-ts), TS strict, ESLint+Prettier, vitest, node-pty + Electron 재빌드 |
| 1 단일 터미널 | ⬜ 미착수 | |
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
- main 프로세스가 기동 시 node-pty를 import하고 `[session-canvas] node-pty loaded, spawn is function`을 출력한다(R5 상시 확인용).

### 단계 0 완료 기준 체크리스트 (SPEC 12.1)

- [x] `npm run dev`로 빈 창이 뜬다 — 창 제목 `Session Canvas`, `#root` 아래 `div.app` 마운트 확인, 렌더러 콘솔 오류/CSP 위반 0건
- [x] `npm test` 통과 — `tests/toolchain.test.ts` 2 passed
- [x] `npm run lint` 통과 — 오류 0
- [x] node-pty import 시 오류 없음 — Electron 런타임에서 `spawn is function`
- [x] (추가) `npm run typecheck` 통과, `npx prettier --check .` 통과

---

## 3. 13장 R 항목 확인 결과

| # | 결과 |
|---|---|
| **R5** node-pty Electron 재빌드 | ✅ **확인됨.** `package.json`의 `postinstall: electron-builder install-app-deps`가 `@electron/rebuild`를 호출해 node-pty 1.1.0을 Electron 39.8.10 / arm64로 빌드한다(`node_modules/node-pty/build/Release/pty.node`). Electron 런타임에서 import 성공. **주의: 이 바이너리는 Electron ABI이므로 순수 Node(= vitest)에서는 import할 수 없다.** 그래서 node-pty 검증은 단위 테스트가 아니라 main 프로세스 기동 로그로 한다. `npm install`/Electron 버전 변경 후에는 postinstall이 자동으로 다시 빌드한다. |
| R1, R2, R3, R4, R6, R7, R8 | 미확인 (각각 단계 1/3/4/5에서 확인 예정) |

---

## 4. 알려진 이슈 · 환경 준비물

1. **tmux 미설치.** 이 개발 머신에 `tmux`가 없다(`tmux -V` → command not found). SPEC 4.3은 3.3+를 요구한다. **단계 3 시작 전에 `brew install tmux` 필요.**
2. `npm audit`에 4건(moderate 2, high 2) — 모두 devDependency 체인. 단계 6 패키징 전에 재확인.
3. 렌더러 번들이 641 kB로 이미 크다(React). 단계 2에서 React Flow, xterm이 들어가면 더 커진다. 로컬 앱이라 당장 문제는 아니다.
4. 개발 모드는 터미널의 PATH를 물려받으므로 SPEC 4.4(PATH 문제)가 가려진다. 단계 6에서 패키징된 `.app`으로 반드시 재확인.

---

## 5. 다음에 할 일 (단계 1)

SPEC 12.1 단계 1 — 창 하나에 xterm + node-pty(tmux 없이 직접 zsh).

- `src/shared/types.ts`, `src/shared/ipc.ts` (SPEC 9.1 / 10장)
- `src/main/env/loginEnv.ts` — `$SHELL -ilc 'env'` (SPEC 4.4)
- `src/main/pty/PtyManager.ts` + `src/main/ipc.ts` — PTY 출력은 약 8ms 단위로 묶어 전송(SPEC 10)
- `src/preload/index.ts` — `window.api.pty` 노출
- `src/renderer/terminal/XtermView.tsx` — @xterm/xterm + fit·webgl·unicode11·clipboard·web-links (SPEC 6.1). **unicode11 활성화 필수**
- 완료 기준: zsh에서 `ls`/`vim`/`claude` 정상 · **한글 입력·출력 정상(R3)** · 리사이즈 시 줄바꿈 정상 · 트루컬러

---

## 6. 삽질 기록

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
→ `electron-vite dev -- --remote-debugging-port=9222` 로 띄우고 CDP(`/json` + WebSocket `Runtime.evaluate`)로 `document.title`, `#root` 자식 수, `window.api` 존재, 콘솔/예외 로그를 확인했다. 이후 단계에서도 같은 방법을 쓸 수 있다.

### 0-5. Prettier가 SPEC.md를 다시 포맷하려 함
`.prettierignore`에 `SPEC.md`, `HANDOVER.md`, `README.md`를 넣어 정본 문서가 자동 포맷으로 훼손되지 않게 했다.
