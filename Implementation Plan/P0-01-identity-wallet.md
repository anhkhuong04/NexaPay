# P0-01 — Identity & Wallet foundation

**Ngày:** 02/11/2026  
**Trạng thái kế hoạch:** COMPLETED — IW-00–07 đã bàn giao và nghiệm thu
**Trạng thái phần mềm:** VERIFIED — local và GitHub Actions passed; P0-01 Done, toàn bộ P0 chưa Done
**Chế độ task hiện tại:** Implementation; commit các mốc quan trọng và push lần đầu khi hoàn tất.

## 1. Kết quả cần đạt

Một người dùng dùng dữ liệu giả có thể mở landing, đăng ký, được tạo account/ví cá nhân/ledger account **0 VND trong cùng transaction**, đăng nhập, xem ví và hồ sơ của mình, sửa display name, refresh để khôi phục phiên còn hiệu lực và đăng xuất.

Đây là increment đầu của P0, không phải toàn bộ Wallet MVP. Hoàn tất slice không đồng nghĩa P0 Done và không chứng minh financial concurrency/idempotency của các money commands chưa triển khai.

### Nguồn đã đọc

- [Root instructions](../AGENTS.md), [documentation index](../Docs/README.md), [Docs instructions](../Docs/AGENTS.md).
- [Context v0.2](../Docs/NexaPay_Context.md).
- [PRD v0.2](../Docs/NexaPay_PRD_v0.1.md), đặc biệt FR-A01–04, FR-W01–03, FR-AU01, US-01/02 và P0 DoD.
- [ADR-001](../Docs/adr/ADR-001-project-baseline.md), D01–D10/D12/D17/D18 và defaults.
- [Architecture v0.2](../Docs/NexaPay_SYSTEM_ARCHITECTURE_v0.1.md), modules/data/security/frontend/verification.
- [Money Movement v0.2](../Docs/NexaPay_MONEY_MOVEMENT_SPEC_v0.2.md), account initialization, balance projection và lock policy.
- [UI/UX v0.2](../Docs/NexaPay_UIUX_DESIGN_SPEC_v0.1.md), UI-01/02/03/08, auth routing, data states và accessibility.

## 2. Khảo sát ban đầu và dependencies

Bảng này lưu evidence **trước scaffold** của task lập kế hoạch. Trạng thái implementation hiện tại và kết quả thực thi nằm ở mục 10–14; các nhận xét “chưa có” dưới đây là lịch sử.

| Thành phần | Quan sát ngày 02/11/2026 | Hệ quả |
|---|---|---|
| Workspace | Có AGENTS.md, Docs/, .agents/skills/, logo/, Implementation Plan/ | Có nguồn baseline và skills |
| Source/build | Chưa có backend/, frontend/, infra/, build manifests hoặc wrappers | Cần scaffold trước code nghiệp vụ |
| API/data | Chưa có OpenAPI, Flyway migrations, DB schema hoặc fixtures | Schema/API dưới đây là thiết kế kế hoạch, chưa là artifact thực thi |
| Quality | Chưa có application test suites, CI workflow hoặc runtime reports | Không có test/benchmark ứng dụng nào được ghi nhận pass |
| Git | Chưa có .git tại workspace root | Init repository là bước setup khi triển khai; chưa commit/push |
| Runtime tools | Chưa khảo sát phiên bản JDK/Node/Docker/Compose hoặc khả năng chạy Testcontainers | Kiểm tra trong setup; không giả định đủ tool và không tự cài hệ thống |

Baseline sản phẩm đã Accepted, không cần hỏi duyệt lại session auth/VND/monolith/Fluent UI. Dependency patch versions và lệnh build thực tế sẽ được xác minh/pin khi scaffold. Ngân sách/giờ mỗi tuần/deadline chưa có nhưng không chặn local slice; không tự đặt ngày release hoặc tạo host trả phí.

## 3. Phạm vi và traceability

