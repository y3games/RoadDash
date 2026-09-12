# phaser-starter

Phaser 3 웹 게임 템플릿. GitHub Pages 자동 배포까지 연결된 상태로 시작합니다.

## 새 게임 시작하기

```bash
gh repo create MyGame --template y3games/phaser-starter --public --clone
cd MyGame
npm install
npm run dev
```

**배포 경로는 자동입니다.** `vite.config.ts`가 `GITHUB_REPOSITORY`에서 저장소 이름을 읽어
`base`를 정하므로 새 이름으로 만들어도 고칠 것이 없습니다. 로컬 개발은 `/`에서 뜹니다.

**`src/main.ts`의 `GAME_ID`는 반드시 바꿔야 합니다.**

```ts
const GAME_ID = 'phaser-starter'; // ← 새 저장소 이름(소문자 슬러그)으로 교체
```

최고 점수는 `<GAME_ID>.best` 키로 localStorage에 저장됩니다. 모든 게임이
`https://y3games.github.io` 한 오리진 아래 배포되므로 localStorage를 공유합니다. 이걸 그대로
두면 템플릿에서 만든 게임끼리 서로의 최고 점수를 덮어씁니다. 게임 포털도 같은 `<id>.best`
규약으로 점수를 읽으므로, 포털 카탈로그의 `id`와 같은 값을 쓰세요.

첫 push 후 Pages 소스를 Actions로 한 번만 지정하면 됩니다:

```bash
gh api -X POST repos/{owner}/MyGame/pages -f build_type=workflow
```

## 플레이어 이름

첫 방문에 이름을 한 번 묻고, 그 뒤로는 쿠키로 같은 사람으로 인식합니다. 로그인·비밀번호는 없습니다.

```
cookie  player               = {"id":"<uuid>","name":"동혁"}  ← 오리진 전체 공유(path=/)
local   <GAME_ID>.best       = 1234                          ← 숫자만. 포털이 읽는 키
local   <GAME_ID>.best.owner = {"id":"<uuid>","name":"동혁"}  ← 그 기록을 낸 사람
local   player               = 쿠키 미러(Safari 7일 제한 대비)
```

**이름은 HUD의 이름을 탭해서 바꿀 수 있습니다.** uuid는 그대로라 최고 기록도 그대로 따라옵니다.

**신원은 모든 게임이 공유하고, 점수는 게임마다 분리됩니다.** 한 오리진 아래 배포되므로 MergeDrop을
하던 사람이 다른 게임을 열어도 같은 플레이어입니다.

이름 입력 화면은 Phaser 씬이 아니라 `index.html`의 DOM 오버레이입니다. 캔버스에는 텍스트 입력이
없고 한글 IME가 `<input>`을 필요로 하기 때문입니다. 문구나 디자인은 `index.html`과 `style.css`에서
고치세요.

인증이 아니라는 점은 기억해야 합니다 — id도 이름도 devtools에서 바꿀 수 있으므로, 나중에 서버
랭킹을 붙일 때 이 값만 믿으면 안 됩니다. 자세한 배경은
[ADR-003](docs/02-architecture/adr-003-익명-플레이어-신원.md)에 있습니다.

## 명령

```bash
npm run dev      # 개발 서버 http://localhost:5173/
npm run check    # tsc + eslint + vitest  ← 작업 완료 판단 기준
npm test         # 테스트만
npm run build    # 타입 검사 후 dist/ 생성
npm run preview  # 빌드 결과 확인
```

## 들어 있는 것

- **Vite 8 + TypeScript 6 + Phaser 3.90** (Matter.js 물리 포함)
- **ESLint + Prettier + Vitest** 설정 완료
- **GitHub Actions → Pages 자동 배포** — `npm run check` 통과해야 배포됨
- **씬 3분할** — Boot(텍스처 생성) / Game(물리·입력) / UI(HUD, 별도 씬으로 동시 실행)
- **순수 규칙 레이어** — `src/game/`은 Phaser를 import하지 않아 게임 없이 테스트 가능
- **`ScoreService` 추상화** — 지금은 localStorage(`<GAME_ID>.best`), 나중에 서버로 교체 시
  구현체 하나만 추가
- **익명 플레이어 신원** — 첫 방문에 이름만 받아 쿠키에 저장. 점수는 그 이름으로 기록됨
- **이미지 에셋 0개** — 공은 런타임에 Graphics로 그림
- **데모 게임** — 공을 떨어뜨려 착지시키면 점수. 지우고 본인 게임으로 교체하세요

## 무엇을 지우고 무엇을 남길 것인가

| 지우고 새로 쓸 것                | 그대로 둘 것                             |
| -------------------------------- | ---------------------------------------- |
| `src/game/rules.ts`의 데모 규칙  | 순수 함수로 유지한다는 원칙              |
| `src/game/config.ts`의 공 테이블 | 튜닝 값을 한 파일에 모은다는 원칙        |
| `GameScene`의 데모 루프          | 씬 3분할, 입력 처리 방식                 |
| `tests/rules.test.ts`            | 규칙을 테스트로 고정한다는 방식          |
| `main.ts`의 `GAME_ID` 값         | 게임 id로 저장 키를 만든다는 규약        |
| 이름 입력 화면의 문구·디자인     | 쿠키로 플레이어를 구분한다는 방식        |
| —                                | `services/`, 빌드·린트 설정, CI 워크플로 |

코드를 만지기 전에 [CLAUDE.md](CLAUDE.md)의 **Gotchas** 절을 읽으세요. 재발하면 원인을 찾기 어려운
함정들이 정리되어 있습니다.
