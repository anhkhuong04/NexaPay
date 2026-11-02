# P1a-02 — Payment Request & Checkout

**Ngày:** 02/11/2026

**Trạng thái:** VERIFIED local + GitHub Actions, base `d65eab6`, branch `feat/p1a-02-payment-checkout`.

## Goal và scope

FR-P01–03, FR-H01, FR-A04; BR-04/05/14/15/20; US-07/08; UI-09–12 và
Money Spec payment phần MM-09. P1a-01 đã verified. Scope request/create/list/detail/
cancel/expiry, nội bộ URL+QR, payer review/pay/recovery/receipt, owned history và
business payment visibility. Refund/MM-09 refund, webhook/notification/Console/mock
bank không thuộc slice này. Giữ V1–V4, không seed/repair/reset tiền.

## Contracts và design

- V5 additive: immutable PaymentRequest fields (merchant/creator, amount/currency,
  description snapshot, created/expires/publicRef/creationKey). State PENDING →
  PAID/EXPIRED/CANCELLED, không đảo terminal. Creation metadata replay qua unique
  merchant+UUID key và canonical fingerprint; duplicate khác payload 409.
- POST/GET `/api/v1/merchants/{id}/payment-requests`; GET detail và POST `/{requestId}/cancel`.
  Create body amount string 1..100000000, VND, description NFC/trim 1..140 points,
  expiryMinutes integer 5..1440 default 30; capabilities server. List cursor/keyset
  newest-first, status filter, limit 1..100. Cancel serialized; terminal request
  trả current state, không đổi PAID/EXPIRED. Owner membership enforce mỗi request.
- GET `/api/v1/checkout/{opaqueRef}` public minimal DTO (merchant display snapshot,
  amount/currency/description/status/expiry), không payer/email/account/key/secret.
  URL `/pay/{opaqueRef}`; QR encode exact same-origin URL, không external QR service.
- POST `/api/v1/checkout/{ref}/pay` authenticated+CSRF, Idempotency-Key UUID,
  `{amount,currency}` từ review. PAYMENT command resourceId = attempt ID; success
  result chứa paymentId, ledger ID và requestRef. Failed attempt chỉ payer thấy;
  không kết thúc request trừ actual expiry. Tối đa một Payment/request (DB UNIQUE).
- Claim command → lock request → actual DB clock → accounts UUID order → posting/
  result/audit atomically. Replay trước revalidation; self-merchant payment, locked
  source/destination, inactive merchant, insufficient/limit, wrong amount, terminal
  request → stored FAILED without entries. Technical rollback bounded retry qua
  MoneyCommandExecutor, không auto client POST. Payment ledger operationId=paymentId.
- Expiry lazy trên public/owner detail và owned list: row lock, actual DB clock sau
  lock, transition EXPIRED chỉ khi due. Không cần queue/broker để request hết hạn;
  expired request không thể pay/cancel thành công. Expiry audit dùng creator như
  subject cho system transition; không tin client timestamp. Không scheduler race
  riêng; cùng một resolver được các đường pay/cancel/read sử dụng.
- Deferred DB guards giữ request/attempt/payment/command/ledger/status/amount/owner
  linkage và append-only records; reconciliation mở rộng, giữ checks cũ. Runtime
  chỉ có quyền status timestamp cần thiết, không sửa money projections.
- Payer history/recent/detail thêm PAYMENT outbound. Merchant list/detail chỉ
  successful payment tối thiểu payer display/paidAt; không lộ failed payer attempts.
  Business overview có stats thật (paid today UTC/pending/received today/recent),
  chưa render refund KPI/CTA. Personal funding/P2P boundary không đổi.
- Checkout public → sign-in returnTo allowlisted exact UUID route → refetch review.
  Session query+personal balance, canonical fixed amount, no editable pay amount.
  Shared recovery hỗ trợ PAYMENT, actor/epoch-scoped reference (checkoutRef) và
  memory payload qua re-auth cùng user; reload lookup-only, không auto resend.
  Unknown/P0 operation recovery không bị bỏ qua khi mở checkout, và ngược lại.
- UI prototype: create form→detail link/QR/expiry/cancel confirm; filtered list,
  business payments; public checkout preview→authenticated review→result/unknown.
  Loading/empty/error/retry/expired/locked states, Fluent 2/tokens, min44px controls,
  keyboard/focus, mobile/320px/zoom, QR decode roundtrip và axe/visual QA.

## Tasks

