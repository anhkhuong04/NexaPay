# P1a-03 — Full/Partial Refund

**Ngày:** 02/11/2026
**Trạng thái:** IN PROGRESS; base `0e106df`, branch `feat/p1a-03-refunds`.

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
- [ ] 2. Typed refund form/review/receipt/history/payment aggregates/KPI, shared
  recovery và cross-screen isolation; behavioral unit và two-actor E2E with real DB,
  loss/reload/reauth/late navigation, keyboard/axe/320px/zoom; commit UI milestone.
- [ ] 3. Full format/lint/unit/strict build/audit, backend PostgreSQL clean verify,
  packaged smoke restart/refund replay, V5→V6 preservation, Compose giữ volume,
  desktop/mobile regression và read-only reconcile0.
- [ ] 4. Inline review actual diff/invariants; sync docs/contracts/index/evidence,
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
  V6 additive chưa apply volume local, chưa đánh dấu full/runtime/UI gates đạt.