| Requirement | Phạm vi trong slice | Tiêu chí bàn giao |
|---|---|---|
| FR-A01 / US-01 | Đăng ký email/password/display name, validate, chống email trùng | Account + role cá nhân + profile + account ledger + wallet + signup audit atomic |
| FR-A02 | Login/logout, session/CSRF, protected routes | Đăng nhập mới được đọc dữ liệu; logout/session expiry hết quyền đọc |
| FR-A03 | Đọc profile và sửa display name | Email chỉ đọc; không đổi/reset password/email |
| FR-A04 / BR-20/23 | Server-side role/ownership và safe data/logging | Actor từ session; không cấp role/owner từ payload, không lộ dữ liệu user khác |
| FR-W01 / BR-02/03/06 | Một personal wallet/account VND bắt đầu 0 | Không duplicate wallet và không tạo journal giả cho bootstrap 0 |
| FR-W02 / US-02 | **Một phần:** đọc balance/status và dashboard dữ liệu thật | Balance string từ ledger account; recent activity/history chờ slice sau |
| FR-W03 / BR-05 | **Một phần:** nguồn status ACTIVE/LOCKED và trình bày read-only | Locked vẫn xem được ví; reject money intents sẽ kiểm tra khi có funding/transfer |
| FR-AU01 / NFR-04 | **Một phần:** durable signup/profile-change audit | Audit cùng commit; không nhầm với ledger; money/admin audit bổ sung sau |
| NFR-01/07/08/09/10 | Security, setup, CI và UX theo phạm vi | Có setup/checks tái lập, responsive và trạng thái lỗi rõ ràng |

Ngoài slice: funding/quota/issuance posting, MoneyPostingService posting, idempotency/commands, P2P/recipient lookup, transaction history, reconciliation CLI hoàn chỉnh, ledger journal guards, merchant/Console, notification/outbox, mock bank/hold, public deployment. Các phần này vẫn là yêu cầu P0/P1 theo baseline, không bị bỏ khỏi roadmap.

Không thêm API setBalance, admin signup hoặc public lock/unlock để dựng test. Fixtures LOCKED chỉ ở test harness; không expose endpoint test trong demo runtime.

## 4. Ranh giới modules và transaction

| Module | Phần cần làm |
|---|---|
| identity | User/credential/global role, registration orchestration, session/security và principal |
| profile | Display name/profile capability; không lấy credential repository để trả qua HTTP |
| wallet | Personal wallet metadata/ownership, provisioning và owned queries |
| ledger | Capability tạo LedgerAccount 0 và đọc projection/status; chưa post money |
| audit | Append signup/profile-change facts, correlation ID; không thay financial ledger |

Registration application service gọi public capabilities, không truy cập repository của module khác. Hướng phụ thuộc cần kiểm chứng: identity registration → profile/wallet/audit, wallet provisioning → ledger; wallet/ledger không gọi ngược identity repository để tạo cycle. Query nhận actor ID đã xác thực, không lấy userId do client lựa chọn.

### Registration protocol

1. Validate/normalize email, display name và password trước transaction; hash password ngoài transaction để không kéo dài thời gian giữ lock.
2. Transaction tạo user ACTIVE, grant INDIVIDUAL, profile, PERSONAL ledger account 0/ACTIVE và personal wallet liên kết một-một; append signup audit.
3. Commit tất cả rồi mới trả created response. Failure ở bất kỳ bước nào rollback cả audit và các row mới; fault injection chỉ trong tests.
4. Unique normalized email và unique wallet/account ownership là chốt DB cho concurrent signup. Không dùng kiểm tra email tồn tại trước insert làm bảo đảm duy nhất. Nếu unique violation, rollback rồi map lỗi; không tiếp tục transaction đã aborted.
5. Registration không tự coi là financial command, không thêm money idempotency record hoặc journal 0. Mất response có thể khiến client chưa biết đã tạo account: không auto submit lặp; đề nghị đăng nhập. DB uniqueness ngăn tạo thêm ví khi cùng email được gửi lại.

Flow chọn cho kế hoạch: register commit → sign-in → overview sau login thành công, theo PRD J-01. Signup không tự cấp authenticated session; CSRF bootstrap có thể đã tạo anonymous session. UI copy/prototype phải phân biệt signup success với login success, tránh hiểu câu “Success → overview” trong UI-02 thành auto-login ngầm.

## 5. Data model và migrations cần tạo

Thiết kế tối thiểu đã được hiện thực trong [V1__identity_wallet.sql](../backend/src/main/resources/db/migration/V1__identity_wallet.sql). Không tạo toàn bộ P1 schema hoặc journal tables rỗng chỉ để chuẩn bị xa.

