# AI Collaboration Rules

## Purpose

Foldy may be worked on with multiple AI tools such as Codex, Claude, Cursor, and others.

This document defines shared rules so all AI assistants follow the same project direction.

## Primary Rule

Before changing code, read the relevant Markdown documents.

Important docs:

- `README.md`
- `docs/planning/01-decision-log.md`
- `docs/planning/04-project-workflow.md`
- Relevant product documents in `docs/product`
- Relevant design documents in `docs/design`
- Relevant engineering documents in `docs/engineering`

## Commit · Push · Deploy Need User Confirmation (ABSOLUTE, 2026-10-26)

어느 세션이든 수정 · 기능 구현이 끝나도 **스스로 커밋 · 푸시 · 배포하지 않는다.** 결과와 검증(lint · build · 테스트 · 화면 확인)을
보고하고 사용자가 채팅에서 분명히 허락한 뒤에만 한다. 커밋 허락과 푸시 허락은 따로 받는다.
배포에는 `main` 푸시(Vercel 자동 배포) · Vercel 배포 · 운영 Supabase 마이그레이션 적용 · 데이터 변경 · 앱 스토어 빌드 업로드가 모두 들어간다.
허락은 그 작업 한 번에만 유효하다. 자세한 규칙은 `CLAUDE.md` Highest Priority Rules 10.

## Documentation Must Stay Updated

Any AI that changes behavior, UI, data structure, permissions, or workflow must update the related Markdown docs.

Mandatory order for every change cycle:

```txt
1. Update relevant Markdown docs first (or at minimum in the same cycle before completion)
2. Implement code to match the documented direction
3. Run verification (lint/build/tests)
4. Re-sync docs if implementation-level details changed during coding
```

No feature work is considered complete until docs and code are aligned.

Additional completion rule:

- Every completed task must update the related Markdown docs in the same work cycle.
- "The code is done, docs later" is not an acceptable completion state.
- If coding changed the implementation details, the docs must be reconciled again before the task is closed.

Examples:

- New field added to maintenance request -> update maintenance workflow doc.
- Role permission changed -> update user roles and decision log.
- UI navigation changed -> update mobile/admin navigation docs.
- Tech stack changed -> update engineering docs and decision log.
- Notification changed -> update notification design doc.

## Do Not Invent Against Existing Decisions

AI assistants must not silently override confirmed decisions.

If a confirmed decision seems wrong:

```txt
1. Explain the concern
2. Propose a change
3. Wait for user confirmation
4. Update decision log if changed
```

## Current Confirmed Direction

Key confirmed decisions:

- PWA-first MVP
- Next.js App Router + TypeScript
- Supabase Auth/PostgreSQL/Storage/RLS
- Vercel deployment
- Korean/Japanese/English from the first implementation
- Warm-ivory operational UI, deep navy accent, selective Apple-inspired Liquid Glass surfaces, and strong readability
- Light mode only (dark mode deferred until post-launch; removed 2026-06-08)
- Beds24 webhook integration
- Mobile and admin web in one product
- Organization-based multi-tenant structure

## Code Style Principles

When implementation begins:

- Use TypeScript.
- Avoid hardcoded UI strings.
- Use i18n keys for all visible UI text. An automated guard (`npm run check:i18n`, part of `npm test`) fails on hardcoded Korean/Japanese/Kanji literals under `src/app` / `src/components`; legitimate domain data must use an `i18n-ignore` directive with justification.
- This applies to **all feature additions and all feature modifications without exception**.
- Do not ship or stage a feature with Korean-only hardcoded UI copy on the assumption that translation
  can be added later.
- New UX must be **multilingual by design from the first implementation pass**: `ko`, `ja`, and `en`
  must be added together for visible copy.
- Use shared types where possible.
- Keep permissions enforced server-side/database-side, not only in UI.
- Keep mobile PWA and admin web behavior role-aware.
- Prefer small, testable modules.
- Implement code in line with the documented Foldy project flow (`docs/planning/04-project-workflow.md`).
- Do not skip planning/flow constraints even under fast iteration; code quality and workflow consistency are both required.
- If implementation pressure conflicts with the documented flow, pause and update docs/decision log first, then continue coding.

## Project-Flow-First Coding Rule

All assistants must treat the project workflow as an implementation contract, not a reference note.

