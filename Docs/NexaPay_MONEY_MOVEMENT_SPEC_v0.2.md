# NexaPay — Money Movement & Recovery Specification v0.2

**Status:** ACCEPTED design baseline; chưa phải implementation/test report  
**Date:** 2026-11-01  
**Decision source:** [ADR-001](adr/ADR-001-project-baseline.md)  
**Related:** [PRD](NexaPay_PRD_v0.1.md), [Architecture](NexaPay_SYSTEM_ARCHITECTURE_v0.1.md)

## 1. Account và tiền

`LedgerAccount` có ID, currency, type, postedBalance và status đối với tài khoản khách hàng. `Wallet` là metadata/ownership, trỏ duy nhất tới một LedgerAccount. API wallet balance đọc account projection; không lưu thêm một Wallet.balance có thể lệch. LedgerAccount hệ thống không cần user hoặc Wallet giả.

| Account type | Owner | Quy tắc |
|---|---|---|
| PERSONAL | User | Một account/wallet VND/user; balance trong [0, 1000000000000] |
| MERCHANT | Merchant | Một account/wallet VND/merchant; cùng giới hạn PERSONAL |
| DEMO_ISSUANCE | System | Một account/môi trường, bắt đầu 0; được âm; không có API tiêu tiền tùy ý |
| MOCK_CLEARING (P1c) | System | Một account/môi trường; signed balance, được âm theo deposit/withdrawal |
| WITHDRAWAL_HOLD (P1c) | System/operation | Một account/withdrawal, khởi tạo 0; balance bằng amount khi pending, bằng 0 khi terminal |

Mọi account bắt đầu 0. Bootstrap metadata không có tiền; không seed balance khác 0. Cấp tiền seed cũng gọi nghiệp vụ funding và ghi quota/ledger. Số dư system vẫn phải nằm trong signed BIGINT và kiểm tra overflow; không áp quy tắc nonnegative của customer cho issuance/clearing.

- Amount command: chuỗi JSON theo regex `^[1-9][0-9]*$`, currency `VND`, min 1, max 100000000 VND; funding chỉ cho preset 100000. Balance/fee/refundableAmount cũng là chuỗi nguyên, balance hệ thống có thể có dấu `-` khi được phép hiển thị cho operator.
- Java dùng `long` với exact arithmetic; DB `BIGINT`. Không nhận exponent, separator, fractional amount hoặc number JSON cho money. Không làm tròn input sai.
- Một ledger transaction POSTED có ít nhất hai nonzero entries cùng currency, tổng signed amount bằng 0. A→B: A `-x`, B `+x`. Không có entries cho business rejection.
- `MoneyPostingService.post(operationType, operationId, entries)` là đường duy nhất ghi tiền. Caller bắt buộc có transaction; không dùng REQUIRES_NEW để tách ledger khỏi business record.
- Unique `(operationType, operationId)` ở ledger transaction chặn double-post độc lập với HTTP idempotency. Refund/hold/settle/release có operation type/ID riêng.
- Posted entries/transaction không UPDATE/DELETE; cũng không INSERT thêm entries vào transaction đã commit. DB trigger buộc header/entries được tạo trong cùng DB transaction. App DB role chỉ SELECT/INSERT các bảng ledger; migration owner tách biệt. Projection mutable chỉ qua posting capability; reconciliation phát hiện sai lệch, không tự sửa.
- Deferred constraint trigger kiểm tra balanced/nonempty transaction ở commit, kể cả transaction header không có entries; trigger trên header insert và entry insert. Migration tests phải thử insert thiếu entry, sai currency, lệch tổng và append vào transaction cũ. CHECK từng dòng, FK và UNIQUE bổ sung; không nhét SUM nhiều dòng vào CHECK.
- Từ P1c, mọi credit và debit của customer kiểm tra giới hạn trên available+held, không chỉ postedBalance; hold settle/release/create đều lock cả personal account liên quan dù settle không post entry vào personal. Điều này serialize biến động held với incoming payment/funding/refund và bảo toàn chỗ cho release.

## 2. Funding và quota

Funding post DEMO_ISSUANCE `-100000`, PERSONAL `+100000`; tài khoản issuance âm là lượng phát hành mô phỏng, không là khoản nợ user.

