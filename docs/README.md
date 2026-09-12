# RoadDash 문서

끝없는 도로를 질주하는 반사신경 레이싱 게임. 구조는 `save-docs` 스킬 규약을 따릅니다.

## 목차

- [01-planning](01-planning/) — 기획, 요구사항
  - [overview.md](01-planning/overview.md) — 게임 규칙, 난이도 축 회전, 하지 않기로 한 것
- [02-architecture](02-architecture/) — 설계 문서, ADR
  - [overview.md](02-architecture/overview.md) — 순수 레이어와 씬의 경계, (x, s) 좌표계
  - [adr-001-템플릿-구성.md](02-architecture/adr-001-템플릿-구성.md) — 이 저장소가 이런 모양인 이유
  - [adr-002-점수-저장-키-게임별-분리.md](02-architecture/adr-002-점수-저장-키-게임별-분리.md) —
    최고 점수 키를 `<게임 id>.best`로 도출하는 이유
  - [adr-003-익명-플레이어-신원.md](02-architecture/adr-003-익명-플레이어-신원.md) —
    로그인 없이 쿠키로 플레이어를 구분하는 이유
  - [adr-004-물리-엔진-제거.md](02-architecture/adr-004-물리-엔진-제거.md) —
    Matter.js를 쓰지 않는 이유와 그 대가
  - [adr-005-난이도-축-회전과-공정성-불변식.md](02-architecture/adr-005-난이도-축-회전과-공정성-불변식.md) —
    레벨업이 한 축만 올리는 이유, 통과 가능성을 보장하는 세 불변식
- [03-notes](03-notes/) — 작업 메모
  - [2026-09-13-roaddash-초기-구현.md](03-notes/2026-09-13-roaddash-초기-구현.md) —
    오토파일럿 테스트가 잡아낸 세 가지 불공정 버그
- [04-references](04-references/) — 참고 자료
  - [references.md](04-references/references.md)
- [assets/images](assets/images/) — 스크린샷, 다이어그램
