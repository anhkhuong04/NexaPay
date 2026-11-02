# P1a-03 — Full/Partial Refund

**Ngày:** 02/11/2026
**Trạng thái:** VERIFIED local + GitHub Actions; P1a DoD closed; base `0e106df`, branch `feat/p1a-03-refunds`.

## Goal và baseline

FR-R01, FR-H01, FR-A04, FR-RC01; BR-03–07/09–13/17/18/20; US-09;
UI-11/13 và MM-09 phần concurrent refunds. P0/P1a-01/02 đã verified.
Hoàn toàn phần hoặc một phần đồng bộ, successful sum <= original capture;
merchant ACTIVE và ví nguồn ACTIVE/đủ tiền, payer gốc LOCKED vẫn nhận refund.
Payment/request gốc giữ PAID, refundStatus NONE/PARTIAL/FULL là derived read model.
Không có pending debt, webhook/notification/Console/mock bank hoặc real money.

## Contracts, schema và flow

- V6 additive; giữ nguyên V1–V5 và dữ liệu. `refunds` append-only, command/refund/
  payment/merchant/payer/account/journal linkage, exact two reverse ledger legs,
  no orphan REFUND posting, deferred aggregate guard. Runtime không được sửa
  balance/payment/refund; payment row-lock capability SECURITY DEFINER hẹp.
- POST `/merchants/{merchant}/payments/{payment}/refunds`, UUID Idempotency-Key,
  `{amount,currency,note?}`; canonical positive integer string1..100000000, VND,
  note NFC/trim <=140 points, no controls. Actor/membership từ session+DB;
  không nhận destination client. Terminal201/422 giữ nguyên result; technical
  rollback không consume key. Missing/unowned payment404 trước khi commit command.
- Claim → payment lock → sum successful refunds → accounts sorted UUID → reverse
  posting/refund/result/audit trong cùng transaction; shared executor/throttle.
  Replay trước eligibility hiện tại; insufficient/locked/over-refund stored FAILED.
- Owned GET payment detail/refund list/detail, keyset bounded20/max100 status filter.
  Payment view thêm refundedAmount/refundableAmount/refundStatus; business summary
  refund totals/count UTC thật. Payer chỉ thấy successful incoming REFUND history;
  failed refunds chỉ merchant owner; public checkout DTO giữ tối thiểu.
- UI từ paid request/payment → `/business/payments/:id/refund`, full remaining /
  partial amount + note → explicit review (original amount/remaining/payer/source)
  → confirm → authoritative receipt/UNKNOWN. `/business/refunds` và `/:id` cho
  history/detail. Actor/epoch/merchant/payment/key reference trước POST, payload
  memory-only, same-actor reauth lookup trước; reload lookup-only, không auto POST.
  Cross funding/P2P/payment recovery giữ intent chưa rõ và link về đúng refund.
- Wireframe states trước connect: loading/error/empty/locked/full refunded,
  form→review→pending→success/failed/unknown; no optimistic balance/status, refresh
  wallet/payment/history khi terminal kể cả response đến sau navigation.

## Tasks và acceptance

- [x] 1. PostgreSQL RED→GREEN: full/partial, samekey race/different keys over-refund,
  locked original payer allowed/locked merchant refused, failed replay after state
  change, audit rollback, owner privacy, guards/raw SQL/permissions/reconciliation;
  implement schema/API/read models/OpenAPI; commit backend milestone.
- [x] 2. Typed refund form/review/receipt/history/payment aggregates/KPI, shared
  recovery và cross-screen isolation; behavioral unit và two-actor E2E with real DB,
  loss/reload/reauth/late navigation, keyboard/axe/320px/zoom; commit UI milestone.
- [x] 3. Full format/lint/unit/strict build/audit, backend PostgreSQL clean verify,
  packaged smoke restart/refund replay, V5→V6 preservation, Compose giữ volume,
  desktop/mobile regression và read-only reconcile0.
- [x] 4. Inline review actual diff/invariants; sync docs/contracts/index/evidence,
  commit/push main, hosted CI pass trước VERIFIED. Đánh giá P1a gate theo evidence;
  P1b tiếp theo, không triển khai trong slice này.

## Execution evidence

- Preflight: working tree sạch; P1a-02 `0e106df` đã verified74/44/36. Giữ stack/
  dependencies hiện có; không cần thư viện hoặc external service mới.

- RED ban đầu 8 tests: missing refund routes404; 1 audit spy fixture cần unwrap
  Spring proxy rồi stub (đã sửa); không có API thành công giả. GREEN focused
  **25/25** (8 refund+14 payment+3 architecture), tiếp tục bổ sung raw SQL guards:
  **14/14** (11 refund+3 architecture), 0 failed/error/skipped, 1m02s.
  Logs `.tools/p1a03/backend-red.log`, `backend-focused.log`, `backend-guards.log`.
