# Session Canvas

여러 개의 Claude Code 세션을 하나의 무한 캔버스 위에 터미널 노드로 배치하는 macOS 데스크톱 앱.

- 정본 명세: [SPEC.md](./SPEC.md)
- 진행 상황·삽질 기록: [HANDOVER.md](./HANDOVER.md)

## 요구 환경

- macOS 14+ (Apple Silicon), Node.js 20+
- tmux 3.3+ (`brew install tmux`) — 단계 3부터 필요
- Claude Code CLI

## 개발

```sh
npm install      # postinstall에서 node-pty를 Electron ABI로 재빌드한다
npm run dev            # 개발 모드 실행 (실제 tmux 세션·배치를 그대로 씁니다)
npm run dev:isolated   # 격리 개발 모드 — 앱을 고칠 때는 이쪽

npm test         # vitest
npm run lint     # ESLint
npm run typecheck
npm run build    # out/ 에 빌드

npm run verify:renderer   # 개발 앱을 띄워 렌더러를 자동 점검하고 종료 (SPEC 14.3)
```

### 앱을 고칠 때는 `dev:isolated`

`npm run dev`는 **패키징 앱과 같은 tmux 소켓·같은 `workspace.json`을 씁니다.** 실제로 작업 중인
세션이 있는데 개발 앱을 같이 띄우면 한 세션에 클라이언트가 둘 붙어 창이 흔들리고, 두 앱이
배치 파일을 번갈아 덮어씁니다.

```sh
npm run dev:isolated              # 소켓 session-canvas-dev + .dev-userdata 사용
npm run dev:isolated -- --clean   # 개발용 배치·세션 초기화
```
