# P0-04 — Overview và nghiệm thu Wallet MVP

**Ngày:** 02/11/2026  
**Trạng thái:** IN PROGRESS — user yêu cầu thực thi ngày 02/11/2026.

**Goal:** Hoàn thiện các yêu cầu Overview còn thiếu, đối chiếu P0 DoD và tạo
điểm bàn giao rõ ràng trước P1a.

**Architecture:** Tái sử dụng history API và terminal-cache invalidation P0-03.
Recent activity là server state theo actor, không có bảng/projection tiền mới.
Giữ React/Fluent UI v9, Spring Boot modular monolith và PostgreSQL hiện có.

**Spec:** [PRD](../Docs/NexaPay_PRD_v0.1.md) FR-W02/W03/H01, NFR-01/09,
mục 13 P0 DoD; [UI Spec](../Docs/NexaPay_UIUX_DESIGN_SPEC_v0.1.md) UI-03;
[Money Spec](../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) recovery và MM-01–08;
[ADR-001](../Docs/adr/ADR-001-project-baseline.md).

## 1. Tiến độ tại thời điểm lập plan

| Phần | Trạng thái có evidence |
|---|---|
| P0-01 Identity/Wallet | VERIFIED: signup atomic, wallet 0, session/CSRF, profile/logout |
| P0-02 Funding/Ledger/Commands | VERIFIED: issuance/quota, posting guards, replay/recovery, audit/CLI |
| P0-03 P2P/History | VERIFIED: transfer atomic/concurrency, owned history/detail, Fluent flow/recovery |
| Bộ kiểm thử tích lũy | 50 backend + 17 frontend unit + 16 E2E; không cộng số test của từng slice với nhau |
| Hosted CI | [41397070504](https://github.com/anhkhuong04/NexaPay/actions/runs/41397070504) PASSED trên code `c0d8796` |
| HEAD khi đánh giá | `00f7ce7`, chỉ thêm tài liệu evidence sau code đã pass CI |
| Reconciliation | 0 findings sau E2E; packaged restart/lookup/replay PASSED |
| P1a / P1b / P1c | Chưa triển khai; các yêu cầu trong baseline là thiết kế đã chốt |
| Public hosting / benchmark | Chưa có evidence deployment public hoặc số đo throughput/p95 |

Đã kiểm tra trạng thái CI khi lập plan; số test ở trên là evidence của run đó,
không phải một suite mới được chạy trong phiên lập kế hoạch.

## 2. Khoảng thiếu đã đối chiếu với code

1. `Overview` trong `frontend/src/App.tsx` chưa query/render 5–8 recent records
   theo UI-03; hiện có balance, wallet details và các link hành động.
2. Quick actions Send/Funding là link luôn hoạt động; UI-03 yêu cầu disable intent
   mới và có banner khi ví LOCKED. Backend và các màn money đã kiểm tra trạng thái;
   đây là khoảng thiếu của Overview, không phải evidence chuyển tiền từ ví khóa lọt.
3. Chưa có một bảng đóng P0 DoD tổng hợp. Ba slice VERIFIED không tự chứng minh
   mọi chi tiết giao diện trong baseline đã được triển khai.
4. Header `Docs/README.md` còn số liệu P0-02; README còn câu đối soát transfer là
   tương lai. Các câu này được đồng bộ khi lập plan, không thay evidence lịch sử.

**Quyết định đề xuất:** chốt P0-04 trước P1a. Không cần thêm release hay đổi money
rules; chỉ hoàn thiện các yêu cầu P0 đã có. Không ước lượng phần trăm toàn dự án
hoặc ngày hoàn thành khi chưa biết nguồn lực/deadline.

## 3. Ràng buộc chung

- Không sửa V1–V3 đã apply; không migration, balance seed, repair hoặc endpoint mới
  cho slice này nếu history API hiện tại đáp ứng.
- Tiền là canonical strings, format exact/BigInt; không optimistic money success.
- Query keys có actor; reuse invalidation prefix `['history', actorId]` và
  `['wallet', actorId]`. Logout/switch không để response cũ vào tài khoản mới.
- LOCKED chỉ chặn intent mới; history/details/recent commands tiếp tục truy cập.
- Sử dụng Fluent controls/tokens, labels và keyboard/focus; reflow 320px.
- Không mở merchant/Console/bank/CSV/notification/public hosting trong P0-04.
- Khi thực thi: test behavior thất bại trước sửa, chạy kiểm chứng phù hợp rồi
  commit theo mốc. Skill `nexapay-vertical-slice`, `nexapay-fluent-ui`,
  `nexapay-verification`; money skill nếu có thay đổi vào financial boundary.

## 4. Tasks và interfaces

### Task 1 — Recent activity trên Overview

**Files:** sửa `frontend/src/App.tsx`, `frontend/src/transfer.ts`, style cần thiết;
tạo `frontend/src/RecentActivity.tsx` và test tương ứng. Không tách/refactor toàn
bộ App chỉ để thực hiện slice này.

**Interface đề xuất:** mở rộng backward-compatible
`transferApi.history(filter, cursor?, signal?, limit = 20)`; RecentActivity gọi
`limit=5`, key `['history', actorId, 'recent', 5]`. Giữ default 20 cho HistoryPage.
Backend `GET /api/v1/transactions` đã nhận limit 1..100 và sort createdAt/id.

- [x] RED: test URL limit=5; list chỉ có records API trả về, links owned details,
  loading/empty/error/retry; các caller history hiện tại vẫn dùng limit=20.
  Expected: thiếu recent component/limit support làm các assertion mới thất bại.
- [x] Implement RecentActivity với type/counterparty/timezone/amount/status,
  link đầy đủ history và recent commands. Success incoming/funding ghi dấu +,
  outgoing ghi dấu −; FAILED thể hiện requested amount/bị từ chối, không giả
  biến động đã post. Giữ record order từ API.
- [x] Refresh Overview cập nhật cả wallet và recent activity; lỗi history không
  thay balance thành 0 hoặc che một balance fetch đã thành công, và ngược lại.
- [ ] GREEN: frontend unit/lint/build và connected journey funding→P2P→Overview
  cho cả sender/recipient. Kiểm actor switch và terminal response về sau navigation.
  Expected: recent list và balance phản ánh authoritative results đúng actor.
- [x] Commit: `feat: add owned recent activity to wallet overview`.

### Task 2 — Trạng thái ví và accessibility của Overview

**Files:** `App.tsx`/RecentActivity/components/style liên quan;
`frontend/e2e/identity-wallet.spec.ts` hoặc file E2E Overview riêng.

- [x] RED: render LOCKED, loading và failed wallet fetch; assert banner/status,
  disabled Send/Funding, history/commands còn dùng được. Expected: các link luôn
  active hiện tại không đạt assertion mới.
- [x] Implement trạng thái controls theo wallet data server; khi chưa biết status
  không render intent mới như đã sẵn sàng. Không dùng CSS-only disable anchor.
- [ ] GREEN: keyboard, focus, labels/axe, mobile 390px và reflow 320px; recent list
  không overflow UUID/text dài. Test LOCKED UI dùng fixture có nhãn trong component
  hoặc controlled GET response; không mở API lock/admin hay sửa tiền runtime.
  Expected: controls chặn intent mới, mọi luồng tra cứu vẫn hoạt động.
- [x] Commit: `fix: align overview actions with wallet availability`.

### Task 3 — P0 release evidence và bàn giao P1a

- [ ] Lập bảng 10 điều P0 DoD của PRD: mỗi điều có test/report/behavior tương ứng,
  phân biệt requirement đã đạt với limitation được baseline chấp nhận.
- [ ] Frontend/: `npm run format:check`, `npm run lint`, `npm run test`,
  `npm run build`; expected all pass, số test mới được ghi từ output thực.
- [ ] Backend/: `./mvnw.cmd -B -ntp -Pweb verify` (Linux `./mvnw`), Docker
  PostgreSQL Testcontainers; expected full regression xanh, không skip MM gates.
- [ ] Đóng gói Compose bản mới không reset volume; chạy `npm run test:e2e` against
  runtime, `node infra/runtime-smoke.mjs` và `infra/reconcile.sql` theo README.
  Expected connected journey pass, findings=0; không claim public deployment.
- [ ] Review các thay đổi thực tế, sửa findings quan trọng; cập nhật Docs/README,
  plan, commit/push theo authorization của phiên thực thi và xác nhận hosted CI.
- [ ] Chỉ mark P0-04 VERIFIED/P0 gate closed khi mọi acceptance có evidence mới.
- [ ] Commit: `docs: close P0 wallet MVP acceptance evidence`.

## 5. Review focus

1. Late result sau logout/account switch: recent/balance chỉ hiển thị actor hiện tại.
2. FAILED outgoing không tạo cảm giác đã trừ tiền; incoming failure không xuất hiện.
3. Hai fetch độc lập: history lỗi/empty không che lỗi balance hoặc giả số dư.
4. UUID/note/name dài và text zoom/mobile: wrap/reflow, không che focused control.
5. LOCKED sau navigation/refetch: intent mới disabled, command recovery vẫn mở.

## 6. Roadmap sau P0-04 — P1a

Đây là thứ tự đề xuất, chưa phải implementation/evidence. Lập plan chi tiết cho
từng slice khi bắt đầu, không scaffold toàn bộ P1 trước.

| Slice | Deliverable end-to-end | Gate chính |
|---|---|---|
| P1a-01 Merchant onboarding & wallet | Tạo merchant + OWNER membership + merchant wallet 0 atomic; business workspace, xem/sửa profile theo ownership, query balance thật | Một merchant/user; concurrent onboarding không tạo trùng/partial graph; user khác không đọc/sửa merchant; không cấp ADMIN; personal wallet giữ nguyên |
| P1a-02 Payment Request & Checkout | Create/list/detail/cancel/expiry, link/QR opaque URL, payer review/pay, attempts/payment, receipt và business visibility | Unique payment/request; failed attempt không đóng request; pay/cancel/expire serialize, DB clock sau lock; self-merchant pay bị chặn; terminal recovery/audit/reconciliation |
| P1a-03 Full/partial refund | Refund payment gốc từ merchant về payer gốc, remaining/refunded/status/history trên UI | MM-09: concurrent partial refund không over-refund; merchant thiếu tiền/LOCKED FAILED; payer LOCKED vẫn nhận; original payment giữ PAID |

### Các điểm migration cần giải quyết trước tiền merchant

- V1 `wallets.user_id NOT NULL` và unique `(user_id,currency)` hiện mô hình hóa ví
  cá nhân. Cần migration mới thể hiện personal ownership và merchant ownership
  tách biệt, giữ nguyên IDs/FKs/dữ liệu P0; không gắn ví merchant thành ví cá nhân
  thứ hai hoặc đổi nghĩa ownership của API `/wallets/me`.
- `ledger_accounts` hiện chỉ chấp nhận PERSONAL/DEMO_ISSUANCE. Thêm MERCHANT với
  giới hạn nonnegative/max balance trong DB và MoneyPostingService; chỉ thêm enum
  vào CHECK hiện tại là chưa đủ vì guard Java hiện kiểm PERSONAL.
- Giữ P2P/funding personal-only. Không vô tình cho WalletService recipient lookup,
  transfer/history personal đọc hoặc chuyển vào ví merchant sau mở rộng schema.
- Session/workspace visibility sau onboarding phải phản ánh quyền mới an toàn;
  authorization thực dựa OWNER membership ở server, không merchantId/role client.
- Terminal command guard/reconciliation hiện chỉ hỗ trợ TRANSFER/DEMO_FUNDING.
  Mở rộng cùng payment/refund ở slice tương ứng, không bỏ guard để hỗ trợ type mới.
- Capabilities/limits dùng chung nên được tập trung khi mở account types; không
  copy thêm các money constants đang lặp ở code P0 vào merchant/payment/refund.

**P1a Done** chỉ sau cả ba slice và MM-09. Sau đó mới đến P1b outbox/webhook/
Console/CSV, rồi P1c mock bank/hold/callback. Microservices, broker và public hosting
không phải prerequisite của kế hoạch này.

## 7. Execution ledger

- Branch `feat/p0-04-overview-readiness`, base `00f7ce7`; giữ các thay đổi tài liệu
  từ phiên lập plan. Scope thực thi chỉ Tasks 1–3; roadmap P1a là handoff.
- Pre-flight: HistoryService đã hỗ trợ limit 1..100; chỉ mở tham số frontend,
  không đổi HTTP schema. Terminal invalidation đã dùng history/actor prefix,
  bao phủ recent key. Backend/migrations không cần thay đổi.
- Thực hiện inline theo test-first và review toàn bộ thay đổi một lần trước bàn
  giao; checklist và evidence trong plan này là sổ tiến độ.

- Task 1 milestone: 6 behavior tests RED (missing rendered states and limit=20
  instead of 5) → GREEN. Full frontend **23/23**, lint/build pass;
  `.tools/p004/red-recent.log`, `unit-task1.log`, `lint-task1.log`, `build-task1.log`.
  Connected runtime checks follow after Task 2; Task 1 chưa mark toàn bộ gate.

- Task 2 milestone: 3 actions-state tests RED → GREEN; full frontend **26/26**,
  8 files, lint + strict build pass (`.tools/p004/unit-final.log`, `lint-final.log`,
  `build-final.log`). Actions dùng native disabled Fluent buttons, history/recovery
  links vẫn mở. E2E mới gồm 3 journeys × desktop/mobile; runtime checks tiếp theo.