- [x] 1. PostgreSQL RED→GREEN cho API/schema/pay/replay/ownership/rollback, MM-09
  payment races, after-lock DB expiry và one capture; implement V5/services/history,
  request/payment read models, contract. Commit backend milestone.
- [x] 2. Typed UI/create/list/detail/QR/checkout/review/recovery/history/business
  queries. Unit behavioral regressions và connected two actors, loss/re-auth/reload,
  no pre-review POST, owner-only data; commit UI milestone.
- [x] 3. Full frontend format/lint/test/build/audit; backend `-Pweb clean verify`
  PostgreSQL Testcontainers. Compose config/build/up giữ volume; E2E desktop/mobile,
  packaged restart payment lookup/replay, migration preservation, CLI findings=0.
- [x] 4. Review actual diff/guards/recovery; docs OpenAPI/state/README/index/evidence;
  commit/push main và hosted CI pass trước VERIFIED. P1a-03 refund là handoff.

## Execution evidence

- Preflight: CommandStore/Executor generic, V4 terminal/reconciliation và frontend
  recovery chỉ biết funding/transfer; phải mở rộng cùng PAYMENT, không bỏ guards.
  Wallet module có merchant queries; thêm public reference API cho payment posting.
- RED: 11 payment tests fail missing routes/tables; initial missing test import fixed
  before behavioral RED. GREEN focused **17/17** (14 payment + 3 architecture),
  no failures/errors/skips, 1m05s (`.tools/p1a02/backend-focused.log`). Includes same
  key 20-way replay, 8 payers one capture, pay/cancel race, actual expiry after
  lock and accepted-before-expiry/commit-after-expiry, wrong legs/creator guard,
  rollback/audit and independent payer/business privacy.
- Metadata creation lookup: owned GET `/merchants/{id}/payment-requests/by-key/{key}`;
  404 REQUEST_NOT_OBSERVED stays unknown, reference stored without payload, memory
  draft only, same-actor re-auth preserves reference; reload lookup-only.
