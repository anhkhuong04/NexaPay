package vn.nexapay.history;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vn.nexapay.shared.ApiFailure;

@Service
public class HistoryService {
  private final JdbcTemplate db;

  public HistoryService(JdbcTemplate db) {
    this.db = db;
  }

  // Read model joins feature tables; writes remain behind their application APIs.
  private static final String OWNED =
      """
  WITH owned AS (
   SELECT x.id,'TRANSFER' AS operation_type,x.actor_id AS viewer_id,'OUTGOING' AS direction,
    x.status,x.amount,x.currency,x.source_wallet_id,x.destination_wallet_id,x.sender_name,x.recipient_name,x.note,x.ledger_transaction_id,x.error_code,x.created_at FROM transfers x
   UNION ALL
   SELECT x.id,'TRANSFER',w.user_id,'INCOMING',x.status,x.amount,x.currency,x.source_wallet_id,x.destination_wallet_id,x.sender_name,x.recipient_name,x.note,x.ledger_transaction_id,x.error_code,x.created_at
    FROM transfers x JOIN wallets w ON w.id=x.destination_wallet_id WHERE x.status='SUCCEEDED'
   UNION ALL
   SELECT f.id,'DEMO_FUNDING',f.actor_id,'FUNDING',f.status,f.amount,f.currency,NULL::uuid,w.id,'',p.display_name,'',f.ledger_transaction_id,f.error_code,f.created_at
    FROM demo_fundings f JOIN wallets w ON w.ledger_account_id=f.account_id JOIN profiles p ON p.user_id=f.actor_id
   UNION ALL
   SELECT a.id,'PAYMENT',a.actor_id,'OUTGOING',a.status,a.amount,r.currency,a.source_wallet_id,a.destination_wallet_id,a.payer_name,r.merchant_name,r.description,p.ledger_transaction_id,a.error_code,a.created_at
    FROM payment_attempts a JOIN payment_requests r ON r.id=a.request_id LEFT JOIN payments p ON p.attempt_id=a.id
  ) SELECT * FROM owned WHERE viewer_id=?
  """;

  public record Transaction(
      UUID id,
      String operationType,
      String direction,
      String status,
      String amount,
      String currency,
      String fee,
      UUID sourceWalletId,
      UUID destinationWalletId,
      String senderName,
      String recipientName,
      String note,
      UUID ledgerTransactionId,
      String errorCode,
      Instant createdAt) {}

  public record Page(List<Transaction> items, String nextCursor) {}

  private Transaction row(java.sql.ResultSet r, int n) throws java.sql.SQLException {
    return new Transaction(
        r.getObject("id", UUID.class),
        r.getString("operation_type"),
        r.getString("direction"),
        r.getString("status"),
        Long.toString(r.getLong("amount")),
        r.getString("currency"),
        "0",
        r.getObject("source_wallet_id", UUID.class),
        r.getObject("destination_wallet_id", UUID.class),
        r.getString("sender_name"),
        r.getString("recipient_name"),
        r.getString("note"),
        r.getObject("ledger_transaction_id", UUID.class),
        r.getString("error_code"),
        r.getTimestamp("created_at").toInstant());
  }

  @Transactional(readOnly = true)
  public Transaction detail(UUID actor, String type, UUID id) {
    if (!Set.of("TRANSFER", "DEMO_FUNDING", "PAYMENT").contains(type)) throw missing();
    var rows = db.query(OWNED + " AND operation_type=? AND id=?", this::row, actor, type, id);
    if (rows.isEmpty()) throw missing();
    return rows.getFirst();
  }

  @Transactional(readOnly = true)
  public Page list(
      UUID actor, int limit, String cursor, String type, String status, String from, String to) {
    if (limit < 1 || limit > 100) throw invalid("INVALID_PAGE");
    type = type == null ? "" : type;
    status = status == null ? "" : status;
    if (!Set.of("", "INCOMING", "OUTGOING", "FUNDING").contains(type)
        || !Set.of("", "SUCCEEDED", "FAILED").contains(status)) throw invalid("INVALID_FILTER");
    Instant start = parse(from, Instant.parse("0001-01-01T00:00:00Z")),
        end = parse(to, Instant.parse("9999-01-01T00:00:00Z"));
    if (!start.isBefore(end)) throw invalid("INVALID_FILTER");
    Instant at = Instant.parse("9999-01-01T00:00:00Z");
    UUID id = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");
    if (cursor != null)
      try {
        if (cursor.length() > 200) throw new IllegalArgumentException();
        String[] parts =
            new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                .split("\\|", -1);
        if (parts.length != 2) throw new IllegalArgumentException();
        at = parse(parts[0], null);
        id = UUID.fromString(parts[1]);
      } catch (IllegalArgumentException e) {
        throw invalid("INVALID_CURSOR");
      }
    var rows =
        db.query(
            OWNED
                + " AND (?='' OR direction=?) AND (?='' OR status=?) AND created_at>=? AND created_at<? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?",
            this::row,
            actor,
            type,
            type,
            status,
            status,
            java.sql.Timestamp.from(start),
            java.sql.Timestamp.from(end),
            java.sql.Timestamp.from(at),
            id,
            limit + 1);
    var items = rows.subList(0, Math.min(limit, rows.size()));
    String next = null;
    if (rows.size() > limit) {
      var last = items.getLast();
      next =
          Base64.getUrlEncoder()
              .withoutPadding()
              .encodeToString(
                  (last.createdAt() + "|" + last.id()).getBytes(StandardCharsets.UTF_8));
    }
    return new Page(List.copyOf(items), next);
  }

  private Instant parse(String text, Instant fallback) {
    if (text == null) return fallback;
    try {
      var value = Instant.parse(text);
      if (value.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
          || !value.isBefore(Instant.parse("9999-01-01T00:00:00Z")))
        throw new IllegalArgumentException();
      return value;
    } catch (java.time.format.DateTimeParseException | IllegalArgumentException e) {
      throw invalid("INVALID_FILTER");
    }
  }

  private ApiFailure invalid(String code) {
    return new ApiFailure(400, code, "Bộ lọc hoặc con trỏ trang không hợp lệ.");
  }

  private ApiFailure missing() {
    return new ApiFailure(404, "TRANSACTION_NOT_FOUND", "Không tìm thấy giao dịch.");
  }
}