- Required baseline sequence: `Plan -> Design -> Document -> Implement -> Test -> Review -> Update documentation`.
- For bug-fix hotpaths, investigation and patching can be immediate, but final output must still include doc sync in the same cycle.
- Any behavior that diverges from current docs must be documented before the cycle is closed.

## Design Principles

- Follow Stitch designs when provided.
- Keep Liquid Glass readable and selective.
- Support light mode only (dark mode deferred until post-launch).
- Check Korean, Japanese, and English text lengths.
- Do not prioritize decoration over operational clarity.

### Mandatory Mobile Design Consistency (Hard Rule)

- This rule is mandatory and non-optional.
- Any change to `/mobile/*` must preserve one coherent mobile system: warm-ivory canvas/chrome, cream-white content surfaces, strong readability, and selective Apple-style Liquid Glass accents.
- Liquid Glass is not a full-screen treatment. Use it for floating navigation, bottom sheets, overlays, cards, chips, or other surfaces where translucency improves perceived quality without reducing clarity.
- `MobileShell` is the shared behavior baseline: scroll-aware top chrome, three-line hamburger menu trigger with a shorter middle line, full-screen slide-in side menu, notification bell, and the current warm-ivory bottom-attached tab bar with center FAB.
- Top bar, bottom tab bar, and bottom-sheet behavior must stay unified across the app unless an explicit documented design decision says otherwise.
- Bottom sheets must use the shared iPhone-style dismissal pattern: drag down from the top touch area / handle, or tap the empty scrim area to dismiss.
- Mixed visual quality between mobile tabs is not acceptable. If consistency is not achieved, the task is incomplete.

### Mandatory Admin Dashboard Design Consistency (Hard Rule)

- This rule is mandatory and non-optional.
- Any change to `/admin/*` must preserve one coherent desktop operations-console system.
- Repeated admin-dashboard patterns are shared contracts, not page-specific inventions.
- Calendar chrome, date pickers, month/week navigation, filter bars, search rows, summary cards, tables,
  status chips, action bars, empty states, loading states, error states, pagination, and right detail
  panels must stay visually and interaction-wise unified across dashboard pages.
- If a page needs a new shared pattern, define it for reuse and extend the dashboard language; do not
  create a one-off page-only control set when an existing pattern can be adapted.
- Calendar/date-selection UX must be especially consistent across attendance, reservations, roster,
  payroll, and any future admin pages. The same concept should not appear with different structure,
  spacing, or interaction rules unless there is an explicit documented reason.
- Multilingual support is part of the design contract. Shared dashboard components must be checked for
  `ko`, `ja`, and `en`, including longer labels in table headers, date controls, filter buttons, empty
  states, and action areas.
- Mixed density, inconsistent spacing, and page-by-page divergence in core admin controls are treated as
  incomplete work.

## Data and Permission Principles

- Every business record must belong to an organization.
- Do not leak data across organizations.
- Use role-based permissions.
- Part-time Staff can create/view requests but cannot change statuses.
- Order request processing is office-level.
- Price/revenue data should not be shown in Foldy MVP.

## Communication Rule

When an AI makes a change, it should summarize:

- What changed
- Which files changed
- Whether docs were updated
- What remains undecided

## Red Flag Rule

Stop and ask before:

- Changing the selected tech stack
- Changing role permissions
- Changing data deletion behavior
- Adding paid services
- Adding Apple Developer / Google Play dependency
- Changing multilingual strategy
- Changing PWA-first direction

## 모델 고르기 · 컨텍스트 토큰 아끼기 (2026-10-26, 사용자 지시)

목적: 수정마다 **그 일에 맞는 가장 가벼운 모델**을 쓰고, 리드(메인 세션)의 컨텍스트에는 결론만 남겨 토큰 소모를 줄인다.
에이전트를 부를 때는 `model` 을 명시한다(생략하면 리드와 같은 무거운 모델로 돈다).

### 어떤 모델에 맡기나

| 모델 | 맡기는 일 | 예 |
|---|---|---|
| **Haiku** | 정해진 답이 있는 읽기 · 기계적인 수정 | 파일 · 키 찾기(Explore), i18n ko/ja/en 빠짐 점검, 문서-코드 어긋남 목록, 문구 · 이름 바꾸기, lint 경고 고치기, 햅틱 · 아이콘 같은 한 줄 교체 |
| **Sonnet** | 범위가 분명한 한 영역의 구현 · 수정 · 리뷰 | 원인이 확인된 버그 수정, 한 화면 · 한 기능 구현, 영역별 코드 리뷰, 테스트 작성, 문서 갱신 |
| **Opus** | 판단이 어렵거나 틀리면 피해가 큰 일 | 권한 · RLS · 조직 격리, 마이그레이션, Beds24, 급여 · 연차 계산, 원인 모를 디버깅, 여러 영역에 걸친 설계, 최종 회귀 리뷰, 리드(작업 나누기 · 결과 합치기) |

