# NexaPay — Đề xuất hướng dẫn và skills cho coding agent

**Ngày:** 02/11/2026  
**Trạng thái:** IMPLEMENTED CORE — chủ dự án yêu cầu triển khai ngày 02/11/2026; root AGENTS.md, Docs/AGENTS.md và 4 project skills đã tạo  
**Phạm vi:** Agent phát triển NexaPay, không phải chức năng AI tích hợp vào sản phẩm.

## 1. Khuyến nghị

Tổ chức thành bốn lớp có trách nhiệm khác nhau:

| Lớp | Nội dung | Vai trò |
|---|---|---|
| Root `AGENTS.md` | Baseline, bất biến tiền/quyền, cách chọn tài liệu, cách kiểm chứng/báo cáo | Hướng dẫn chung, ngắn và ổn định |
| Scoped `AGENTS.md` | Quy chuẩn backend/frontend/docs/infra và commands thật của khu vực | Chi tiết khi làm việc tại khu vực đó |
| `.agents/skills/` | Workflow cho một tác vụ có đầu vào/đầu ra rõ ràng | Nạp khi tác vụ phù hợp, không sao chép toàn bộ docs |
| Build/tests/CI/DB guards | Formatter, lint, typecheck, architecture tests, integration tests, constraints | Kiểm chứng bằng máy những điều instructions không tự bảo đảm |

PRD, ADR, Money Spec và UI Spec tiếp tục là nguồn nghiệp vụ. AGENTS/skills hướng dẫn cách áp dụng, không tạo một baseline thứ hai. Các giới hạn/quota/status/error code phải tham chiếu nguồn gốc, không chép lại thành hằng số trong nhiều skill.