- Guards kiểm chứng: exact reverse legs, sum cap kể cả balanced legs và merchant
  đủ tiền, orphan REFUND journal, immutable refund/capture và runtime grants.
  Test-only merchant outflow/reversal đi qua balanced MoneyPostingService, không
  direct balance seed/edit và không tạo runtime endpoint tiêu tiền merchant.
- Shared OpenAPI command schema trước đây còn const DEMO_FUNDING dù payment
  reference dùng schema đó; sửa thành generic operation enum khớp API đã có.
  Tại backend milestone: V6 chưa apply volume local; full/runtime/UI gates còn pending (đã đóng ở final evidence bên dưới).

- Backend full clean packaged gate: **85/85**, 0 failures/errors/skips, BUILD
  SUCCESS3m22s, `./backend/mvnw.cmd -f backend/pom.xml -B -ntp -Pweb spotless:apply clean verify`.
  Final raw test fixture dùng cùng command key trong claim/terminal payload.
- Frontend **51/51** unit, 13 files; format/lint/strict build PASS, npm audit0.
  Seven new behavioral tests: no pre-review POST, over-remaining validation,
  unknown/manual same-key retry, refetched remaining disables open review, late
  actor isolation, strict resource recovery/reauth/logout và cross-payment intent.
- Focused connected **8/8**, 1m00s (`.tools/p1a03/e2e-refund.log`): partial→full,
  PAID unchanged, correct payer incoming history, gross received/refunded UTC
  summary, response loss/funding/reload, re-auth/no autoPOST, late Overview refresh.
  Desktop/mobile axe, keyboard confirm,320px/CSS zoom200% PASS; visual review dùng
  ui-ux-pro-max/React checklist, giữ Fluent v9/tokens. Final status copy Việt hóa;
  đã build lại, không đổi financial behavior. Full regression/runtime pending.
- V5→V6 trên volume local PASS:13 bảng financial/ownership/audit có cùng count và
  full-row digest trước/sau migration. `.tools/p1a03/upgrade-before.json`,
  `upgrade-after.json`, `upgrade-result.log`; không seed/repair/reset dữ liệu.
- Backend milestone `351a790`; UI milestone riêng. V6 đã apply local, từ đây mọi
  thay đổi schema phải additive migration mới, không rewrite V6.

- Resume sau gián đoạn: giữ commits `351a790` backend, `0749d4d` UI và mọi local
  thay đổi còn lại. Full E2E trước interruption **43/44**: assertion heading ở
  history chuyển sang detail có hai matching headings trong frame trước route
  commit. Error-context/trace cho thấy detail sau đó đã đúng. Bổ sung explicit
  destination URL và h1 detail wait trước h2, không `.first()` trên assertion hoặc
  tăng timeout. Runtime refund restart PASS; security-focused1/1 PASS sau bổ sung
  currency/destination-injection/missing capture assertions. Chưa mark VERIFIED.
- Ruling: tiếp tục plan/branch hiện có, evidence trong `.tools/p1a03` và plan này
  là ledger của slice; không tạo backlog cạnh tranh hoặc chạy lại các task đã có
  commit. Một fresh-context whole-branch reviewer được dispatch theo skill mới
  requesting-code-review; review không cho phép sửa V6 đã apply hoặc đổi scope.

- Fresh-context whole-branch static review (`refund_final_review`): không thấy
  finding blocking về correctness/security/recovery. Reviewer không sửa file hay
  chạy suites; evidence runtime/tests do phiên chính xác nhận riêng. Review scope
  gồm V6 permissions/aggregate/reverse legs, lock order/terminal replay/rollback,
  privacy read models và actor/resource/cross-operation recovery.

## P1a acceptance mapping

| Gate PRD / MM-09 / UI-S4 | Evidence cần đóng |
|---|---|
| Merchant onboarding và ví0, OWNER isolation | P1a-01 evidence + full MerchantIntegration/E2E regression |
| Link/QR, review, một capture/request | P1a-02 evidence + PaymentIntegration và QR decoder E2E regression |
| Failed attempt không khóa request | PaymentIntegration failed→new intent success và checkout E2E |
| Pay/expire/cancel race | PaymentIntegration actual DB clock after lock, accepted-before-expiry/commit-after-expiry, pay/cancel races |
| Partial/full refunds, không vượt gốc | RefundIntegration same-key20/different-key5, DB over-refund guard, two-actor E2E partial→full |
| Merchant locked/thiếu tiền, payer locked | RefundIntegration terminal failure/replay/newkey và original payer LOCKED success |
| Atomicity/recovery/privacy | Audit fault rollback, reverse legs/orphan guards, owner authorization, lost response/reauth/reload E2E |
| Financial reconciliation / package persistence | Read-only snapshot0 và refund lookup/replay/payer history sau JAR restart |