- 헷갈리면 한 단계 아래 모델로 시작하고, 결과가 얕거나 틀리면 그 일만 위 모델로 다시 맡긴다.
- 위험 영역(CLAUDE.md 「High-Risk Change Areas」)을 **고치는** 일은 Opus. 같은 영역을 **읽기만** 하는 점검은 Sonnet 으로 충분하다.
- **작업 중간에 모델을 바꾸지 않는다.** 메인 세션 모델(`/model`)은 작업을 시작할 때 정한다 — 중간에 바꾸면 대화 기록은 넘어가지만
  프롬프트 캐시가 모델별이라 그때까지의 대화 전체를 캐시 없이 다시 처리한다(길수록 비싸다).
- **가벼운 모델은 «처음부터 떼어 낼 수 있는 일»에만.** 새 에이전트는 모델과 상관없이 맥락 0 에서 시작해 필요한 파일을 다시 읽는다.
  짧은 지시만으로 끝나는 독립된 일(예: 이 폴더 i18n 점검)은 Haiku/Sonnet 에 맡겨 이득이고, 리드가 이미 맥락을 쌓은 일의 후속을
  새 에이전트로 넘기면 읽기가 반복돼 오히려 손해다 — 그때는 리드가 직접 하거나 같은 에이전트에 `SendMessage` 로 이어서 맡긴다.

### 토큰을 아끼는 작업 방식

1. **넓게 읽는 일은 에이전트에게.** 여러 파일을 훑어야 하면 리드가 직접 읽지 말고 에이전트에 맡겨 결론만 받는다.
   한두 번 찾으면 끝나는 일(위치를 아는 파일 · 함수)은 리드가 직접 한다 — 에이전트를 부르는 비용이 더 크다.
2. **에이전트 지시는 좁고 구체적으로.** 맡는 파일(소유 범위) · 할 일 목록 · 하지 말 것 · 검증 명령 · 보고 형식을 적는다.
   병렬 에이전트는 파일이 겹치지 않게 나눈다(공용 `i18n.ts` 는 작은 Edit 만).
3. **보고는 짧게.** `path:line` · 한 줄 문제 · 수정 결과 · 검증 결과만. 코드 · diff 를 통째로 붙이지 않는다. 항목 수 상한을 둔다(예: 최대 15개).
4. **리드는 다시 읽지 않는다.** 에이전트가 확인한 내용을 리드가 같은 파일을 다시 열어 반복 확인하지 않는다 — 꼭 필요한 핵심 1~2건만 표본 확인.
5. **큰 파일은 부분만.** `i18n.ts`(2.5만 줄) · 큰 화면 파일은 통째로 읽지 말고 grep 으로 위치를 찾은 뒤 `offset/limit` 로 필요한 부분만 읽는다.
6. **명령 출력은 꼬리만.** build · test · lint 는 `| tail -n 20` 처럼 결과 줄만 본다.
7. **이어서 맡길 땐 같은 에이전트에게.** 같은 일의 후속은 새 에이전트 대신 `SendMessage` 로 이어서 — 이미 읽은 맥락을 다시 읽지 않게.
8. **빌드는 마지막에 한 번.** 병렬 에이전트는 `tsc` · eslint · 관련 테스트만 돌리고, `npm run build` 는 리드가 모두 끝난 뒤 한 번 돌린다(같은 트리에서 동시에 빌드하면 충돌).

## Project Guardrail Subagents (2026-06-22)

The repo ships **eight read-only Claude Code subagents** under `.claude/agents/` that automate the most common policy checks on every diff. They never write files; they only surface what's stale or unsafe.