Quota mặc định: 500000 VND/user/ngày UTC, 50000000 VND/môi trường/ngày UTC. Backend tạo/lấy quota rows với unique `(scope, subject, utcDate)`, lock theo thứ tự cố định, check/update counters cùng transaction với funding/ledger/idempotency. Duplicate replay không tính quota lại; concurrent keys khác nhau không vượt quota. API trả remaining và `nextResetAt` UTC; UI render timezone người dùng. Public demo bật qua config; admin không override quota tùy ý bằng UI. Reset môi trường là thao tác developer trên toàn bộ demo dataset, không là chức năng cấp tiền.

## 3. Command identity và idempotency

### 3.1 Contract

- Money commands bắt buộc `Idempotency-Key`: UUID do client tạo một lần cho intent đã review; không là credential.
- Scope unique: `(actorUserId, operationType, key)`. Resource identity, source context, destination ID, amount, currency, note/defaults đã chuẩn hóa tham gia fingerprint. Không hash raw JSON thứ tự tùy ý, CSRF token, timestamp client hay session ID.
- Actor/ownership lấy từ session và DB; client không được chọn actor/role. Re-auth cùng user giữ scope; user khác không thể tra cứu/replay record này.
- Với cùng key: cùng fingerprint trả terminal result gốc; khác fingerprint trả HTTP 409 `IDEMPOTENCY_CONFLICT`, không đổi record. Result replay giữ nguyên resource ID, terminal status, HTTP status và business payload. Correlation ID của lần HTTP mới được phép khác; không replay current balance như một số dư mới nhất.
- Record terminal giữ suốt vòng đời dataset; không TTL xóa riêng keys đã post. Database reset phải đổi `environmentEpoch` và xóa toàn bộ business/ledger/idempotency/quota nhất quán; frontend bỏ recovery context epoch cũ.

### 3.2 Transaction protocol P0

1. Xác thực session/CSRF; validate schema, canonical money và ownership. HTTP 400/401/403/429 trước execution không tiêu thụ key; không coi là FAILED transfer.
2. Bắt đầu READ COMMITTED transaction. Claim key bằng insert-on-conflict vào unique index; không dùng check-then-insert không có uniqueness. Conflict với request đang chạy chờ commit/rollback trong lock budget.
3. Nếu key đã terminal: so fingerprint và replay. Key claim mới ở trạng thái tạm trong transaction, không được commit một P0 record IN_PROGRESS.
4. Lock business rows/quota nếu có, rồi các account tăng dần theo ID; recheck ownership, wallet status, limits và balance dưới lock. Account.status là nguồn cho Wallet ACTIVE/LOCKED, admin lock cũng lock row account đó.
5. Business rejection sau execution (insufficient funds, wallet locked, recipient không còn hợp lệ, quota/limit exceeded) được biểu diễn bằng result, không ném exception đánh dấu rollback. Commit FAILED operation, terminal idempotency result và audit; không post ledger, không thay balance/quota.
6. Thành công: MoneyPostingService ghi ledger + projection; ghi SUCCEEDED operation + result + audit (và outbox ở release có async). Commit tất cả cùng nhau, rồi mới gửi success HTTP.
7. SQL error/constraint violation/deadlock/technical exception phải rollback tất cả, kể cả key claim. Không ghi FAILED business result để che lỗi kỹ thuật. Nếu rollback đã xác nhận, retry toàn transaction tối đa 2 lần với key cũ; lock_timeout/deadlock hết budget trả 503 `COMMAND_RETRYABLE`. Nếu kết quả commit không xác định, trả 503 `COMMAND_UNRESOLVED` khi còn kết nối HTTP và để client recovery cùng key.

Không catch SQL error rồi tiếp tục dùng transaction PostgreSQL đã aborted. Retry nằm ngoài transaction interceptor. Lock wait budget mặc định 2s, statement timeout 5s, tối đa 2 retries sau attempt đầu trong tổng server command budget 20s; chỉ retry khi còn budget. HTTP client timeout 30s. Không gọi HTTP/provider trong money transaction.

### 3.3 Result lookup và frontend recovery

Endpoints đã triển khai P0 và P1a-02 (xem OpenAPI trong [chỉ mục](README.md)):

