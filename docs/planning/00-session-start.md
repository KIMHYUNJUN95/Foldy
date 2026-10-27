# 세션 시작 요약 (자동으로 컨텍스트에 들어감)

> 이 파일은 세션이 시작될 때 훅(`~/.claude/hooks/foldy-hook.sh start`)이 자동으로 넣는다. **짧게 유지한다(2KB 안팎).**
> 진행 상황 · 열린 일은 여기 적지 않는다(낡는다) — 아래 「지금 상태」 두 문서가 기준이다.

## 지금 상태 (필요할 때 열어 읽기)
- `docs/planning/06-current-status.md` — **맨 위 「▶ 다음에 할 일」 부분만** 읽는다(파일이 700KB 넘음 — 통째로 읽지 않는다).
- `docs/planning/19-open-tasks.md` — 결정 대기 · 개발 순서 · 사용자 할 일.

## 작업 종류별로 먼저 읽을 문서
| 작업 | 먼저 읽기 |
| --- | --- |
| 무엇이든 | `CLAUDE.md` 「Read These First」 · `docs/planning/05-ai-collaboration-rules.md` |
| 모바일 화면 | `docs/product/16-mobile-navigation.md` (폰 · 폴드 · 태블릿 3폭 필수) |
| 관리자(PC) 화면 | `docs/product/05-admin-web-ia.md` + `src/components/admin/shared` 재사용 |
| 급여 · 근태 | `docs/product/39-*` · `40-*` · `21-*` · `24-*` (계산 방식은 건드리지 않음) |
| 재류카드 · 직원 서류 | `docs/product/41-*` |
| DB · 권한 | `docs/engineering/04-data-model.md` · `05-rls-permissions.md` |
| 문서 찾기 | `docs/INDEX.md` |

## 어기기 쉬운 규칙 (전문은 CLAUDE.md)
1. 답은 **한국어**. 한국어 화면 · 답변에는 한자어 쓰지 않기(갑/을/병 등).
2. **코드를 바꾸기 전에 시작해도 되는지 먼저 묻는다.** 사용자가 분명히 시작하라고 한 뒤에만 구현 파일을 건드린다.
3. **커밋 · 푸시 · 배포(운영 DB 적용 포함)는 사용자가 채팅에서 직접 허락한 뒤에만.** 보고에 「커밋 안 함 — 컨펌 대기」 또는 해시 · 푸시 여부를 적는다.
4. 새 화면 문구는 `src/lib/i18n.ts`에 **ko · ja · en 함께**. 건물 이름은 데이터라 그대로 찍지 않는다.
5. 모든 `/mobile` 화면은 폰 · 폴드(≥600) · 태블릿(≥1000) 모두 맞게.
6. 날짜 범위는 도쿄 기준(`tokyoDayStart()` 등). 관리자 날짜 선택은 공용 피커 3종만, 내보내기는 Excel + PDF 같이.
7. 구현이 끝나면 `npm run lint` · `npm run build`, 같은 작업 안에서 **관련 MD 문서도 갱신**.
8. 구현 · 수정마다 맞는 **설치된 스킬을 `Skill` 도구로 실제 호출**하고, 보고에 쓴 스킬(없으면 없다고)을 적는다.
9. 다른 세션이 같은 저장소에서 일한다 — 내 파일만 스테이징(`git add -A` 금지).
