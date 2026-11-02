package vn.nexapay.refund;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vn.nexapay.merchant.MerchantService;
import vn.nexapay.shared.ApiFailure;

@Service
public class RefundQueries {
  private final JdbcTemplate db;
  private final MerchantService merchants;

  public RefundQueries(JdbcTemplate db, MerchantService merchants) {
    this.db = db;
    this.merchants = merchants;
  }

  public record View(
      UUID id,
      UUID paymentId,
      String amount,
      String currency,
      String note,
      String payerName,
      String status,
      UUID ledgerTransactionId,
      String errorCode,
      Instant createdAt) {}

  public record Page(List<View> items, String nextCursor) {}

  private View row(java.sql.ResultSet r, int n) throws java.sql.SQLException {
    return new View(
        r.getObject("id", UUID.class),
        r.getObject("payment_id", UUID.class),
        Long.toString(r.getLong("amount")),
        "VND",
        r.getString("note"),
        r.getString("payer_name"),
        r.getString("status"),
        r.getObject("ledger_transaction_id", UUID.class),
        r.getString("error_code"),
        r.getTimestamp("created_at").toInstant());
  }

  @Transactional(readOnly = true)
  public View detail(UUID actor, UUID merchant, UUID id) {
    merchants.profile(actor, merchant);
    var rows =
        db.query("SELECT * FROM refunds WHERE id=? AND merchant_id=?", this::row, id, merchant);
    if (rows.isEmpty()) throw new ApiFailure(404, "REFUND_NOT_FOUND", "Không tìm thấy hoàn tiền.");
    return rows.getFirst();
  }

  @Transactional(readOnly = true)
  public Page list(UUID actor, UUID merchant, int limit, String raw, String status, UUID payment) {
    merchants.profile(actor, merchant);
    String filter = status == null ? "" : status;
    if (limit < 1 || limit > 100 || !Set.of("", "SUCCEEDED", "FAILED").contains(filter))
      throw invalid();
    Instant at = Instant.parse("9999-01-01T00:00:00Z");
    UUID id = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");
    if (raw != null)
      try {
        if (raw.length() > 200) throw new IllegalArgumentException();
        var parts =
            new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8).split("\\|", -1);
        if (parts.length != 2) throw new IllegalArgumentException();
        at = Instant.parse(parts[0]);
        id = UUID.fromString(parts[1]);
        if (at.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
            || !at.isBefore(Instant.parse("9999-01-01T00:00:00Z")))
          throw new IllegalArgumentException();
      } catch (RuntimeException e) {
        throw invalid();
      }
    var rows =
        db.query(
            "SELECT * FROM refunds WHERE merchant_id=? AND (?='' OR status=?) AND (?::uuid IS NULL OR payment_id=?) AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?",
            this::row,
            merchant,
            filter,
            filter,
            payment,
            payment,
            java.sql.Timestamp.from(at),
            id,
            limit + 1);
    var items = List.copyOf(rows.subList(0, Math.min(limit, rows.size())));
    String next = null;
    if (rows.size() > limit) {
      var last = items.getLast();
      next =
          Base64.getUrlEncoder()
              .withoutPadding()
              .encodeToString(
                  (last.createdAt() + "|" + last.id()).getBytes(StandardCharsets.UTF_8));
    }
    return new Page(items, next);
  }

  private ApiFailure invalid() {
    return new ApiFailure(400, "INVALID_PAGE", "Bộ lọc hoặc con trỏ trang không hợp lệ.");
  }
}