- Frontend progress: **44/44** unit, 12 files; lint/strict build pass. New QR libs
  pinned from npm metadata: qrcode 1.5.4, @types/qrcode 1.5.6, jsqr 1.4.0 (test-only
  decoder). Primary docs [encoder](https://github.com/soldair/node-qrcode),
  [decoder](https://github.com/cozmo/jsQR). Focused checkout E2E **8/8** desktop/mobile đạt; full runtime/connected gates bên dưới.

- Backend milestone commit `7a6592c`, pagination fix `a258176`; UI milestone `c4357b0`. Full clean packaged build final:
  `./backend/mvnw.cmd -f backend/pom.xml -B -ntp -Pweb spotless:apply clean verify`,
  **74/74**, 0 failures/errors/skips, BUILD SUCCESS 2m38s. Cursor quá miền timestamp
  được reject400; không để JDBC chuyển thành500. Logs `.tools/p1a02/backend-full.log`.
- Final frontend lint/strict build/unit **44/44** đạt; focused connected **8/8**
  1m24s (`.tools/p1a02/e2e-payment.log`). Lần đầu 6/8: hai re-auth expectations
  đòi protected redirect trong public checkout; trace chỉ ra concurrent lookup401.
  Đã thống nhất public login prompt, giữ exact returnTo/key, bổ sung unit và chạy
  lại cả8 đạt. Không tăng timeout hoặc bỏ assertions.
- UI review sửa confirmation khi refetched terminal/LOCKED, fee từ capabilities,
  late cancel401 actor guard và pending navigation. Terminal payment sau rời
  checkout vẫn refresh Overview cùng actor. QR decode đúng URL bằng jsQR độc lập;
  review trước POST, keyboard confirm, loss/reload/no duplicate POST được kiểm tra.
- V4→V5 trên volume local: snapshot giữ accounts/balances/wallets/merchants/
  memberships/journal/audit counts; `.tools/p1a02/upgrade-before.json`,
  `upgrade-after.json`, `upgrade-result.log`. Không seed, repair hoặc reset.

- Self-review thực hiện inline trên transaction/lock order, V5 deferred guards,
  runtime grants, privacy DTO/history, actor/epoch recovery và React hooks/cache.
  Không có independent reviewer sign-off. Bổ sung min44px cho controls/links của
  payment screens, checkout320px/desktop CSS zoom200% trong connected regression.
  Ảnh desktop/mobile/share/review đã kiểm tra; không coi axe/zoom là chứng nhận.

## Giới hạn và handoff

Simulated VND, một instance, session memory; chưa deploy public hoặc benchmark.
Sau reload payload không được giữ để resend, chỉ lookup theo reference; đây là
recovery policy đã chốt. Không có refund/webhook/Console/mock-bank ở slice này.
**MM-09 phần payment** được kiểm tra; **MM-09 đầy đủ và P1a tổng thể còn pending**
vì concurrent partial refunds thuộc **P1a-03 — Full/Partial Refund**. Slice tiếp
khóa payment→accounts, giới hạn tổng hoàn, thiếu tiền merchant, replay FAILED và
payer LOCKED vẫn nhận nghĩa vụ refund theo baseline; không thay original PAID.

- Local full connected regression **36/36**, 3m48s, sau login-prompt fix và thêm
  checkout320px/zoom200/cancel44px assertions. Minor final control/link sizing
  polish đã strict build; final-image regression/runtime PASS theo evidence bên dưới. Frontend
  format/lint PASS, npm audit0; OpenAPI **197 refs** resolve, Markdown **67 links**
  đúng case/fences. Packaged SPA **8 files** byte-identical; repackage sau CSS-only
  polish không rerun Java tests đã pass74, không che failure/skips trong full gate.

## Final local verification

- Final image/SPA strict build, format/lint: PASS; unit **44/44** (12 files),
  audit **0 vulnerabilities**. Backend full clean **74/74**, 0 failed/error/skipped.
- Final-image connected **36/36**, 3m24s (`.tools/p1a02/e2e-full-final.log`), includes
  P0/P1a-01 regressions plus payment desktop/mobile, keyboard/axe/320px/CSS zoom200%,
  real QR decode, lost create/pay response, re-auth/manual same-key retry, reload,
  failed attempt→new success and late response navigation invalidation.
- Final packaged runtime smoke PASS (`.tools/p1a02/runtime-final.log`): deep links,
  session invalidation, persisted merchant capture/command lookup/replay/history,
  source5000/merchant5000 and personal/merchant isolation after restart; default
  cookie Secure/HttpOnly/Lax. JAR contains **8 byte-identical final dist files**.
- Compose config/build/up PASS giữ volume; V4→V5 preservation PASS. Read-only
  REPEATABLE READ reconciliation snapshot **0 findings**, exit0
  (`.tools/p1a02/reconcile-final.log`); không repair/reset/seed tiền.
- Milestones pushed `main`: `7a6592c` backend, `a258176` cursor bounds,
  `c4357b0` UI, `129d5e2` runtime/docs. Hosted gates ở
  [GitHub Actions run41415594033](https://github.com/anhkhuong04/NexaPay/actions/runs/41415594033),
  code SHA `129d5e2a3077bbdae5cba56a2c338349a530819a`; PASSED toàn bộ gates.
- Local Compose: `http://127.0.0.1:18082`; Business → Yêu cầu thanh toán → Tạo
  yêu cầu; mở link/QR bằng actor khác để review/pay. Volume và dữ liệu cũ giữ nguyên.

## Hosted verification và bàn giao

**PASSED:** [GitHub Actions run41415594033](https://github.com/anhkhuong04/NexaPay/actions/runs/41415594033),
branch `main`, code/evidence commit `129d5e2a3077bbdae5cba56a2c338349a530819a`.

- Fresh npm ci/format/lint/strict build PASS; **44/44** unit, 12 files;
  npm audit **0 vulnerabilities**.
- PostgreSQL Testcontainers + packaged backend **74/74**, 0 failures/errors/skips,
  Maven BUILD SUCCESS. Bao gồm toàn bộ P0/P1a-01 và payment guards/concurrency/
  expiry/atomic rollback/privacy/replay.
- Same-origin packaged runtime routing, restart invalidation, persisted merchant
  capture/lookup/replay/history, membership và default cookie: PASS.
- Connected Chromium desktop/mobile **36/36**, 3.1m. QR roundtrip, two-actor payment,
  no POST before review, failed→new intent success, response loss/re-auth/reload/
  same-key retry, pending navigation, keyboard/axe/reflow/zoom: PASS.
- Read-only reconciliation **0 findings**, exit0; artifact upload PASS.
  Không còn failed/skipped release gates của P1a-02. Final docs commit chỉ cập nhật
  evidence sau CI, không đổi runtime; P1a-02 hoàn tất, tiếp theo P1a-03 refund.
