# NexaPay

Ví VND mô phỏng dùng Java 21 / Spring Boot, PostgreSQL và React / Fluent UI v9
(Fluent 2). Chỉ dùng dữ liệu giả; không có tiền hay kết nối ngân hàng thật.

P0-01 triển khai đăng ký và tạo ví 0 VND atomic, đăng nhập/session/CSRF, xem ví,
sửa tên hiển thị và đăng xuất. Funding, chuyển tiền, lịch sử và reconciliation
thuộc các slice tiếp theo; **chưa hoàn thành toàn bộ P0**.

## Chạy local

Cần Java 21, Node 22.18+, Docker/Compose. Maven Wrapper có sẵn, không cần Maven
toàn cục. Chạy từ root với PowerShell:

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f infra/compose.yaml --profile app up --build -d
```

Mở http://127.0.0.1:8080. Không có tài khoản seed; tự đăng ký, ví dụ
`alice@example.test`. `.env.example` chỉ chứa mật khẩu giả cho local, không dùng
cho public hosting. PostgreSQL local ở `127.0.0.1:5442`, app ở `127.0.0.1:8080`.
Đổi `DB_PORT` / `APP_PORT` trong `.env` nếu cổng bận. Không xoá volume để sửa lỗi.

```powershell
docker compose --env-file .env -f infra/compose.yaml logs --tail 100 app
docker compose --env-file .env -f infra/compose.yaml stop
```

Dữ liệu vẫn nằm trong volume `pgdata`. Nếu thay mật khẩu `.env` sau khi DB đã
khởi tạo, cần đổi credential trong PostgreSQL tương ứng; sửa env không tự đổi role.

## Phát triển

Chỉ chạy database nếu muốn dùng Vite và Spring Boot riêng:

```powershell
docker compose --env-file .env -f infra/compose.yaml up -d --wait db
# Load các biến local, không in credential.
Get-Content .env | Where-Object { $_ -match '^[A-Z_]+=' } | ForEach-Object {
  $pair = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
}
./backend/mvnw.cmd -f backend/pom.xml spring-boot:run '-Dspring-boot.run.profiles=local'
```

Terminal khác: `cd frontend`, `npm ci`, `npm run dev`. Vite proxy `/api` đến
`127.0.0.1:8080`; browser dùng một origin. Nếu đổi DB_PORT, đặt DB_URL tương ứng
cho Java (`jdbc:postgresql://localhost:<port>/nexapay`). Không bật profile `local`
trên public host: profile này cho phép session cookie trên HTTP loopback.

## Kiểm chứng

```powershell
cd frontend
npm ci
npm run format:check
npm run lint
npm run test
npm run build
npm audit --audit-level=moderate
cd ../backend
./mvnw.cmd -B -ntp -Pweb verify
```

Backend tests cần Docker để chạy PostgreSQL Testcontainers; không thay bằng H2.
Profile Maven `web` đóng gói `frontend/dist` vào JAR; luôn build frontend trước.
Linux dùng `./mvnw`. Docker image build bỏ chạy tests bên trong build container;
các kiểm thử bắt buộc chạy riêng bằng lệnh `verify` ở trên và trong CI.

E2E cần app/DB thật đang chạy tại 8080 (Compose hoặc JAR đã bundle SPA):

```powershell
cd frontend
node ./node_modules/@playwright/test/cli.js install chromium
npm run test:e2e
```

Desktop/mobile Chromium, axe, keyboard và reflow; reports tại
`frontend/playwright-report/`, screenshots/trace tại `frontend/test-results/`.
Backend reports tại `backend/target/surefire-reports/`. CI định nghĩa cùng gates
trong [.github/workflows/ci.yml](.github/workflows/ci.yml).

Từ root, `node infra/runtime-smoke.mjs` tự khởi động/dừng JAR ở cổng 18081 để
kiểm tra SPA/API routing, session mất hiệu lực sau restart, ví vẫn còn và cookie
Secure mặc định. Cần `.env`, database đang chạy và JAR đã bundle SPA. Script tạo
tài khoản giả riêng; không reset database. Có thể đổi `SMOKE_PORT` nếu cần.
Nếu app chạy ở cổng khác, đặt `E2E_BASE_URL` tương ứng trước khi chạy E2E.

Scripts gọi Node CLI trực tiếp để chạy được cả khi đường dẫn checkout chứa `&`
trên Windows. Lockfile pin dependencies. Override `minimatch` 11.0.1 áp dụng bản
vá [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
cho các công cụ lint; lint/tests/build kiểm tra khả năng tương thích.

## Ranh giới dữ liệu và bảo mật

Một Spring Boot instance phục vụ SPA/API cùng origin; HTTP session nằm trong
memory nên restart yêu cầu đăng nhập lại, user/ví vẫn lưu trong PostgreSQL.
Idle timeout 30 phút, absolute lifetime 8 giờ; BCrypt cost 12. Cookie mặc định
HttpOnly/Secure/SameSite=Lax. CSRF áp dụng cả login/signup/logout và PATCH.
Không có JWT trong browser storage hoặc public API cấp quyền/admin/sửa balance.

Flyway dùng owner, runtime dùng role hạn chế: không sửa balance hay xoá/sửa audit.
Opening balance do DB mặc định 0, không tạo journal giả. Tiền trong JSON là chuỗi
số nguyên. LOCKED wallet vẫn đọc được; money commands chưa được triển khai.
Login throttle trong memory chỉ dành cho một instance; forwarded IP chưa được tin cậy.
API body giới hạn 16 KiB cả khi không có Content-Length; vượt ngưỡng trả JSON 413.

## Tài liệu

- [Baseline và chỉ mục](Docs/README.md)
- [Plan, acceptance và kết quả P0-01](<Implementation Plan/P0-01-identity-wallet.md>)
- [OpenAPI](Docs/api/p0-01.openapi.yaml)
- [Wireframes và trạng thái UI](Docs/ui/P0-01-wireframes.md)
- [Quy tắc agent](AGENTS.md)