| Method/path | Contract |
|---|---|
| POST `/api/v1/transfers` | Body `{destinationWalletId, amount, currency, note?}`; source là personal wallet của session; 201 SUCCEEDED hoặc 422 committed business FAILED |
| POST `/api/v1/demo-fundings` | Body `{amount:"100000", currency:"VND"}`; cùng key/result protocol; quota từ server |
| GET `/api/v1/commands/{operationType}/{key}` | Authenticated actor scope; 200 terminal result (gồm originalHttpStatus, resourceId, status, result/error); 404 `COMMAND_NOT_OBSERVED` nếu chưa thấy committed record |
| GET `/api/v1/commands` | Actor-scoped recent committed commands, cursor paging default 20/max 100, sort createdAt/id giảm dần; hỗ trợ recovery khi mở tab mới |
| POST `/api/v1/checkout/{opaqueRef}/pay` | Session personal + CSRF, body `{amount,currency}`, UUID key; PAYMENT resourceId là attempt ID; SUCCEEDED result thêm paymentId/ledgerTransactionId/requestRef; ledger operationId là paymentId |
| GET `/api/v1/checkout/{opaqueRef}` | Public DTO tối thiểu: merchant snapshot, amount/currency/description/status/createdAt/expiresAt; không payer, key hoặc account metadata |
| GET `/api/v1/transfers/{id}` | Initiator hoặc recipient của transfer thành công; failed record chỉ initiator/operator được phép; unrelated resource trả 404 |

`COMMAND_NOT_OBSERVED` **không chứng minh thất bại**: transaction đầu có thể còn chạy hoặc chưa đến server. UI tiếp tục retry đúng POST/key/payload khi user chọn kiểm tra/thử lại; không tạo key mới khi chưa biết kết quả. GET lookup không tạo command. Không trả 202 durable acceptance cho P0 đồng bộ.

Client lưu recovery reference `{environmentEpoch, actorId, operationType, key, checkoutRef?}` (PAYMENT bắt buộc checkoutRef opaque để quay lại đúng checkout) trong sessionStorage trước POST. Không lưu password/token/note/full recipient data ở storage này. Trong cùng tab vẫn giữ draft trong memory để retry payload gốc; sau reload chỉ lookup theo reference, không tự POST. Có mục xem recent commands theo actor (paginated) ở API/session recovery để tìm command đã commit khi tab cũ bị đóng; nếu chưa có committed record, không có bằng chứng thành công/thất bại, UI giải thích và cho lookup lại. Không giả hứa recover một intent chưa commit nếu reference đã mất.

Khi có terminal business failure, key đó kết thúc; user bấm sửa/bắt đầu giao dịch mới sau khi nhìn thấy lỗi mới tạo key mới. Khi 401/CSRF hết hạn: re-auth cùng user, refresh CSRF và lookup trước; không auto POST. Logout xóa account cache/draft/storage reference, nhưng recent commands server vẫn thuộc actor cũ. Đổi workspace không đổi actor nhưng source context/resource phải thuộc fingerprint và query key.

### 3.4 Failure matrix

| Sự kiện | Durable state | Hành vi đúng |
|---|---|---|
| Invalid amount/schema hoặc unauthenticated | Không operation/key | Sửa input/login, chưa có money intent được thực thi |
| A thiếu tiền, business rejection commit | FAILED operation + terminal result; không ledger | Cùng key vẫn trả thiếu tiền dù sau đó A được funding; intent mới dùng key mới |
| Crash trước commit | Không partial writes; nếu rollback thì không record | Lookup rồi retry cùng key/payload |
| Commit thành công, response mất | SUCCEEDED + ledger + key cùng commit | Lookup/replay trả resource cũ; không post lại |
| Hai request cùng key | Unique index serialize | Cùng payload cùng result; khác payload 409 |
| Lookup chưa thấy record | Có thể còn transaction chưa commit | 404 là chưa quan sát được; không gắn FAILED |
| Notification lỗi sau money commit | Money vẫn SUCCEEDED | Retry delivery, không đảo tiền |

## 4. Global lock order và isolation

Mọi money use-case theo thứ tự: claim idempotency/unique provider event → business aggregate (`PaymentRequest` rồi `Payment` nếu có, hoặc `MockBankOperation`) → quota rows theo scope/ID → LedgerAccounts theo ID tăng dần → append ledger/audit/outbox. Chỉ lấy các nhóm cần dùng. Không có luồng lock account trước rồi quay lại lock payment/quota. Admin lock chỉ lấy account rồi append audit, không quay lại business row.

`READ COMMITTED` + explicit row locking được chọn cho cùng aggregate/account. Re-read state sau lock; không dùng stale JPA entity trước lock để tính số dư. Tests gồm A→B song song B→A, refund/payment, funding/quota, admin-lock race. Các FK/unique và trigger cũng có thể tạo contention: giữ technical retry có giới hạn, không claim hết mọi deadlock chỉ bằng sort ID.

## 5. Payment và refund (P1a)