| Entity/table dự kiến | Dữ liệu chính | Invariant / ownership |
|---|---|---|
| users | UUID, normalized email, password hash, account status, UTC timestamps | Email unique/not-null; không trả password hash ở DTO |
| user_roles | user ID, role | Unique pair; public registration chỉ grant INDIVIDUAL |
| profiles | user ID, display name, updatedAt | Một profile/user; update chỉ actor hiện tại |
| ledger_accounts | UUID, account type, currency, posted balance, account status, timestamps | PERSONAL/VND lúc provision; balance BIGINT/default 0; customer bounds theo ADR; status ACTIVE/LOCKED |
| wallets | UUID/public wallet ID, personal owner ID, ledger account ID, currency, timestamps | FK/unique account link và unique owner/currency; không có Wallet.balance hoặc status bản sao |
| audit_events | ID, actor, action, resource, outcome, occurredAt, correlation ID, metadata tối thiểu | Durable append-only facts; không plaintext password/token/raw request body |

- UUID/public IDs không thay thế authorization. Server map owner từ principal, không nhận tùy ý ở signup/profile update.
- Ledger account hệ thống không cần user/Wallet giả. DDL/capability không được thiết kế “mọi LedgerAccount đều bắt buộc thuộc user”; system accounts thêm ở funding theo spec.
- Chỉ có PERSONAL wallet trong slice. Exclusive user/merchant ownership vẫn là mục tiêu Architecture; merchant FK/schema được bổ sung bằng migration P1a, không sửa migration đã dùng chung.
- Bootstrap account 0 là tạo metadata/projection ban đầu, không phải chuyển tiền. Capability không nhận initialBalance từ client và không thành đường update balance tổng quát.
- Flyway migrations versioned, runtime role tách migration owner; quyền audit theo hành vi cần thiết. Journal immutability/commit guards hoàn thiện trước money posting ở slice sau.
- Tests dùng PostgreSQL thật; kiểm tra not-null/FK/unique/bounds, concurrent signup, rollback và không có orphan wallet/account/profile/role/audit sau lỗi.

## 6. API contract cần hoàn thiện trước implementation

Các paths dưới đây đã được hiện thực theo [OpenAPI P0-01](../Docs/api/p0-01.openapi.yaml), được chốt trước controllers. OpenAPI là contract chi tiết; bảng giữ traceability của kế hoạch.

| Method/path dự kiến | Request/quyền | Success | Negative cases cần mô tả |
|---|---|---|---|
| GET /api/v1/auth/csrf | Public bootstrap, same origin | 200 token/header metadata cần cho browser; không auth credential | Cache policy no-store; không log token |
| POST /api/v1/auth/register | CSRF, email/password/displayName; không roles/owner/balance | 201 created IDs, không authenticated session | 400 invalid/over-posting, 409 duplicate email với safe copy, 403 CSRF; rollback lỗi kỹ thuật |
| POST /api/v1/auth/login | CSRF, email/password | 200 current actor summary + session cookie | 401 generic invalid credentials, 403 CSRF, 429 + Retry-After |
| POST /api/v1/auth/logout | CSRF/session contract rõ | 204, invalidate session/clear cookie | 403 invalid CSRF; define repeat-logout behavior trong contract |
| GET /api/v1/auth/session | Session hiện tại | 200 actor/roles/session-expiry metadata tối thiểu | 401 nếu anonymous/expired; không HTTP redirect HTML |
| GET /api/v1/me | Authenticated | 200 own displayName/email | 401; không arbitrary user lookup |
| PATCH /api/v1/me | Authenticated + CSRF; chỉ displayName | 200 updated profile | 400 field/unknown property, 401/403; không đổi email/roles |
| GET /api/v1/wallets/me | Authenticated | 200 personal wallet ID/currency/status/balance metadata | 401, data fetch failure giữ nghĩa đúng; owner lấy từ principal |

Response money dùng integer strings. Slice này returned balances là available="0", held="0", total="0" từ account/query semantics; held=0 đúng vì P0 chưa có hold, không hardcode available thay DB read. UTC timestamps theo baseline. Error envelope có code/message/correlationId/fieldErrors khi phù hợp; không lộ stack/SQL/hash.

Không tạo API đọc wallet bất kỳ chỉ để có ownership test: `/me` queries phải scope actor tại backend. Tests đổi session A/B và thử payload/query over-posting để chứng minh không truy cập/sửa B; route/resource không tồn tại không được coi là bằng chứng của một authorization policy đã implement.

