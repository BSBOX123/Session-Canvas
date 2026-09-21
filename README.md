# Session Canvas

여러 개의 Claude Code 세션을 하나의 무한 캔버스 위에 터미널 노드로 배치하는 macOS 데스크톱 앱.

창을 찾고 켜고 끄는 시간 없이 모든 세션을 한 화면에서 보고, 어느 세션이 내 입력을 기다리는지
노드 테두리 색으로 바로 알아본다. 앱을 꺼도 세션은 tmux 안에서 살아 있다.

- 정본 명세: [SPEC.md](./SPEC.md)
- 진행 상황·삽질 기록: [HANDOVER.md](./HANDOVER.md)

---

## 받아서 쓰기 (팀원용)

앱은 **코드 서명이 되어 있지 않다.** 대신 각자 자기 기기에서 빌드하면 macOS가 막지 않는다
(직접 빌드한 앱에는 격리 속성이 붙지 않는다). 빌드는 한 번만 하면 된다.

### 1. 미리 설치할 것

| | 확인 | 없으면 |
|---|---|---|
| macOS 14+ | `sw_vers -productVersion` | — |
| Node.js 20+ | `node -v` | [nodejs.org](https://nodejs.org) 또는 `mise use node@22` |
| **tmux 3.3+** | `tmux -V` | `brew install tmux` |
| **Claude Code CLI** | `claude --version` | [설치 안내](https://code.claude.com/docs) |

tmux가 없으면 앱이 **설치 안내 화면만** 띄우고 아무것도 하지 못한다.
Claude Code가 없으면 노드는 열리지만 `claude` 명령이 실행되지 않는다.

### 2. 빌드

```sh
git clone https://github.com/BSBOX123/Session-Canvas.git
cd Session-Canvas
npm ci            # postinstall이 node-pty를 Electron용으로 다시 빌드한다
npm run build:mac
```

`dist/mac-arm64/Session Canvas.app` 이 나온다 (Intel Mac이면 `dist/mac-x64/`).
`/Applications`로 옮겨 두면 편하다.

```sh
cp -R "dist/mac-arm64/Session Canvas.app" /Applications/
```

### 3. 쓰기

1. 앱 실행 → 빈 캔버스
2. 빈 곳 **더블클릭** 또는 `⌘N` → 작업 폴더를 고르고 실행 명령(기본 `claude`)을 정한다
3. 좌상단 **⚙ → [상태 감지 켜기]** — 노드에 작업 중/입력 대기/완료를 표시하려면 필요하다.
   `~/.claude/settings.json`에 Claude Code 훅을 추가하며, **동의 화면을 거치고 원본을 백업한다.**
   앱 밖에서 실행한 Claude Code에는 영향이 없다.

| 알아둘 것 | |
|---|---|
| 앱을 꺼도 | tmux 세션은 살아 있다. 다시 켜면 자동 재접속 |
| 노드 `×` | [닫기(분리)]는 세션 유지, [세션 종료]는 완전히 끝냄 |
| 재부팅하면 | tmux 서버가 사라져 "세션 없음"으로 뜬다 → [새로 시작] 또는 [이전 대화 이어서] |
| 저장 위치 | `~/Library/Application Support/session-canvas/workspace.json` (자동 저장) |
| 사용자 tmux | 전용 소켓(`-L session-canvas`)을 써서 기존 `tmux ls`에는 보이지 않는다 |

### 주요 단축키

| 키 | 동작 |
|---|---|
| `⌘N` | 새 노드 |
| `⌘0` | 전체 보기 |
| `⌘1`~`⌘9` | n번째 노드로 줌인 |
| `⌘J` | 주의가 필요한 노드로 이동 |
| `⌘Enter` | 현재 노드 줌인 ↔ 직전 뷰 |
| `⌘W` | 노드 닫기(분리) |

`Esc`, `Shift+Tab`, `Ctrl+*`, `Option+*` 은 앱이 가로채지 않고 터미널로 그대로 간다.

---

## 개발

```sh
npm install
npm run dev            # 개발 모드 (실제 tmux 세션·배치를 그대로 쓴다)
npm run dev:isolated   # 격리 개발 모드 — 앱을 고칠 때는 이쪽
npm test               # vitest
npm run lint
npm run typecheck
npm run build          # out/ 에 빌드
```

### 앱을 고칠 때는 `dev:isolated`

`npm run dev`는 **패키징 앱과 같은 tmux 소켓·같은 `workspace.json`을 쓴다.** 실제로 작업 중인
세션이 있는데 개발 앱을 같이 띄우면 한 세션에 클라이언트가 둘 붙어 창이 흔들리고, 두 앱이
배치 파일을 번갈아 덮어쓴다.

```sh
npm run dev:isolated              # 소켓 session-canvas-dev + .dev-userdata 사용
npm run dev:isolated -- --clean   # 개발용 배치·세션 초기화
```

### 자동 점검

앱을 띄워 Chrome DevTools Protocol로 실제 동작을 확인한다 (SPEC 14.3).
**한 번에 하나씩** 돌린다 — 전부 같은 디버깅 포트를 쓴다.

```sh
npm run verify:renderer      # 창·렌더러
npm run verify:terminal      # 터미널 기능 (한글·트루컬러·리사이즈)
npm run verify:canvas        # 캔버스·다중 노드
npm run verify:persistence   # tmux 영속성 (앱 강제 종료 후 복구)
npm run verify:status        # 상태 감지 (실제 Claude Code 세션 사용)
npm run verify:zoom          # 줌 단계·성능
npm run verify:polish        # 브랜치 표시·테마·상태 테두리
```

## 라이선스

[MIT](./LICENSE)