- `PaymentRequest`: immutable merchant/amount/currency/expiry; `PENDING → PAID | EXPIRED | CANCELLED`. P1a-02 tạo metadata bằng key UUID riêng, unique `(merchant_id, creation_key)`; cùng canonical fingerprint trả resource đã tạo, khác payload 409. Lookup owned theo key trả 404 `REQUEST_NOT_OBSERVED` khi chưa quan sát được, không tự tạo lại. Reference `{actorId, merchantId, environmentEpoch, key}` giữ trong sessionStorage, draft chỉ memory; reload chỉ lookup.
- V5 hiện thực expiry lazy tại pay/cancel/public detail/owned detail/list dưới request lock với actual DB clock; không cần scheduler để chặn trả tiền sau hạn. Name/description snapshot được giữ nguyên. Tham khảo [OpenAPI](api/p1a-02.openapi.yaml) và [payment states](ui/P1a-02-payment-wireframes.md).
- Có nhiều `PaymentAttempt` cho request, mỗi attempt thuộc một actor/key và terminal SUCCEEDED/FAILED. Một request có tối đa một `Payment` thành công, enforce UNIQUE(payment_request_id). Lần thử thiếu tiền không biến request thành FAILED; payer có thể tạo intent mới.
- Pay/cancel/expire lock request row trước account. Lấy actual database clock sau khi có request lock để quyết định `now < expiresAt` (không dựa vào thời điểm bắt đầu transaction). Pay đã được chấp nhận dưới lock trước expiry có thể commit sau expiry; scheduler không override PAID. Các luồng dùng cùng ranh giới này.
- Merchant owner không thanh toán request của chính merchant bằng ví cá nhân; không cho P2P tùy ý vào/ra merchant wallet P1a. Merchant chỉ nhận payment và trả refund; withdrawal merchant ngoài scope.
- Refund lock payment row và các account đúng thứ tự; amount >0, sum(SUCCEEDED refunds)+new <= original amount. Refund đồng bộ SUCCEEDED hoặc FAILED; không pending/debt. Replay FAILED thiếu số dư giữ nguyên result; merchant cần intent mới sau khi có tiền.
- Refund chỉ từ merchant nguồn về payer account gốc; merchant nguồn phải ACTIVE và đủ tiền, payer có thể LOCKED để nhận nghĩa vụ hoàn tiền. Original payment giữ PAID; `refundedAmount` và `refundStatus` NONE/PARTIAL/FULL là dữ liệu tổng hợp riêng. Ledger đảo chiều mới liên kết payment/refund.

## 6. Mock bank và hold (P1c)

Provider chạy ngoài money transaction, dùng operation ID cố định làm provider idempotency key. Ghi operation + dispatch outbox trước gọi provider; worker có thể crash/retry an toàn. Incoming callbacks có chữ ký, provider event ID, operation ID, sequence và amount/currency khớp record; dedup inbox trong cùng transaction với transition/posting.

### 6.1 Deposit

Create PENDING operation không post tiền. SUCCESS callback hợp lệ post MOCK_CLEARING `-x`, PERSONAL `+x`; mark SUCCEEDED. FAILED không post tiền. Account phải ACTIVE khi tạo; callback hoàn tất operation đã chấp nhận vẫn được ghi có khi wallet bị khóa sau đó. Nếu credit vượt max balance, lưu callback/operation ở NEEDS_REVIEW, không ack như đã hạch toán; operator tra cứu, không tự cắt amount/tự sửa ledger.

### 6.2 Withdrawal

Mô hình chọn **hold qua ledger account**, không thêm một balance reservation thứ hai có thể lệch:

1. Accept: lock ACTIVE personal account đủ tiền; PERSONAL `-x`, WITHDRAWAL_HOLD(op) `+x`; commit PENDING op + idempotency acceptance + dispatch outbox.
2. UI: `availableBalance = personal.postedBalance`, `heldBalance = tổng hold đang mở`, `totalBalance = available + held`; tất cả được query cùng snapshot. Validation max customer balance xét available + held để còn chỗ release. P0 held=0.
3. Provider success: HOLD `-x`, MOCK_CLEARING `+x`; operation SUCCEEDED.
4. Provider definitive failure: HOLD `-x`, PERSONAL `+x`; operation FAILED. Release không cần ví ACTIVE vì là nghĩa vụ của hold đã chấp nhận.
5. Timeout/network loss không là definitive failure: giữ hold, query provider cùng operation ID. Sau 15 phút pending chuyển NEEDS_REVIEW/cảnh báo, vẫn giữ tiền; chỉ resolve theo provider result đã xác thực, không auto release theo timer.

