# P1a-02 — Payment Request & Checkout

**Ngày:** 02/11/2026

**Trạng thái:** IN PROGRESS, base `d65eab6`, branch `feat/p1a-02-payment-checkout`.

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

- [ ] 1. PostgreSQL RED→GREEN cho API/schema/pay/replay/ownership/rollback, MM-09
  payment races, after-lock DB expiry và one capture; implement V5/services/history,
  request/payment read models, contract. Commit backend milestone.
- [ ] 2. Typed UI/create/list/detail/QR/checkout/review/recovery/history/business
  queries. Unit behavioral regressions và connected two actors, loss/re-auth/reload,
  no pre-review POST, owner-only data; commit UI milestone.
- [ ] 3. Full frontend format/lint/test/build/audit; backend `-Pweb clean verify`
  PostgreSQL Testcontainers. Compose config/build/up giữ volume; E2E desktop/mobile,
  packaged restart payment lookup/replay, migration preservation, CLI findings=0.
- [ ] 4. Review actual diff/guards/recovery; docs OpenAPI/state/README/index/evidence;
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
- Frontend progress: **42/42** unit, 12 files; lint/strict build pass. New QR libs
  pinned from npm metadata: qrcode 1.5.4, @types/qrcode 1.5.6, jsqr 1.4.0 (test-only
  decoder). Primary docs [encoder](https://github.com/soldair/node-qrcode),
  [decoder](https://github.com/cozmo/jsQR). Runtime/connected gates pending.