## 7. Authentication và security acceptance

- BCrypt cost/password policy/email normalization theo Architecture; password 12–64 ký tự và tối đa 72 UTF-8 bytes, không truncate. Thống nhất Unicode counting và boundary tests giữa frontend/backend; confirmPassword là validation UI, không persist/log.
- Spring Security HTTP session in-memory một instance; same-origin, HttpOnly/Secure/SameSite=Lax, local HTTP chỉ bỏ Secure ở local profile. Không localStorage JWT, OIDC/Redis hoặc remember-me.
- CSRF cho signup/login/logout/PATCH; bootstrap trước submit và refresh sau login/logout. Không tắt CSRF để xử lý test/frontend integration khó.
- Login phải đổi session ID chống fixation và lưu authenticated context đúng cách cho requests tiếp theo; kiểm tra trên phiên bản Spring Security đã pin, không suy từ việc login endpoint trả 200.
- Idle 30 phút và absolute lifetime 8 giờ theo ADR; dùng clock/session test hooks phù hợp để kiểm tra boundary, không ngủ hàng giờ. Restart backend yêu cầu login lại, không mất persisted user/wallet.
- Generic login error cho sai password/email không tồn tại; 5 failure/account/15 phút và 30/IP/15 phút, 429/Retry-After; không permanent account lock. Nếu chạy sau proxy, chỉ dùng forwarded client IP từ proxy được tin cậy.
- Email/displayName đọc/sửa theo owner; signup không chấp nhận role ADMIN/MERCHANT, wallet ID, owner ID, account status hoặc balance. Không có admin workspace/public grant endpoint trong slice.
- Signup/profile mutation audit cùng DB commit; login failures là safe operational/security logs riêng, không giả là financial ledger.

## 8. UI và trạng thái cần bàn giao

Các deliverables dưới đây đã có [wireframes/state flow](../Docs/ui/P0-01-wireframes.md) và React/Fluent UI nối API thật. Kết quả nghiệm thu ghi ở mục 10–14.

| Screen/area | Behavior cần có |
|---|---|
| UI-01 landing tối giản | Brand/demo disclaimer, CTA sign-in/sign-up, không fake marketing feature |
| UI-02 signup | Labels, displayName/email/password/confirmPassword, policy help, safe errors/loading; created → sign-in, không mất context khi validation lỗi |
| UI-02 sign-in | Generic failure/throttle, show/hide password, password manager/paste; login success → overview; session check khi refresh |
| UI-03 overview (một phần) | Balance/status đọc API, demo badge, wallet ID; loading/error/stale/locked khác số dư 0 hợp lệ |
| UI-08 profile | Own profile, email chỉ đọc, sửa displayName, logout, demo/security copy |
| AppShell/auth boundary | P0 personal context, mobile/desktop, protected route restore, 401→login; không redirect loop hoặc open redirect |

- React/TypeScript/Vite, Fluent UI v9/Fluent System Icons, FluentProvider + semantic NexaPay tokens, tiếng Việt/light theme theo baseline. Không chọn UI kit/framework mới.
- Query keys gồm actor/workspace; logout/account switch cancel inflight + clear data trước render user mới. Không để response A về muộn ghi lên account B.
- Overview chưa có recent activity/funding/transfer/history API. Render phạm vi đã có, không dựng hoạt động giả hoặc buttons/routes trông đã thực hiện được nghiệp vụ; phần còn lại được thêm ở slice sau để hoàn tất UI-03.
- Wallet LOCKED vẫn đọc overview/profile; đây không phải user bị cấm login. Fixture status không làm xuất hiện public lock action.
- Kiểm thử keyboard/focus, visible field errors/status announcements, contrast, mobile reflow/zoom/reduced motion và refresh/deep links. SPA fallback không nuốt API 404 hoặc error JSON.

## 9. Work packages và thứ tự

Checkbox theo dõi công việc implementation; evidence thực tế ở mục 10–14.

