# NexaPay — Documentation baseline v0.2

**Date:** 2026-11-01  
**Updated:** 2026-11-02  
**Status:** Accepted design baseline; root/scoped Docs instructions và 4 project skills đã tạo. Implementation nghiệp vụ ứng dụng chưa bắt đầu.

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

1. Scaffold frontend/backend/Compose và pin compatible stable dependency versions.
2. Viết DDL/Flyway + OpenAPI + fixtures/tests cho P0 slice account/wallet/funding/transfer/recovery/history theo Money Spec; không dựng toàn bộ P1 schema trước.
3. Làm wireframes/prototype P0 mobile/desktop rồi nối API theo slice; triển khai CLI reconciliation, audit và CI cùng P0.
4. Nghiệm thu MM-01–08 và P0 DoD trước P1a. Host/public demo chỉ chọn khi biết ngân sách; không tự cam kết chi phí hoặc ngày release.

Thông tin kế hoạch chưa có: số giờ/tuần, hạn portfolio, ngân sách hosting. Các thông tin này không cản P0 local. Không có benchmark/test/deployment claim trong baseline khi chưa có evidence thực tế.

## Implementation plans

| Slice | Plan | Trạng thái |
|---|---|---|
| P0-01 Identity & Wallet | [Phạm vi, schema/API candidates, work packages và acceptance](<../Implementation Plan/P0-01-identity-wallet.md>) | PLAN_READY ngày 02/11/2026; implementation NOT_STARTED; funding/P2P/history là các slice tiếp theo |

## Làm việc với agent

Hướng dẫn dùng trực tiếp: [root AGENTS.md](../AGENTS.md) và [Docs/AGENTS.md](AGENTS.md). Bắt đầu phiên agent tại workspace root; scoped backend/frontend/infra instructions sẽ được thêm cùng scaffold và build commands thật.

| Project skill | Workflow |
|---|---|
| [nexapay-vertical-slice](../.agents/skills/nexapay-vertical-slice/SKILL.md) | Lập kế hoạch/triển khai feature end-to-end, map FR/BR/US và acceptance |
| [nexapay-money-change](../.agents/skills/nexapay-money-change/SKILL.md) | Implement/debug/review thay đổi ảnh hưởng tiền, ledger và recovery |
| [nexapay-fluent-ui](../.agents/skills/nexapay-fluent-ui/SKILL.md) | Giao diện React/Fluent 2, trạng thái dữ liệu và accessibility |
| [nexapay-verification](../.agents/skills/nexapay-verification/SKILL.md) | Chạy checks theo impact, báo evidence và giới hạn thực tế |

Ví dụ gọi rõ skill trong task: `Dùng $nexapay-money-change để review idempotency theo FR-T04/US-06, chỉ báo findings.` Hoặc `Dùng $nexapay-vertical-slice để lập kế hoạch P0 identity/wallet; chưa viết code.` Skill cũng để chế độ tự chọn mặc định theo description; không buộc nạp cả bốn cho mọi task.

**Kiểm chứng ngày 02/11/2026:** Bốn SKILL.md đã pass skill-creator quick validator. Skill vertical-slice đã được gọi cho task lập kế hoạch P0-01; plan ở bảng trên là artifact bàn giao. Điều này chưa chứng minh chất lượng mọi workflow hoặc auto-selection của host; application checks vẫn chưa chạy. Ví dụ money review phía trên chưa được thực hiện.
