# P1a-01 — Merchant onboarding & wallet

**Ngày:** 02/11/2026

**Trạng thái:** IN PROGRESS; base `e940697`, branch `feat/p1a-01-merchant-wallet`.

## Goal và baseline

Deliver FR-M01, FR-A04, BR-02/04/05/20, ADR D05/06/10; merchant ACTIVE mô phỏng,
OWNER membership, ví riêng 0 VND atomic; UI workspace switching/profile. P0 DoD
đã VERIFIED; P1a chỉ Done sau payment/checkout/refund và MM-09 ở slice tiếp theo.
Không KYC/staff/multi-merchant, payment/refund/Console/API khóa ví hoặc seed tiền.

## Contracts và quyết định triển khai

- V4 additive: merchants(display_name 1..80 Unicode code points, ACTIVE), memberships
  OWNER unique merchant/user, wallets exactly one of user_id/merchant_id, ledger
  MERCHANT nonnegative/max 1000000000000 như PERSONAL. Giữ IDs/FKs V1–V3.
  Deferred guards bắt graph merchant+membership+wallet/account hợp lệ khi commit.
- `POST /api/v1/merchants` body `{displayName}` → 201 profile; actor từ session.
  Một merchant/user: serialize onboarding theo actor trong DB + unique constraint;
  duplicate/concurrent loser 409 MERCHANT_EXISTS, không tạo partial graph.
  Timeout/lost response: UI GET /merchants/me kiểm tra, không tự POST lại.
- `GET /merchants/me` → owned profile hoặc 404 MERCHANT_NOT_FOUND (chưa onboard);
  `GET/PATCH /merchants/{id}` và `GET /merchants/{id}/wallet` → owned only, unrelated
  404. PATCH chỉ displayName, trim/NFC/no control/1..80 points. 401/CSRF/strict JSON
  giữ nguyên. Không nhập ownerId/role/status/balance từ client.
- Membership là authority. Session summary lấy merchantId + effective MERCHANT role
  từ membership hiện tại, không cần logout/login hoặc sửa global grants; merchant
  APIs kiểm membership thật mỗi request, không tin role cache trong principal.
- WalletService public API provision/query merchant, recipient lookup lọc personal;
  funding/P2P/history `/wallets/me` vẫn personal-only. Ledger customer limit dùng
  chung cho PERSONAL/MERCHANT cả Java/DB; signed system accounts giữ nguyên.
- UI `/business/onboarding`, `/business/overview`, `/business/settings`; switcher
  personal/business, query keys actor+merchant+workspace. Chỉ render balance thật và
  metadata/profile, không fake payment KPI hoặc nút cho tính năng chưa triển khai.
  Workspace chưa onboard có CTA tạo merchant; refresh/session loss/error honest.
- UI prototype states trước nối API: onboarding name+demo disclosure, pending/error
  và check-existing action; business overview wallet pending/error/LOCKED+metadata;
  settings editable name/read-only ownership/currency. Fluent 2/tokens hiện tại,
  keyboard/focus, desktop/mobile/320px, axe và visual QA.

## Tasks và gate

- [x] 1. PostgreSQL integration RED: create/query/update/auth/ownership, concurrent
  onboarding, fault audit rollback, DB guards, P0 personal isolation. Implement V4
  và public module APIs, focused GREEN. Commit migration/API milestone.
- [ ] 2. Fluent typed API/routes/workspace navigation; focused behavioral unit tests,
  no actor/merchant cache mixing; connected onboarding→business→rename→personal,
  reload/re-auth, duplicate/lost response recovery. Commit UI milestone.
- [ ] 3. Full backend PostgreSQL `./backend/mvnw.cmd -B -ntp -f backend/pom.xml -Pweb verify`;
  frontend format/lint/test/build/audit. Compose config/build/up giữ volume; full
  desktop/mobile E2E/axe/reflow, packaged runtime smoke, reconciliation 0 findings.
- [ ] 4. Review actual diff, migration upgrade từ V3 có dữ liệu; cập nhật OpenAPI,
  UI states/README/index và evidence; commit/push main, hosted CI success trước VERIFIED.

## Verification risks

- Account typing/limits và personal-only P2P không bị nới khi thêm MERCHANT.
- Unique owner và deferred graph guard + audit failure rollback, runtime grants
  chỉ profile columns; migration owner riêng, không direct posted_balance grant.
- Session summary mới từ membership; missing membership không được đọc business.
- Frontend không tự retry POST khi unknown; stale response/account switch không
  cập nhật actor khác; recent/history/recovery P0 không bị thay nghĩa.

## Execution evidence

- Preflight: V1 wallets.user_id NOT NULL, PERSONAL-only account CHECK; recipient
  lookup hiện map profiles từ wallet.user. Cần sửa rõ exclusive ownership và lookup.
  History đã dùng personal reference. Không có merchant code/migration trước slice.
- Commands/outcomes sẽ cập nhật từ output thật; chưa claim acceptance pass.

- Backend milestone: initial behavior suite RED (missing merchant routes 404;
  spy setup MANDATORY error corrected by targeting unwrapped audit spy). GREEN
  focused **13/13** (10 merchant + 3 architecture). Full `-Pweb spotless:apply verify`
  **60/60**, 0 failures/errors/skips, 1m21s (`.tools/p1a01/backend-full.log`).
  Raw app-insert wrong account kind test avoids an existing personal unique owner,
  so its deferred kind guard is exercised directly. V3→V4 upgrade fixture verifies
  old wallet/audit and checksums; runtime upgrade snapshot also unchanged before E2E.
- Frontend milestone in progress: **33/33**, 10 files; lint/strict build/format pass.
  Includes unknown onboarding GET recovery, no auto POST, late actor result, name
  normalization/validation and separate wallet keys. Connected evidence pending.
- Compose config/build/up PASS, existing volume retained. Before/after snapshot of
  every existing account/balance/status/wallet owner and journal/audit counts is
  byte-identical (`.tools/p1a01/upgrade-result.log`); no seed/repair/reset.