P1a chỉ đóng sau khi toàn bộ full local và hosted gates đạt. Không suy ra public
hosting, benchmark hoặc accessibility certification; P1b chưa được triển khai.

## Final local verification sau resume

- `./backend/mvnw.cmd -f backend/pom.xml -B -ntp -Pweb clean verify`:
  **85/85**, 0 failures/errors/skips, BUILD SUCCESS4m47s. Includes final strict
  currency/destination-injection/missing-capture security assertions. Log
  `.tools/p1a03/backend-final.log`; no backend source edits after this gate.
- Frontend format/lint PASS; unit **51/51**, 13 files (`unit-final.log`); strict
  build và audit0 theo evidence trên. Không thêm dependencies. Final JAR chứa
  **8 byte-identical dist files**, không có stale SPA assets.
- Final connected **44/44**, 6.6m (`.tools/p1a03/e2e-full-final.log`). Lượt resume
  chạy từ root với `--config frontend/playwright.config.ts`, cùng real app18082;
  screenshots/trace/report artifacts của lượt này giữ trong
  `.tools/p1a03/resume-test-results/`. CI chạy script chuẩn trong frontend.
- `node infra/runtime-smoke.mjs` PASS (`runtime-final.log`): SPA/refund deep links,
  session invalidation sau restart, persisted partial refund/lookup/replay,
  merchant3000/payer7000 và original payer incoming history, PAID/PARTIAL,
  P2P/payment regressions, default Secure/HttpOnly/Lax cookie.
- Compose restart giữ volume sau interruption. V5→V6 preservation13 tables PASS;
  Markdown **76 local links** đúng case/fences, OpenAPI **227 refs** resolve.
- Milestones: `351a790` backend/DDL/contracts, `0749d4d` UI/recovery,
  `ae09ba4` final security/navigation checks. Review độc lập không có finding
  blocking; local verification không đồng nghĩa public deployment/performance.
- Final read-only REPEATABLE READ reconciliation **0 findings**, exit0,
  `.tools/p1a03/reconcile-final.log`; không sửa/seed/reset tiền. Mọi local gate đã
  đạt trước merge; hosted gate còn pending. Dữ liệu/volume được giữ nguyên.
- Final docs review: shared Command.result description đã đồng bộ cho
  funding/transfer/payment/refund (business rejection có thể giữ original metadata;
  không phải current balance). Đây là contract prose, không đổi runtime/CI input.

## Hosted verification và bàn giao

**PASSED:** [GitHub Actions run41441983900](https://github.com/anhkhuong04/NexaPay/actions/runs/41441983900),
branch `main`, code/evidence SHA `1051349a3fb89883f6c3ddfdf0e910cd654ee03b`.

- Fresh npm ci/format/lint/strict build PASS; **51/51** unit, 13 files;
  audit **0 vulnerabilities**.
- PostgreSQL integration và packaged backend **85/85**, 0 failures/errors/skips,
  BUILD SUCCESS. Bao gồm P0/P1a-01/02 regression cùng full/partial refund,
  same-key replay/different-key races, exact reverse legs/aggregate/permissions,
  original payer LOCKED, merchant insufficient/locked terminal rejection,
  rollback/audit và ownership/privacy/security.
- Same-origin packaged SPA/API, refund deep links, restart invalidation,
  persisted refund lookup/replay/original-payer incoming history, unchanged
  original PAID/PARTIAL và default Secure/HttpOnly/Lax cookie: PASS.
- Chromium desktop/mobile **44/44**, 3.7m. Full journeys payment/refund, review
  trước POST, partial→full, response loss/re-auth/reload/no autoPOST, cross-screen
  recovery, late Overview refresh, keyboard/axe/320px/CSS zoom200%: PASS.
- Read-only reconciliation **0 findings**, exit0; reports/artifact upload PASS.
  Không còn failed/skipped release gate của slice. Commit docs sau CI chỉ ghi
  evidence/contract prose, không đổi runtime hoặc CI inputs.
- Milestones pushed `main`: `351a790` backend, `0749d4d` UI, `ae09ba4` checks,
  `1051349` packaged smoke/docs/local evidence. Sau interruption đã kiểm tra và
  tiếp tục các task còn lại, giữ nguyên commits/data/volume, không làm lại scope.

**P1a Done:** FR-M01/P01/P02/P03/R01, US-07/08/09 và UI-S4 đã có evidence qua
P1a-01/02/03; MM-09 pay/expire/cancel + concurrent partial refunds đã đạt theo
mapping trên. P0 vẫn xanh. Giới hạn một-instance/session memory, simulated funds,
lookup-only sau reload, chưa public deployment/benchmark/accessibility certification.
Local app: `http://127.0.0.1:18082`; Business → Thanh toán đã nhận → Hoàn tiền.

Tiếp theo là P1b operations/notification/webhook/Console/CSV theo baseline; lập
slice plan riêng khi bắt đầu. Không có phần P1b được triển khai trong task này.
