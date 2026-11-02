package vn.nexapay.payment;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.merchant.MerchantService;
import vn.nexapay.shared.ApiFailure;

@Service
public class PaymentRequests {
  private final JdbcTemplate db;
  private final MerchantService merchants;
  private final AuditService audit;

  public PaymentRequests(JdbcTemplate db, MerchantService merchants, AuditService audit) {
    this.db = db;
    this.merchants = merchants;
    this.audit = audit;
  }

  record Row(
      UUID id,
      UUID publicRef,
      UUID merchantId,
      UUID creatorId,
      String merchantName,
      long amount,
      String description,
      String status,
      Instant createdAt,
      Instant expiresAt) {}

  record Decision(Row request, Instant now) {}

  public record Checkout(
      UUID publicRef,
      String merchantName,
      String amount,
      String currency,
      String description,
      String status,
      Instant createdAt,
      Instant expiresAt) {}

  public record Detail(
      UUID id,
      UUID publicRef,
      String merchantName,
      String amount,
      String currency,
      String description,
      String status,
      Instant createdAt,
      Instant expiresAt,
      PaymentView payment) {}

  public record PaymentView(
      UUID id,
      UUID requestId,
      UUID requestRef,
      String amount,
      String currency,
      String payerName,
      Instant paidAt,
      UUID ledgerTransactionId) {}

  public record Page<T>(List<T> items, String nextCursor) {}

  public record Summary(
      long paidToday,
      String receivedToday,
      long pendingRequests,
      List<PaymentView> recentPayments) {}

  public record Capabilities(
      UUID environmentEpoch,
      String minAmount,
      String maxAmount,
      String currency,
      String fee,
      int descriptionMaxLength,
      int defaultExpiryMinutes,
      int minExpiryMinutes,
      int maxExpiryMinutes) {}

  @Transactional(readOnly = true)
  public Capabilities capabilities() {
    return new Capabilities(
        db.queryForObject("SELECT epoch FROM demo_environment", UUID.class),
        "1",
        "100000000",
        "VND",
        "0",
        140,
        30,
        5,
        1440);
  }

  @Transactional(timeout = 6)
  public Detail create(
      UUID actor, UUID merchant, UUID key, PaymentInput.Intent input, String correlation) {
    var owner = merchants.profile(actor, merchant);
    timeouts();
    String fingerprint =
        hash(input.amount() + "|VND|" + input.description() + "|" + input.minutes());
    var existing =
        db.query(
            "SELECT * FROM payment_requests WHERE merchant_id=? AND creation_key=?",
            this::row,
            merchant,
            key);
    if (existing.isEmpty()) {
      if (!owner.status().equals("ACTIVE")
          || !merchants.wallet(actor, merchant).status().equals("ACTIVE"))
        throw new ApiFailure(409, "MERCHANT_INACTIVE", "Doanh nghiệp hoặc ví đang bị khóa.");
      Instant now = now();
      UUID id = UUID.randomUUID();
      int n =
          db.update(
              "INSERT INTO payment_requests(id,public_ref,merchant_id,creator_id,merchant_name,amount,currency,description,creation_key,fingerprint,created_at,expires_at) VALUES(?,?,?,?,?,?,'VND',?,?,?,?,?) ON CONFLICT(merchant_id,creation_key) DO NOTHING",
              id,
              UUID.randomUUID(),
              merchant,
              actor,
              owner.displayName(),
              input.amount(),
              input.description(),
              key,
              fingerprint,
              java.sql.Timestamp.from(now),
              java.sql.Timestamp.from(now.plusSeconds(input.minutes() * 60L)));
      if (n == 1) audit.record(actor, "PAYMENT_REQUEST_CREATED", id, correlation);
    }
    String saved =
        db.queryForObject(
            "SELECT fingerprint FROM payment_requests WHERE merchant_id=? AND creation_key=?",
            String.class,
            merchant,
            key);
    if (!fingerprint.equals(saved))
      throw new ApiFailure(
          409, "IDEMPOTENCY_CONFLICT", "Mã tạo yêu cầu đã dùng cho nội dung khác.");
    return detail(
        db.queryForObject(
            "SELECT * FROM payment_requests WHERE merchant_id=? AND creation_key=?",
            this::row,
            merchant,
            key));
  }

