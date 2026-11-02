# NexaPay — Documentation baseline v0.2

**Date:** 2026-11-01  
**Updated:** 2026-11-02  
**Status:** Accepted design baseline; P0 Wallet MVP DoD closed và P1a-01 Merchant/Wallet VERIFIED local + GitHub Actions (60 backend, 34 frontend unit, 28 E2E). P1a-02 Payment/Checkout VERIFIED local + GitHub Actions (74 backend/44 frontend unit/36 E2E); P1a-03 Refund VERIFIED local + GitHub Actions (85 backend/51 unit/44 E2E); P1a DoD/MM-09 closed.

## Đọc theo thứ tự

| Tài liệu | Trách nhiệm |
|---|---|
| [Context](NexaPay_Context.md) | Mục tiêu portfolio, phạm vi, stack và delivery overview |
| [PRD](NexaPay_PRD_v0.1.md) | Nguồn yêu cầu sản phẩm FR/BR/US và release gates |
| [ADR-001](adr/ADR-001-project-baseline.md) | Quyết định đã chốt, lý do, trade-offs và default config |
| [Money Movement & Recovery](NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md) | Account/ledger, atomicity, idempotency/recovery, lock policy, hold/callback và tests |
| [System Architecture](NexaPay_SYSTEM_ARCHITECTURE_v0.1.md) | Modules, conceptual ERD, deployment, security, API/frontend boundaries |
| [UI/UX](NexaPay_UIUX_DESIGN_SPEC_v0.1.md) | Routes, screens, interaction/recovery, responsive/accessibility và UI gates |
| [Agent workflow design & implementation](NexaPay_AGENT_WORKFLOW_PROPOSAL.md) | Thiết kế bộ hướng dẫn, lịch sử đề xuất và trạng thái triển khai; không thay baseline sản phẩm |

Tên ba file vẫn có `_v0.1` để giữ link/open tabs; nội dung hiện tại là **v0.2**. Docs dùng đúng chữ hoa để hoạt động trên Linux. Các changelog nằm trong tài liệu tương ứng.

## Áp dụng baseline

- P0 → P1a merchant/refund → P1b operations/webhook/CSV → P1c mock bank; P2 optional.
- Quyết định Accepted không cần duyệt lại trước scaffold. Thay đổi quyết định tiền/security/phạm vi phải thêm ADR và cập nhật FR/BR/spec/UI liên quan.
- PRD sở hữu yêu cầu; ADR sở hữu quyết định; Money Spec sở hữu behavior chi tiết. Khi có mâu thuẫn mới, giải quyết và đồng bộ trước code phần liên quan, không tự suy diễn một exception.
- Visual tokens/measurements là starting values để prototype và test; không coi là screen đã được kiểm chứng. Design acceptance không đồng nghĩa implementation đã đạt.

## Công việc tiếp theo

1. P0-01 đã có frontend/backend/Compose, pinned tooling, DDL/Flyway/OpenAPI và tests identity/wallet. Xem [README chạy ứng dụng](../README.md).
2. P0-02 đã có funding/ledger/quota/commands/recovery và CLI đối soát funding; xem plan/evidence bên dưới.
3. P0-03 đã verified P2P/history, MM-01–08 và UI/recovery; evidence ở plan bên dưới.
4. P0-04 đã verified recent activity, trạng thái quick actions trên Overview và đủ 10 điều P0 DoD; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41402042152). P1a-01 merchant đã verified; P1a-02 payment/checkout đã verified → P1a-03 refund đã verified, P1a gate closed; tiếp theo P1b. Host/public demo chỉ chọn khi biết ngân sách; không cam kết chi phí hoặc ngày release.

Thông tin kế hoạch chưa có: số giờ/tuần, hạn portfolio, ngân sách hosting. Các thông tin này không cản P0 local. Không có benchmark/test/deployment claim trong baseline khi chưa có evidence thực tế.

## Implementation plans

