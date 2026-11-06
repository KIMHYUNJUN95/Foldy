# foldy-checkin

셀프 체크인 손님 웹 + 서버 API. Foldy 와 **따로** 빌드 · 배포한다(Vercel 프로젝트 `foldy-checkin`, Root Directory `apps/checkin`).

- 설계: `docs/engineering/16-self-checkin-technical-design.md` · 요구: `docs/product/44-self-checkin-prd.md`
- DB: 같은 Supabase 의 `checkin` 스키마(`supabase/migrations/202611020001_checkin_schema.sql`, 초안 — 운영 미적용)
- 환경 변수(서버 전용): `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `LIVEKIT_URL` · `LIVEKIT_API_KEY` · `LIVEKIT_API_SECRET`(직원 통화, 없으면 호출이 `unconfigured`, 운영 URL 은 `wss://` 필수)

```bash
cd apps/checkin
npm install
npm run dev     # http://localhost:3100/p/<건물>
npm run lint && npm run test && npm run build
```