| ID | Công việc | Dependency | Artifact / exit |
|---|---|---|---|
| IW-00 | Khảo sát toolchain; Git init khi setup, chọn/pin dependencies/build tooling, scaffold backend/frontend/infra | Baseline | Wrappers/manifests/lockfile, scoped AGENTS.md và README lệnh thật; không commit/push ngoài task |
| IW-01 | Finalize schema/constraints + OpenAPI/auth state flow | IW-00 | Flyway migrations và API examples có thể review, contract rõ signup/login/session/logout |
| IW-02 | User/profile/account/wallet provisioning + audit atomic | IW-01 | Public module APIs, rollback/concurrent-signup PostgreSQL tests |
| IW-03 | Security session/CSRF/login/logout/throttle/ownership | IW-01, IW-02 | Context/session lifecycle đúng, security/API integration tests |
| IW-04 | Own wallet/profile queries và profile mutation | IW-02, IW-03 | Real DTOs/strings/status, profile audit và isolation tests |
| IW-05 | P0 scoped prototype/tokens/AppShell/auth/overview/profile | API contract từ IW-01; integration sau IW-03/04 | Responsive UI nối API thật, states/cache isolation |
| IW-06 | Local packaging + CI + connected acceptance | IW-02–05 | Vite API proxy; bundle SPA+API same-origin, smoke và reports |
| IW-07 | Handoff/update docs và slice DoD | IW-06 | Test evidence, limitations và dependencies cho funding |

- [x] IW-00 hoàn thành (evidence mục 10–14).
- [x] IW-01 hoàn thành (evidence mục 10–14).
- [x] IW-02 hoàn thành (evidence mục 10–14).
- [x] IW-03 hoàn thành (evidence mục 10–14).
- [x] IW-04 hoàn thành (evidence mục 10–14).
- [x] IW-05 hoàn thành (evidence mục 10–14).
- [x] IW-06 hoàn thành (evidence mục 10–14).
- [x] IW-07 hoàn thành (evidence mục 10–14).

Khi IW-00 lựa chọn Maven/Gradle và package manager, ưu tiên wrapper/lockfile và commands thống nhất local/CI. Plan không giả định command nào đã tồn tại, không tự khóa patch version chưa kiểm chứng support/compatibility. Chỉ scaffold module/layers thực sự dùng.

## 10. Acceptance và verification matrix