| Agent | Triggers on | What it checks |
|---|---|---|
| `docs-sync-auditor.md` | Any code change | Which `docs/*.md` entries are now stale vs. the diff |
| `i18n-triple-locale-auditor.md` | New text / dictionary keys in `.tsx` | ko / ja / en presence in `src/lib/i18n.ts`; hardcoded strings |
| `mobile-shell-and-ios-pwa-reviewer.md` | `shell/*`, `layout.tsx`, `globals.css`, manifest | iOS Safari / standalone PWA regression checklist |
| `rls-and-org-isolation-auditor.md` | Server actions, queries, migrations | Org scope, service-role guards, RLS policies, role gates |
| `tokyo-timezone-scanner.md` | Any date/time logic change | UTC slicing that bypasses Tokyo helpers |
| `beds24-integration-safety-auditor.md` | `lib/beds24/*`, `api/beds24/*` | Polling regressions, secret leakage, webhook signature checks |
| `migration-impact-mapper.md` | New file under `supabase/migrations/` | Downstream impact on types / queries / docs |
| `image-upload-policy-checker.md` | New / modified image uploader | 5-vs-20 cap, `maxImages`, compression, storage paths |

Invoke explicitly (e.g. "run docs-sync-auditor on this diff") or let Claude Code auto-delegate based on the agent's `description` frontmatter. All agents are read-only (Read / Grep / Glob / `git diff` only). Anything they flag still requires a human to fix; they never edit code.

## Project Persona Expert Agents (실제 작업자, 2026-06-22)

가드 8개와 별개로, `.claude/agents/` 에는 **실제 코드 작업을 수행하는 6명의 전문가 페르소나**가 있습니다. 각 페르소나는 자기 도메인의 CLAUDE.md 룰을 강하게 알고 있고, 작업이 끝나면 자기 영역의 가드 에이전트를 스스로 호출합니다.

| 직원 | 책임 영역 | 도구 | 모델 |
|---|---|---|---|
| `backend-engineer.md` | Server actions (`src/app/**/actions.ts`), `src/lib/*`, API routes, Supabase 통합, 권한 게이트, 알림, Beds24 핸들러 | Read · Edit · Write · Bash · Grep · Glob | opus |
| `frontend-engineer.md` | React/TSX 페이지·컴포넌트, 모바일 셸 사용, 클라이언트 상태, i18n 연결, 폼 UX, App Router | Read · Edit · Write · Bash · Grep · Glob | sonnet |
| `design-engineer.md` | `globals.css`, 도메인 BEM 스타일시트, Tailwind 토큰, 모바일 셸 **시각 계약**(ivory+navy), BottomSheet 표준 | Read · Edit · Write · Grep · Glob | sonnet |
| `debugging-specialist.md` | 버그 재현·원인 격리·로그 분석·회귀 추적·lint/build 디버깅·최소 픽스 | Read · Edit · Bash · Grep · Glob | opus |
| `database-engineer.md` | `supabase/migrations/*`, RLS 정책, `src/types/database.ts`, Beds24 캐시 스키마, RPC/SECURITY DEFINER | Read · Edit · Write · Bash · Grep · Glob | opus |
| `product-docs-architect.md` | `docs/*` 전체 (planning / product / engineering), 결정 로그, current-status, 신규 기능 기획·요구사항 | Read · Edit · Write · Grep · Glob | sonnet |

### 가드와 페르소나의 협업

페르소나는 **일을 한다**. 가드는 **그 결과를 점검한다**. 페르소나의 시스템 프롬프트에는 자기 작업이 끝나면 어떤 가드를 자기가 호출해야 하는지 명시되어 있다 (예: `backend-engineer` → `rls-and-org-isolation-auditor` + `docs-sync-auditor`, `database-engineer` → `migration-impact-mapper` + `rls-and-org-isolation-auditor`).

### 자연어 호출 (한국어 OK)

자동 위임 트리거가 한국어 표현도 포함하도록 작성되었습니다. 예:

- "이 server action 만들어줘" → `backend-engineer`
- "이 화면 만들어줘" → `frontend-engineer`
- "디자인 좀 다듬어줘 / ivory 안 맞아" → `design-engineer`
- "이거 왜 안 돼? / 버그 잡아줘" → `debugging-specialist`
- "마이그레이션 만들어줘 / RLS 정책 추가" → `database-engineer`
- "기획해줘 / 결정 사항 기록 / docs 정리" → `product-docs-architect`

명시적 호출은 그냥 이름을 부르면 됩니다: "frontend-engineer 한테 시켜줘", "database-engineer 가 이 마이그 작성해".

### 거절 패턴

각 페르소나는 자기 영역 밖 요청을 거절하고 적절한 동료에게 위임을 제안합니다 (예: `frontend-engineer` 가 마이그레이션 요청 받으면 "이건 database-engineer 영역입니다").