Theo OpenAI Docs, Codex tìm `AGENTS.md` theo chuỗi thư mục từ project root tới working directory; file sâu hơn có thể ghi đè hướng dẫn rộng hơn. `AGENTS.override.md` được ưu tiên trong cùng thư mục. Chuỗi hướng dẫn mặc định có giới hạn 32 KiB. Vì vậy dùng đúng tên **AGENTS.md**, không dựa vào `Agents.md` hoặc đặt hướng dẫn gốc trong `.agents/AGENTS.md`. [Nguồn: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

Project skills đặt ở `.agents/skills/<name>/SKILL.md`. Codex chọn skill dựa trên name/description trước khi đọc nội dung đầy đủ; một skill cần frontmatter `name` và `description`. `agents/openai.yaml` là metadata tùy chọn. Các thư mục tự đặt như `.agents/rules/` không tự trở thành hướng dẫn chỉ vì tồn tại. [Nguồn: Skills](https://learn.chatgpt.com/docs/build-skills)

## 2. Cấu trúc đích

```text
AGENTS.md
.agents/
  skills/
    nexapay-vertical-slice/
      SKILL.md
    nexapay-money-change/
      SKILL.md
    nexapay-fluent-ui/
      SKILL.md
    nexapay-verification/
      SKILL.md
backend/
  AGENTS.md
frontend/
  AGENTS.md
infra/
  AGENTS.md
Docs/
  AGENTS.md
  README.md
  adr/
  ... existing product and technical documents
Implementation Plan/
  P0-01-identity-wallet.md
  P0-02-funding.md
  ... plans created only for substantial tasks
.github/
  workflows/
```

Đây là cây đích. Phần root AGENTS.md, Docs/AGENTS.md và bốn SKILL.md đã được triển khai; backend/frontend/infra và các plans minh họa chưa được scaffold. Thêm scoped files khi khu vực được scaffold; không tạo folder code rỗng chỉ để chứa hướng dẫn. Tận dụng `Implementation Plan`, không thêm `.agents/plans/` để lưu cùng thông tin.

Chỉ thêm `references/`, `scripts/`, `assets/` trong skill khi có nhu cầu thật. Ví dụ script kiểm chứng có ích sau khi build commands tồn tại; không tạo wrapper chỉ để gọi một command hoặc script trả success khi tool chưa được cài. Không cần README riêng cho mỗi skill hoặc bộ persona architect/backend/tester.

**Tình trạng sau triển khai:** workspace có Docs/logo, Implementation Plan, root/scoped Docs instructions và project skills; chưa có backend/frontend/build manifests hoặc `.git`. Trước dùng discovery theo repo từ thư mục con, cần khởi tạo Git ở bước setup được yêu cầu và kiểm tra project root. Hiện khởi chạy agent tại workspace root. Khi task bắt đầu từ root, đọc scoped AGENTS của vùng sắp sửa; không mặc định mọi file hướng dẫn dưới root đã được nạp.

## 3. Nội dung root AGENTS.md

Mục tiêu khoảng 80–120 dòng, không phải hạn mức runtime. Ưu tiên rules tác động đến quyết định của agent. **Mẫu dưới đây là lịch sử thiết kế; file dùng thực tế là [root AGENTS.md](../AGENTS.md).** Không sửa mẫu để thay hướng dẫn đang dùng.

```markdown
# NexaPay — Agent instructions

## Project baseline
- Build a simulated VND wallet/payment portfolio using the accepted baseline.
- Java 21/Spring Boot/PostgreSQL modular monolith; React/TypeScript/Vite,
  Fluent UI React v9 implementing Fluent 2 with NexaPay theme tokens.
- Current delivery order: P0, P1a, P1b, P1c; P2 is optional.
- Accepted decisions may be implemented without requesting approval again.

## Sources and scope
- Start from Docs/README.md. Before initial implementation planning, read
  Context, PRD, ADR-001, Architecture, Money Spec and UI Spec.
- For subsequent changes, load the relevant sections and refresh changed docs.
- PRD owns requirements; ADRs own decisions; Money Spec owns detailed money
  behavior; Architecture and UI Spec define their respective implementation views.
- Read the AGENTS.md files for every area you will edit, including when the
  session starts at the root. Child guidance must preserve project invariants.
- Resolve material contradictions before implementing the affected behavior;
  do not silently replace an accepted money/security decision.

## Invariants
- Simulated funds only; no real-bank/card integration or real financial data.
- Only ledger MoneyPostingService posts entries and balance projection.
- P0 business result, money writes, idempotency and audit commit together.
- Follow Money Spec for exact integer money, JSON string amounts, lock order,
  committed rejection replay and technical rollback; no direct balance edits.
- Never interpret client timeout or unobserved command lookup as financial failure.
- Enforce server-side identity, ownership and merchant membership.
- Preserve same-origin session/CSRF architecture; never bypass auth for a demo.
- Do not add microservices, broker, Redis or a replacement UI/auth stack without
  an accepted decision change. Dependency versions are pinned during scaffold.

## Working method
- Map behavior changes to relevant FR/BR/US and acceptance criteria.
- Plan substantial cross-layer work in Implementation Plan; keep small fixes small.
- Inspect current code and build configuration before selecting an approach.
- Keep module boundaries; fix the relevant cause without unrelated refactors.
- Prefer compatible changes; document migration of an existing contract/data model.
- Use applicable project skills. A skill complements these rules; it does not
  replace requirements or authorize unrelated actions.

## Verification and delivery
- Use commands from actual manifests/wrappers and scoped instructions; do not
  invent scripts or claim missing tools/checks passed.
- Run checks proportionate to the change. Money behavior requires the relevant
  PostgreSQL invariant/concurrency/recovery tests, not only mocked unit tests.
- Keep docs/contracts/tests aligned. Update commands when build tooling changes.
- Preserve unrelated user edits, secrets and environment configuration.
- Report the behavior changed, relevant requirements, checks actually executed
  with results, and remaining limitations. A plan is not evidence of completion.
- Complete authorized local work; request missing information only when it
  materially affects the task. Do not publish, incur costs or destroy data
  merely because a skill describes how to do so.
```

Mẫu là English để dùng thống nhất với identifiers/code, không phải yêu cầu agent chỉ giao tiếp English. Giải thích và tài liệu sản phẩm tiếp tục tiếng Việt. Không thêm “luôn hỏi trước mọi thay đổi” hoặc “phải lập plan dài cho mọi task”; các quy tắc đó làm chậm cả công việc đã được ủy quyền.

## 4. Scoped AGENTS.md

| Vị trí | Nội dung đặc thù nên có |
|---|---|
| `backend/AGENTS.md` | Package-by-feature, public module APIs, constructor injection, DTO/validation, transaction boundaries, JPA/SQL/Flyway, server authz, test commands |
| `frontend/AGENTS.md` | TypeScript, React/query/forms, Fluent 2 tokens/controls, money/recovery UX, accessibility, UI test/build commands |
| `Docs/AGENTS.md` | Nguồn sở hữu requirement, IDs FR/BR/US, Accepted vs Proposed, ADR/changelog và kiểm link/case |
| `infra/AGENTS.md` | Same-origin packaging, local/test/demo isolation, secrets/env, health checks, migrations/startup, real Compose/CI commands |

### Backend conventions

- Controllers dùng application service, không gọi repository xuyên module; domain rules không nằm trong controller. Không trả JPA entity trực tiếp qua REST.
- DTO immutable/Java record khi phù hợp; entities có identity/lifecycle riêng. Không ép mọi class có interface, mapper/framework hoặc layers rỗng.
- Constructor injection, explicit validation và error codes; không field injection hoặc catch-all trả HTTP 200.
- Transaction boundary ở use-case, posting tham gia cùng transaction; kiểm tra Spring proxy/self-invocation khi hành vi transaction phụ thuộc interceptor. Không HTTP external trong money transaction.
- Không serialize/retry bằng JVM lock để thay cơ chế DB. Migrations phải bảo vệ constraints/ledger append-only và tương thích dữ liệu hiện có; không sửa migration đã chạy trong môi trường chia sẻ.
- PostgreSQL Testcontainers cho rollback/locks/constraints/idempotency; mocks chỉ dùng khi không cần chứng minh DB behavior. ArchUnit kiểm boundaries. Đọc Money Spec thay vì chép mọi tham số vào hướng dẫn này.
- Pin formatter và chạy formatter/lint qua build/CI khi scaffold; style check không thay thế correctness tests.

### Frontend conventions

- Dùng `@fluentui/react-components`, Fluent System Icons và semantic NexaPay tokens. Không thêm UI kit thứ hai chỉ vì thiếu một layout; wrapper chỉ khi có domain semantics.
- Server state qua TanStack Query; local form/UI state đúng phạm vi. Query keys có actor/workspace, cancel/clear cache theo auth transition; không optimistic money success.
- Money API là integer string; dùng helper exact cho parse/format, không Number coercion tùy tiện. Validation client hỗ trợ UX, server vẫn quyết định số dư/quyền.
- Money-changing flow có review, authoritative result và recovery cùng key. Phân biệt unknown/pending/success/failed; không auto POST khi refresh hoặc login lại.
- Semantic controls, visible labels, focus, keyboard, contrast/reflow và reduced motion; kiểm thử component theo behavior, không snapshot toàn bộ markup để thay user-flow tests.
- TypeScript strict; typed API contracts, không `any` rộng để bỏ qua sai kiểu; effects phục vụ đồng bộ với external systems, không nhân bản derived/server state.

Commands cần ghi kèm working directory và điều kiện môi trường. Hiện chưa có manifests nên **không** ghi như thể `npm run lint`, `mvnw verify` hoặc một task Gradle đã tồn tại. Khi chọn build tool, thêm đúng wrapper/package scripts rồi cập nhật scoped instructions và CI cùng change.

## 5. Bốn skills ban đầu

| Skill | Trigger | Đầu ra / trách nhiệm | Ranh giới |
|---|---|---|---|
| `nexapay-vertical-slice` | Thêm feature/use-case end-to-end hoặc lập kế hoạch slice | Map FR/BR/US, contracts/data/UI/tests bị ảnh hưởng, plan khi cần, triển khai theo release gate | Không kích hoạt cho typo, đổi spacing hoặc một fix nhỏ đã rõ |
| `nexapay-money-change` | Sửa/review transfer, funding, ledger, balance, quota, idempotency, refund, holds hoặc DB constraints liên quan | Phân tích invariants/transaction/lock/recovery; implement hoặc findings đúng yêu cầu; regression evidence liên quan | Không áp cho mọi class Java hoặc UI thuần trang trí; review không tự sửa nếu chỉ được yêu cầu review |
| `nexapay-fluent-ui` | Thiết kế/implement/review màn hình, component, form, responsive/accessibility NexaPay | Áp Fluent 2/NexaPay tokens và UI Spec; đầy đủ data/error/recovery states; visual/keyboard checks | Không đổi money/security rules; không dùng Sites/Next.js để thay SPA đã chốt |
| `nexapay-verification` | Kiểm chứng change đã làm hoặc review readiness của slice | Chọn checks theo impact, chạy commands thật, báo pass/fail/not-run và bằng chứng | Không build cả hệ thống cho mọi docs edit; không tự sửa lỗi không liên quan hoặc tuyên bố pass khi test bị skip |

Các skill có thể phối hợp, không buộc nạp cả bốn cho mọi task. Ví dụ money bug nhỏ dùng money-change + verification; feature P2P hoàn chỉnh có thể cần cả bốn. Auth implementation thuộc backend conventions + vertical slice/verification; chưa cần một skill riêng chỉ để lặp Spring Security guidelines.

Thêm `nexapay-reliable-events` khi bắt đầu P1b (outbox/in-app/webhook/inbox delivery evidence). Thêm `nexapay-mockbank` ở P1c (provider protocol/hold/review). Không tạo placeholder skills cho toàn bộ roadmap trước khi có workflow thực tế. Không copy global skills như ui-ux-pro-max/skill-creator vào repo; project skill phải tự dùng được từ docs/controls đã có, generic skill là hỗ trợ tùy môi trường.

### Mẫu SKILL.md: money-change

````markdown
---
name: nexapay-money-change
description: Implement or review NexaPay changes affecting ledger, balances, funding quotas, idempotency, transfers, payments, refunds or withdrawal holds. Use when a change can alter money correctness; exclude presentation-only edits.
---

# NexaPay money changes

Identify the requested mode: implement, debug or review. Preserve that scope.

1. Locate the repository root and read the relevant sections of
   Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md, PRD and accepted ADRs.
   Inspect current transaction boundaries, schema and tests before editing.
2. Identify affected invariants, account types, key/fingerprint scope, lock
   order and durable outcomes. Distinguish business rejection, technical
   rollback and loss of client knowledge. For review, report violations
   with code references and reproducible scenarios instead of editing.
3. For implementation, keep posting inside the use-case transaction and
   preserve server ownership checks. Design any required migration with
   existing-data compatibility and DB guards. Do not change accepted rules
   silently to make a failing test pass.
4. Add/run regression checks for the changed behavior on PostgreSQL when
   DB semantics matter. Select relevant MM gates, including concurrency,
   duplicate replay or commit-response-loss recovery when affected.
5. Report the rule enforced or violated, affected FR/BR/MM references,
   checks actually run, their outcomes and any remaining uncertainty.

Do not copy numeric limits into this skill; the ADR/spec owns them.
Do not repair posted ledger/balances or reset a dataset as a shortcut.
````

Đây là mẫu lịch sử trong tài liệu; skill dùng thực tế nằm tại [nexapay-money-change/SKILL.md](../.agents/skills/nexapay-money-change/SKILL.md). Mỗi skill đã có description riêng; invocation giữ mặc định tự chọn, không có explicit-only override. Không tạo `agents/openai.yaml` vì đợt này chưa cần UI metadata/policy riêng. [Nguồn: Skills](https://learn.chatgpt.com/docs/build-skills)

## 6. Kiểm chứng thay vì chỉ yêu cầu “chuẩn chuyên nghiệp”

| Loại thay đổi | Checks phù hợp khi tooling đã tồn tại |
|---|---|
| Docs/instructions | Link/case/FR IDs, consistency, frontmatter skill; không yêu cầu chạy backend E2E |
| Backend domain/API | Compile/format, tests nghiệp vụ/API/authorization bị ảnh hưởng; update contract khi cần |
| Money/schema | PostgreSQL integration/migrations/guards và MM gates liên quan; reconciliation check |
| UI behavior | Typecheck/lint/component tests; E2E happy/error/recovery theo impact; visual/keyboard khi UI thay đổi |
| Cross-layer slice | Relevant backend+frontend checks, packaged flow smoke, acceptance theo FR/US |
| Infra | Config validation/build/smoke theo thay đổi, không expose secrets hoặc deploy dịch vụ ngoài scope |

Không áp tỷ lệ coverage tùy ý, bắt viết test cho mọi typo, ép comment/Javadoc mọi dòng hoặc buộc viết test chỉ mirror implementation. Bất biến có rủi ro cần test có ý nghĩa. CI nên cùng commands với local; lỗi phải được báo thay vì disable rule/test để đạt màu xanh.

## 7. Quản lý task và context

Plan chỉ dùng cho task nhiều bước: mục tiêu/release + FR/BR/US, relevant docs, phạm vi, checklist, acceptance, commands/results và việc còn lại. Không tạo memory file khác chứa lại balances/status/decisions. Khi tiếp tục session, kiểm tra plan với code/test thực tế; không tin trạng thái Done nếu thiếu evidence.

Task brief gợi ý:

```text
Implement P0 transfer recovery for FR-T04 / US-06.
Follow root/scoped AGENTS.md and the accepted Money Spec.
Preserve same-key recovery when the client has no transfer ID.
Run the relevant PostgreSQL and UI regression checks.
Report actual results and limitations; do not expand to P1 features.
```

Một skill không tự tạo multi-agent system. Không cần roster personas hoặc delegation mặc định cho dự án cá nhân này. Nếu sau này dùng nhiều agents, phân chia file ownership và integration verification theo task cụ thể, theo cơ chế host hỗ trợ và quyền được giao.

## 8. Cách triển khai và đánh giá bộ hướng dẫn

1. Tạo root AGENTS.md và bốn project SKILL.md; chỉ thêm scoped files cùng scaffold khu vực tương ứng. Không sửa global user configuration cho một quy tắc chỉ thuộc NexaPay.
2. Giữ root instructions ngắn, đọc relevant source theo nhu cầu; không bắt agent nạp toàn bộ docs/skills mỗi lượt. Không dùng AGENTS.override.md cho cấu hình bình thường.
3. Kiểm tra frontmatter/name/path/link và unfinished placeholders. Khi thực sự tạo skills, chạy skill validator có sẵn trong môi trường nếu có; không hardcode đường dẫn máy cá nhân vào repo.
4. Trong session mới, xác nhận active instruction sources và khả năng discover bốn skills. Kiểm tra lại từ backend/frontend sau khi có Git root/scaffold. Khi hướng dẫn stale, restart session theo OpenAI Docs. [Nguồn: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
5. Chạy thử các task có giới hạn trong workspace/test environment, kiểm tra hành vi thay vì chỉ xác nhận Markdown hợp lệ.

| Task thử | Kỳ vọng |
|---|---|
| Sửa typo landing | Không lập architecture plan, không nạp money workflow hoặc chạy DB concurrency suite |
| Sửa idempotency: business rejection replay sau funding | Money workflow; giữ failed result cũ; regression PostgreSQL đúng case |
| Đổi wallet layout trên mobile | Fluent workflow; giữ authoritative amounts/status; kiểm tra keyboard/reflow khi liên quan |
| Implement một P0 slice | Vertical slice + relevant money/UI checks; không thêm P1/broker |
| Testcontainers không khởi động được | Báo blocked/not-run đúng phạm vi, không tuyên bố correctness passed hoặc dùng mocks thay bằng chứng DB |
| Review migration/ledger code | Chỉ findings nếu yêu cầu review; phát hiện thiếu guards, không sửa/xóa journal để “fix” |

Các thử nghiệm task này là kế hoạch đánh giá hành vi, chưa chạy end-to-end trong đợt cài skills. Quick validation/kiểm tra link chỉ chứng minh cấu trúc. Khi có lỗi hành vi thực tế, sửa rule/description liên quan thay vì thêm checklist chung cho mọi task.

## 9. Nguồn dự án

- [Documentation index](README.md), [PRD](NexaPay_PRD_v0.1.md).
- [ADR-001 baseline](adr/ADR-001-project-baseline.md).
- [Money Movement & Recovery](NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md).
- [Architecture](NexaPay_SYSTEM_ARCHITECTURE_v0.1.md), [UI/UX](NexaPay_UIUX_DESIGN_SPEC_v0.1.md).

Tài liệu ghi lý do thiết kế developer workflow; không thay scope/quyết định sản phẩm baseline v0.2. Các mẫu trên là lịch sử tham khảo; các file AGENTS/SKILL dùng thực tế sở hữu operational instructions.

## 10. Implementation record — 02/11/2026

- Đã tạo [root AGENTS.md](../AGENTS.md) và [Docs/AGENTS.md](AGENTS.md).
- Đã tạo bốn project skills: [vertical-slice](../.agents/skills/nexapay-vertical-slice/SKILL.md), [money-change](../.agents/skills/nexapay-money-change/SKILL.md), [fluent-ui](../.agents/skills/nexapay-fluent-ui/SKILL.md), [verification](../.agents/skills/nexapay-verification/SKILL.md).
- Bốn skill folders đã pass `skill-creator/scripts/quick_validate.py`; kiểm tra thủ công phạm vi descriptions, planning/review/implementation modes và tham chiếu baseline. Chưa có independent/runtime behavioral evaluation, không tuyên bố đã kiểm chứng auto-selection trong host.
- Không thêm scripts/assets/metadata không cần thiết; các skills instruction-only dùng nguồn dự án theo đường dẫn relative, không phụ thuộc global custom skills hoặc đường dẫn máy cá nhân.
- Backend/frontend/infra scoped instructions và commands được thêm cùng scaffold sau này. Bộ skills không thay thế code/CI/DB guards và không đánh dấu bất kỳ P0 slice nào Done.