Một hold chỉ có một kết quả settle hoặc release; operation row lock + unique ledger operation types và invariant terminal hold=0. State PENDING → NEEDS_REVIEW hoặc SUCCEEDED/FAILED; NEEDS_REVIEW có thể resolve SUCCEEDED/FAILED. Callback PENDING cũ không lùi terminal state; terminal duplicate cùng kết quả no-op; terminal mâu thuẫn giữ tiền/trạng thái đã post, audit và cảnh báo điều tra, không tự post bù.

P1c khác P0: HTTP 202 trả acceptance và operation ID sau commit PENDING; idempotency replay trả acceptance gốc, GET operation trả trạng thái mới nhất. Không dùng terminal idempotency result P0 để đóng băng trạng thái mock operation. Callback thay state operation, không sửa acceptance payload.

## 7. Wallet lock policy

| Action | Source locked | Destination locked |
|---|---|---|
| P2P / funding / merchant payment mới | Từ chối | Từ chối |
| Refund mới | Merchant locked: từ chối | Payer gốc locked: cho nhận refund |
| Mock deposit/withdraw create mới | Từ chối | Không nhận request mới vào ví locked |
| Callback hoàn tất deposit đã accept / withdrawal settle hoặc release | Theo operation đã accept; vẫn hoàn tất | Lock sau accept không hủy nghĩa vụ |
| View own history/balance | Cho phép | Ownership vẫn bắt buộc |

Race lock-versus-command được quyết định bởi account row lock: command đã kiểm tra và giữ lock được hoàn tất trước; lock action chờ rồi mới có hiệu lực. Audit ghi thứ tự thực tế. Khóa wallet không đồng nghĩa vô hiệu hóa login user hoặc xóa dữ liệu.

## 8. Reconciliation và verification gates

P0 CLI chỉ đọc, trả exit code khác 0 nếu mismatch; dùng một REPEATABLE READ read-only snapshot để không so ledger/balance từ hai thời điểm khác nhau. Kiểm tra per-account projection = SUM(entries), per-transaction sum=0/currency/entry count, unique posted operation, successful operation ↔ một ledger transaction, FAILED operation không có ledger, giới hạn account và funding quota/issuance. Aggregate đối soát dùng phép cộng chính xác không overflow.

P1c bổ sung linkage HOLD/SETTLE/RELEASE, heldBalance, terminal hold=0 và pending lâu. Không tự repair tiền; mismatch tạo report có IDs, investigation và regression test trước mọi bút toán bù được cho phép.

| Gate | Kịch bản bắt buộc |
|---|---|
| MM-01 | A=100000, 20 requests khác key cùng chuyển 10000: đúng 10 success, không âm, tổng tiền giữ nguyên |
| MM-02 | 20 requests cùng key/payload: một operation/ledger; cùng key khác payload conflict |
| MM-03 | Business failure đã commit rồi thay balance: replay vẫn failure cũ |
| MM-04 | Fault trước commit và mất response sau commit; lookup không cần resource ID; restart rồi login lại recovery |
| MM-05 | Direct invalid ledger inserts và append vào transaction cũ bị guard chặn; UPDATE/DELETE ledger bằng app role bị từ chối |
| MM-06 | Concurrent funding khác keys không vượt quota user/môi trường; UTC boundary bằng controllable clock |
| MM-07 | Lock race, A↔B và deadlock/lock timeout: bounded retry, không duplicate |
| MM-08 | Reconciliation phát hiện fixture lệch và không báo lệch giả khi giao dịch khác đang commit |
| MM-09 | Pay/expire/cancel race, failed attempt rồi pay thành công, concurrent partial refunds |
| MM-10 | Withdrawal 80000 từ tổng 100000 làm available=20000/held=80000; P2P 50000 bị từ chối; fail release hoặc success settle đúng một lần |
| MM-11 | Timeout giữ hold; callback duplicate/out-of-order/contradictory, khóa ví sau accept, deposit overflow → review |

## 9. Handoff

Spec này chốt behavior và transaction boundaries; Flyway DDL, OpenAPI đầy đủ và test fixtures phải được viết/review theo từng slice trước code nghiệp vụ tương ứng. Không cần dựng toàn bộ schema P1 để bắt đầu P0. Thay hành vi ở đây phải cập nhật ADR/PRD/UI acceptance cùng nhau.