  @Transactional(timeout = 6)
  public Detail byCreationKey(UUID actor, UUID merchant, UUID key, String correlation) {
    merchants.profile(actor, merchant);
    var ids =
        db.query(
            "SELECT id FROM payment_requests WHERE merchant_id=? AND creation_key=?",
            (r, n) -> r.getObject(1, UUID.class),
            merchant,
            key);
    if (ids.isEmpty())
      throw new ApiFailure(
          404,
          "REQUEST_NOT_OBSERVED",
          "Chưa quan sát được yêu cầu đã lưu; đây chưa phải kết luận thất bại.");
    return owned(actor, merchant, ids.getFirst(), correlation);
  }

  @Transactional(timeout = 6)
  public Checkout checkout(UUID ref, String correlation) {
    timeouts();
    return checkout(lock(ref, correlation).request());
  }

  @Transactional(timeout = 6)
  public Detail owned(UUID actor, UUID merchant, UUID id, String correlation) {
    merchants.profile(actor, merchant);
    timeouts();
    return detail(lock(ownedRef(merchant, id), correlation).request());
  }

  @Transactional(timeout = 6)
  public Detail cancel(UUID actor, UUID merchant, UUID id, String correlation) {
    merchants.profile(actor, merchant);
    timeouts();
    var decision = lock(ownedRef(merchant, id), correlation);
    var r = decision.request();
    if (r.status().equals("PENDING")) {
      db.update(
          "UPDATE payment_requests SET status='CANCELLED',state_changed_at=? WHERE id=?",
          java.sql.Timestamp.from(decision.now()),
          r.id());
      audit.record(actor, "PAYMENT_REQUEST_CANCELLED", r.id(), correlation);
      r = byRef(r.publicRef());
    }
    return detail(r);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  Decision lock(UUID ref, String correlation) {
    var rows =
        db.query("SELECT * FROM payment_requests WHERE public_ref=? FOR UPDATE", this::row, ref);
    if (rows.isEmpty()) throw missing();
    Row r = rows.getFirst();
    Instant now = now();
    if (r.status().equals("PENDING") && !now.isBefore(r.expiresAt())) {
      db.update(
          "UPDATE payment_requests SET status='EXPIRED',state_changed_at=? WHERE id=?",
          java.sql.Timestamp.from(now),
          r.id());
      audit.record(r.creatorId(), "PAYMENT_REQUEST_EXPIRED", r.id(), correlation);
      r = byRef(ref);
    }
    return new Decision(r, now);
  }

  @Transactional(timeout = 6)
  public Page<Detail> list(
      UUID actor, UUID merchant, int limit, String cursor, String status, String correlation) {
    merchants.profile(actor, merchant);
    timeouts();
    var window = window(limit, cursor);
    String filter = status == null ? "" : status;
    if (!Set.of("", "PENDING", "PAID", "CANCELLED", "EXPIRED").contains(filter)) throw invalid();
    var rows =
        db.query(
            "SELECT * FROM payment_requests WHERE merchant_id=? AND (?='' OR CASE WHEN status='PENDING' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE status END=?) AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?",
            this::row,
            merchant,
            filter,
            filter,
            java.sql.Timestamp.from(window.at()),
            window.id(),
            limit + 1);
    List<Detail> items = new ArrayList<>();
    for (var r : rows.subList(0, Math.min(limit, rows.size()))) {
      if (r.status().equals("PENDING") && !now().isBefore(r.expiresAt()))
        r = lock(r.publicRef(), correlation).request();
      items.add(detail(r));
    }
    return new Page<>(
        List.copyOf(items),
        rows.size() > limit
            ? cursor(rows.get(limit - 1).createdAt(), rows.get(limit - 1).id())
            : null);
  }

  @Transactional(readOnly = true)
  public Page<PaymentView> payments(UUID actor, UUID merchant, int limit, String cursor) {
    merchants.profile(actor, merchant);
    var window = window(limit, cursor);
    var rows =
        db.query(
            PAYMENTS
                + " WHERE p.merchant_id=? AND (p.created_at,p.id)<(?,?) ORDER BY p.created_at DESC,p.id DESC LIMIT ?",
            this::payment,
            merchant,
            java.sql.Timestamp.from(window.at()),
            window.id(),
            limit + 1);
    var items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
    return new Page<>(
        items, rows.size() > limit ? cursor(items.getLast().paidAt(), items.getLast().id()) : null);
  }

  @Transactional(readOnly = true)
  public Summary summary(UUID actor, UUID merchant) {
    merchants.profile(actor, merchant);
    var values =
        db.queryForMap(
            "SELECT count(*) AS n,coalesce(sum(amount::numeric),0)::text AS total FROM payments WHERE merchant_id=? AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
            merchant);
    long pending =
        db.queryForObject(
            "SELECT count(*) FROM payment_requests WHERE merchant_id=? AND status='PENDING' AND expires_at>clock_timestamp()",
            Long.class,
            merchant);
    return new Summary(
        ((Number) values.get("n")).longValue(),
        (String) values.get("total"),
        pending,
        payments(actor, merchant, 5, null).items());
  }

  private static final String PAYMENTS =
      "SELECT p.*,r.public_ref,a.payer_name FROM payments p JOIN payment_requests r ON r.id=p.request_id JOIN payment_attempts a ON a.id=p.attempt_id";

  private PaymentView payment(java.sql.ResultSet r, int n) throws java.sql.SQLException {
    return new PaymentView(
        r.getObject("id", UUID.class),
        r.getObject("request_id", UUID.class),
        r.getObject("public_ref", UUID.class),
        Long.toString(r.getLong("amount")),
        "VND",
        r.getString("payer_name"),
        r.getTimestamp("created_at").toInstant(),
        r.getObject("ledger_transaction_id", UUID.class));
  }

  private Detail detail(Row r) {
    var pay = db.query(PAYMENTS + " WHERE p.request_id=?", this::payment, r.id());
    return new Detail(
        r.id(),
        r.publicRef(),
        r.merchantName(),
        Long.toString(r.amount()),
        "VND",
        r.description(),
        r.status(),
        r.createdAt(),
        r.expiresAt(),
        pay.isEmpty() ? null : pay.getFirst());
  }

  private Checkout checkout(Row r) {
    return new Checkout(
        r.publicRef(),
        r.merchantName(),
        Long.toString(r.amount()),
        "VND",
        r.description(),
        r.status(),
        r.createdAt(),
        r.expiresAt());
  }

  private UUID ownedRef(UUID merchant, UUID id) {
    var refs =
        db.query(
            "SELECT public_ref FROM payment_requests WHERE id=? AND merchant_id=?",
            (r, n) -> r.getObject(1, UUID.class),
            id,
            merchant);
    if (refs.isEmpty()) throw missing();
    return refs.getFirst();
  }

  private Row byRef(UUID ref) {
    return db.queryForObject("SELECT * FROM payment_requests WHERE public_ref=?", this::row, ref);
  }

  private Row row(java.sql.ResultSet r, int n) throws java.sql.SQLException {
    return new Row(
        r.getObject("id", UUID.class),
        r.getObject("public_ref", UUID.class),
        r.getObject("merchant_id", UUID.class),
        r.getObject("creator_id", UUID.class),
        r.getString("merchant_name"),
        r.getLong("amount"),
        r.getString("description"),
        r.getString("status"),
        r.getTimestamp("created_at").toInstant(),
        r.getTimestamp("expires_at").toInstant());
  }

  private Instant now() {
    return db.queryForObject("SELECT clock_timestamp()", java.sql.Timestamp.class).toInstant();
  }

  private void timeouts() {
    db.execute("SET LOCAL lock_timeout='2s'");
    db.execute("SET LOCAL statement_timeout='5s'");
  }

  private record Window(Instant at, UUID id) {}

  private Window window(int limit, String raw) {
    if (limit < 1 || limit > 100) throw invalid();
    if (raw == null)
      return new Window(
          Instant.parse("9999-01-01T00:00:00Z"),
          UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff"));
    try {
      if (raw.length() > 200) throw new IllegalArgumentException();
      var parts =
          new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8).split("\\|", -1);
      if (parts.length != 2) throw new IllegalArgumentException();
      return new Window(Instant.parse(parts[0]), UUID.fromString(parts[1]));
    } catch (RuntimeException e) {
      throw invalid();
    }
  }

  private String cursor(Instant at, UUID id) {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString((at + "|" + id).getBytes(StandardCharsets.UTF_8));
  }

  static String hash(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static ApiFailure missing() {
    return new ApiFailure(404, "CHECKOUT_NOT_FOUND", "Không tìm thấy yêu cầu thanh toán.");
  }

  private static ApiFailure invalid() {
    return new ApiFailure(400, "INVALID_PAGE", "Bộ lọc hoặc con trỏ trang không hợp lệ.");
  }
}