Các checks local dưới đây đã **PASSED ngày 02/11/2026**; hosted [GitHub Actions cũng PASSED](https://github.com/anhkhuong04/NexaPay/actions/runs/41385330954) trên commit implementation `2dfeb47`. Không có test bị skip.

| ID | Kịch bản cần chứng minh | Evidence | Requirement |
|---|---|---|---|
| IW-T01 | Signup hợp lệ → đúng một user/profile/role/wallet/account ACTIVE, balance 0; signup audit | PASSED — IdentityWalletIntegrationTest: atomic signup, DB graph/hash/zero/audit | FR-A01, FR-W01, FR-AU01, US-01 |
| IW-T02 | Concurrent signup cùng normalized email → một account graph; không orphan, duplicate wallet hoặc double signup audit | PASSED — 4 concurrent signup requests, 1 success + 3 conflicts, no orphan | FR-A01, FR-W01, US-01 |
| IW-T03 | Fault sau tạo user/account hoặc trước commit → không partial rows/audit; restart không phá quan hệ đã commit | PASSED — fault after audit rolls back all rows; runtime-smoke restart preserves wallet | FR-W01, FR-AU01, NFR-04 |
| IW-T04 | Invalid password Unicode/byte limits/email và mass-assignment role/owner/balance bị reject; hash không plaintext/không trả ra API | PASSED — IdentityPolicyTest + API mass-assignment/DB assertions; 16 KiB known/chunked bounds | FR-A01/04, NFR-01/10 |
| IW-T05 | Login sai không leak credentials; valid login đổi session ID, request sau được auth; throttle/reset window đúng | PASSED — session fixation/context, generic credentials; LoginThrottleTest clock/concurrent permits | FR-A02/04, NFR-01 |
| IW-T06 | Unsafe methods thiếu/sai CSRF bị chặn; refresh token sau auth transition; cookie flags theo local/demo | PASSED — API CSRF regressions, real browser cookie checks; runtime default Secure/HttpOnly/Lax | FR-A02/04 |
| IW-T07 | Logout/idle/absolute expiry/restart → session cũ mất quyền; persisted user/wallet vẫn còn | PASSED — clock idle/absolute/logout tests; packaged-runtime restart + re-login | FR-A02, NFR-01 |
| IW-T08 | A/B tách session: mỗi người chỉ thấy/sửa mình; locked wallet đọc được status/balance; profile chỉ đổi displayName và audit atomic | PASSED — A/B profile/wallet isolation, LOCKED read and audited rename rollback | FR-A03/04, FR-W02/03, BR-20 |
| IW-T09 | Dashboard loading/error không giả 0; logout/switch và response cũ không lộ dữ liệu A sang B | PASSED — component/cache tests + E2E delayed response, 503, retry, expired mutation recovery | FR-W02, NFR-09/10 |
| IW-T10 | Signup→sign-in→overview 0→profile update→refresh→logout→protected route denial | PASSED — 4 Playwright cases across desktop/mobile on real Docker app/DB | US-01, phần overview US-02 |
| IW-T11 | Keyboard/focus/labels/errors, mobile/desktop, zoom/reflow/contrast và same-origin deep links/API 404 | PASSED — axe signup/wallet/profile, keyboard toggle, 320px reflow, screenshots; packaged deep link/API JSON 404 | NFR-08/09 |
| IW-T12 | Flyway clean setup, app runtime permissions, module dependency checks và CI build/frontend typecheck/lint/test | PASSED local — Flyway/PostgreSQL role guards, ArchUnit, typecheck/lint/build; hosted CI PASSED (run 41385330954) | NFR-07/08 |

Bootstrap 0 chưa cần posted entries. MM-01–08 của P0 **chưa được nghiệm thu** bằng slice này: không dùng việc mọi balance đều 0 để claim MM-08 đối soát hoàn chỉnh hoặc MM-05 journal guards đã đạt. Các checks đó bắt buộc trước P0 Done và được triển khai khi có ledger posting/funding/transfer.

## 11. Commands, evidence và hạn chế

| Check / working directory | Command và kết quả | Report / evidence |
|---|---|---|
| Backend — backend/ | `./mvnw.cmd -B -ntp -Pweb spotless:apply verify`: PASSED, 24 tests, 0 failed/errors/skipped | `backend/target/surefire-reports/`, `.tools/final-backend-verify.log` |
| Frontend — frontend/ | `npm run format:check`, `npm run lint`, `npm run test`, `npm run build`: PASSED, 8 tests; strict typecheck trong build | 3 test files dưới src/; production dist; `.tools/` logs |
| Dependency audit — frontend/ | `npm audit --audit-level=moderate`: PASSED, 0 vulnerabilities | package-lock.json; patched minimatch override 11.0.1 |
| Connected browser — frontend/ | `E2E_BASE_URL=http://127.0.0.1:18082 npm run test:e2e`: PASSED, 4/4, 29.0s | `frontend/playwright-report/`, `frontend/test-results/`, `.tools/final-e2e.log`; PowerShell đặt biến qua `$env:E2E_BASE_URL` |
| Compose — root | `docker compose --env-file .env -f infra/compose.yaml config --quiet`; `--profile app build app`; `--profile app up -d app`: PASSED | Image `infra-app`, real PostgreSQL 17.7 và non-root app container |
| Packaged runtime — root | `node infra/runtime-smoke.mjs`: PASSED | `.tools/runtime-smoke.log`; restart/session/persistence, SPA/API routing, default secure cookie |
| Hosted CI | [.github/workflows/ci.yml](../.github/workflows/ci.yml) chạy cùng gates + E2E | PASSED — [run 41385330954](https://github.com/anhkhuong04/NexaPay/actions/runs/41385330954), implementation commit `2dfeb47`; tất cả steps success và reports đã upload |
| Documentation | Local links/case/fences/JSON/YAML/OpenAPI refs + requirement IDs | PASSED — 16 documents, 92 local links/case, fences, JSON/YAML, 36 OpenAPI refs và 8 schema examples; 8 operations trên 7 paths |

Reports/generated artifacts được gitignore; tests/config và lệnh tái lập được commit. Không coi image build `-DskipTests` là test pass: backend đã chạy đầy đủ `verify` bên ngoài Docker; các lần package sau chỉ bundle UI mới. Các fake-account fixtures do E2E/runtime smoke tạo không chứa dữ liệu thật, không reset volume.

## 12. Slice Definition of Done và handoff

- [x] Connected flow ở mục 1 chạy trên local same-origin stack, không mock runtime data hoặc auth bypass.
- [x] IW-T01–12 có evidence phù hợp; local và hosted CI đều pass, không còn acceptance bắt buộc fail/not-run.
- [x] Schema/OpenAPI/code/UI/tests nhất quán; commands tái lập trong README/scoped AGENTS/CI.
- [x] Không duplicate wallet/projection, không seed nonzero, credentials an toàn, audit signup/profile đúng transaction.
- [x] Partial FR-W02/W03/FR-AU01 và P0 gates còn thiếu được ghi rõ; không tuyên bố P0 Done.

**Handoff sau slice:** personal ownership và ledger account 0; session/CSRF principal; typed own-wallet/profile APIs; audit capability; migrations/runtime permissions; CI/test setup; Fluent shell/query context. P0-02 funding tiếp tục xây MoneyPostingService, journal/guards, issuance/quota và command idempotency trước bất kỳ credit tiền nào. Transfer/history/recovery và reconciliation CLI tiếp tục các slice sau.

## 13. Lịch sử: kết quả task lập kế hoạch trước implementation

- Đã đọc full baseline và kiểm kê workspace; không có plan cũ cần hợp nhất trong Implementation Plan.
- Đã lập phạm vi/traceability, transaction/schema/API candidates, UI/security acceptance, IW work packages và test matrix.
- Đã chạy structural/reference validation của plan và index bằng Python: exit code 0; 23 link nội bộ hợp lệ, requirement references có trong PRD, không có checkbox implementation bị đánh dấu hoàn thành.
- Không tạo mã nguồn, migrations/OpenAPI thực thi, dependency pin hoặc kết quả test ứng dụng. PLAN_READY chỉ là kế hoạch sẵn dùng, không phải implementation Done.


## 14. Implementation log

- Toolchain: Java 21.0.12.1, Node 22.18.0, npm 10.9.3, Docker 29.1.3/Compose 2.40.3; Spring Boot 3.5.16 và Maven Wrapper 3.9.16. Wrapper/scripts/lockfile đã pin; không cài tool toàn hệ thống.
- Database local 5442 vì cổng 5432 đang bận. Acceptance dùng JAR 18080 và Docker 18082 vì cổng 8080 có tiến trình khác; không dừng hoặc thay đổi service đó. Mặc định repo vẫn 8080, đổi APP_PORT/E2E_BASE_URL khi cần.
- Signup không auto-login; no initial journal/nonzero seed. Runtime DB cấm INSERT/UPDATE balance và sửa/xoá audit; signup/profile audit cùng transaction. Body 16 KiB áp dụng cả chunked; CSRF token/credentials có redacted toString.
- Các lỗi phát hiện và sửa qua E2E: label selector phải bỏ required marker của Fluent; contrast sidebar/footer; controlled profile field để giữ giá trị sau refresh; explicit auth navigation khi mutation trả 401. Không nới lỏng axe/security assertions để pass.
- Visual QA đã xem landing desktop, wallet mobile và profile desktop; E2E kiểm tra không overflow ở 320px, screenshot desktop/mobile, axe trên signup/wallet/profile và keyboard focus password toggle.
- Commit milestones: `2641075` scaffold/contracts; `b9ac9ac` atomic provisioning/security; `76e59bb` Fluent UI; `7791711` API bounds; `75f7f72` browser regression fixes; `a2d7d3c` packaging/runtime smoke/CI.
- First push thành công đến `https://github.com/anhkhuong04/NexaPay.git`, branch `main`, implementation commit `2dfeb47`. GitHub Actions run `41385330954` PASSED toàn bộ frontend/backend/runtime/E2E và upload reports. Commit bàn giao sau cùng chỉ cập nhật tài liệu/evidence, không đổi runtime code.
- `.env` local dùng APP_PORT=18082; Docker app vẫn chạy tại `http://127.0.0.1:18082`. JAR đã được bundle lại từ frontend cuối cùng; tiến trình JAR kiểm thử 18080 và các subprocess smoke đã dừng. Kiểm tra tracked files không phát hiện credential patterns hoặc runtime secrets/build caches; working tree được commit sạch.
- Hạn chế đã chốt: một instance, session/throttle memory; public deployment/HTTPS termination chưa triển khai. Funding/P2P/history/reconciliation và MM-01–08 còn ở slice sau. Chưa có benchmark tải hay nghiệm thu toàn bộ WCAG bằng assistive technology; axe/keyboard/reflow là evidence trong phạm vi P0-01.