| Slice | Plan | Trạng thái |
|---|---|---|
| P0-01 Identity & Wallet | [Phạm vi, implementation và acceptance evidence](<../Implementation Plan/P0-01-identity-wallet.md>) | VERIFIED ngày 02/11/2026; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41385330954); P0-01 đã bàn giao; xem P0-02 bên dưới |
| P0-02 Funding & Commands | [Implementation và acceptance evidence](<../Implementation Plan/P0-02-demo-funding.md>) | VERIFIED; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41391311765) |
| P0-03 P2P & History | [Implementation và acceptance evidence](<../Implementation Plan/P0-03-p2p-history.md>) | VERIFIED — 50 backend/17 frontend/16 E2E; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41397070504) |
| P0-04 Overview & Release Readiness | [Đánh giá tiến độ và implementation plan tiếp theo](<../Implementation Plan/P0-04-overview-release-readiness.md>) | VERIFIED — 50 backend/26 frontend unit/22 E2E; P0 DoD closed; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41402042152); kèm roadmap P1a |
| P1a-01 Merchant & Wallet | [Plan và execution evidence](<../Implementation Plan/P1a-01-merchant-wallet.md>) | VERIFIED — 60 backend/34 frontend unit/28 E2E; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41408005480) |
| P1a-02 Payment Request & Checkout | [Plan và execution evidence](<../Implementation Plan/P1a-02-payment-checkout.md>) | VERIFIED — 74 backend/44 frontend unit/36 E2E; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41415594033) |
| P1a-03 Full/Partial Refund | [Plan và execution evidence](<../Implementation Plan/P1a-03-refunds.md>) | VERIFIED —85 backend/51 unit/44 E2E; P1a/MM-09 closed; [CI passed](https://github.com/anhkhuong04/NexaPay/actions/runs/41441983900) |

## Artifacts implementation

- [OpenAPI P0-01](api/p0-01.openapi.yaml): 8 operations / 7 paths, session/CSRF, typed errors và money strings.
- [Wireframes/state flow](ui/P0-01-wireframes.md): screens/states P0-01.
- [OpenAPI P0-02](api/p0-02.openapi.yaml), [funding/recovery wireframes](ui/P0-02-funding-wireframes.md) và [reconciliation CLI](../infra/reconcile.sql).
- [OpenAPI P0-03](api/p0-03.openapi.yaml) và [P2P/history wireframes](ui/P0-03-p2p-history-wireframes.md).
- [OpenAPI P1a-01](api/p1a-01.openapi.yaml) và [merchant states](ui/P1a-01-merchant-wireframes.md).
- [OpenAPI P1a-02](api/p1a-02.openapi.yaml) và [payment/checkout states](ui/P1a-02-payment-wireframes.md).
- [OpenAPI P1a-03](api/p1a-03.openapi.yaml) và [refund states](ui/P1a-03-refund-wireframes.md).
- [Setup và verification](../README.md): commands thật và giới hạn runtime.

## Làm việc với agent

Hướng dẫn dùng trực tiếp: [root AGENTS.md](../AGENTS.md) và [Docs/AGENTS.md](AGENTS.md). Bắt đầu phiên agent tại workspace root; scoped [backend](../backend/AGENTS.md), [frontend](../frontend/AGENTS.md), [infra](../infra/AGENTS.md) đã có build commands thật.

| Project skill | Workflow |
|---|---|
| [nexapay-vertical-slice](../.agents/skills/nexapay-vertical-slice/SKILL.md) | Lập kế hoạch/triển khai feature end-to-end, map FR/BR/US và acceptance |
| [nexapay-money-change](../.agents/skills/nexapay-money-change/SKILL.md) | Implement/debug/review thay đổi ảnh hưởng tiền, ledger và recovery |
| [nexapay-fluent-ui](../.agents/skills/nexapay-fluent-ui/SKILL.md) | Giao diện React/Fluent 2, trạng thái dữ liệu và accessibility |
| [nexapay-verification](../.agents/skills/nexapay-verification/SKILL.md) | Chạy checks theo impact, báo evidence và giới hạn thực tế |

Ví dụ gọi rõ skill trong task: `Dùng $nexapay-money-change để review idempotency theo FR-T04/US-06, chỉ báo findings.` Hoặc `Dùng $nexapay-vertical-slice để lập kế hoạch P0 identity/wallet; chưa viết code.` Skill cũng để chế độ tự chọn mặc định theo description; không buộc nạp cả bốn cho mọi task.

**Kiểm chứng ngày 02/11/2026:** Bốn SKILL.md đã pass skill-creator quick validator. Skill vertical-slice đã được gọi cho task lập kế hoạch P0-01; plan ở bảng trên là artifact bàn giao. Điều này chưa chứng minh chất lượng mọi workflow hoặc auto-selection của host; application checks P0-01 đã chạy theo evidence trong plan; không suy ra toàn bộ P0 hoặc các workflow khác đã đạt. Ví dụ money review phía trên chưa được thực hiện.
