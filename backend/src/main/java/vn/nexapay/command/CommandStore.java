package vn.nexapay.command;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.shared.ApiFailure;

@Service
public class CommandStore {
  private final JdbcTemplate db;
  private final ObjectMapper json;

  public CommandStore(JdbcTemplate db, ObjectMapper json) {
    this.db = db;
    this.json = json;
  }

  public record Terminal(
      UUID key,
      String operationType,
      UUID resourceId,
      String status,
      int originalHttpStatus,
      Instant createdAt,
      Map<String, Object> result,
      Map<String, String> error) {
    @Override
    public String toString() {
      return "Terminal[resourceId=" + resourceId + ", status=" + status + "]";
    }
  }

  public record Claim(UUID id, Terminal replay) {}

  public record Page(List<Terminal> items, String nextCursor) {}

  @Transactional(propagation = Propagation.MANDATORY)
  public Claim claim(UUID actor, String type, UUID key, String fingerprint, Instant now) {
    UUID id = UUID.randomUUID();
    int inserted =
        db.update(
            "INSERT INTO money_commands(id,actor_id,operation_type,command_key,fingerprint,status,created_at) VALUES(?,?,?,?,?,'IN_PROGRESS',?) ON CONFLICT(actor_id,operation_type,command_key) DO NOTHING",
            id,
            actor,
            type,
            key,
            fingerprint,
            java.sql.Timestamp.from(now));
    if (inserted == 1) return new Claim(id, null);
    return db.queryForObject(
        "SELECT id,fingerprint,payload::text FROM money_commands WHERE actor_id=? AND operation_type=? AND command_key=?",
        (r, n) -> {
          if (!r.getString("fingerprint").equals(fingerprint))
            throw new ApiFailure(
                409, "IDEMPOTENCY_CONFLICT", "Mã thao tác đã dùng cho một nội dung khác.");
          return new Claim(r.getObject("id", UUID.class), decode(r.getString("payload")));
        },
        actor,
        type,
        key);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void finish(UUID id, Terminal value) {
    try {
      db.update(
          "UPDATE money_commands SET resource_id=?,status=?,http_status=?,payload=?::jsonb WHERE id=?",
          value.resourceId(),
          value.status(),
          value.originalHttpStatus(),
          json.writeValueAsString(value),
          id);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException("Cannot serialize terminal command", e);
    }
  }

  @Transactional(readOnly = true)
  public Terminal lookup(UUID actor, String type, UUID key) {
    var results =
        db.query(
            "SELECT payload::text FROM money_commands WHERE actor_id=? AND operation_type=? AND command_key=?",
            (r, n) -> decode(r.getString(1)),
            actor,
            type,
            key);
    if (results.isEmpty())
      throw new ApiFailure(
          404,
          "COMMAND_NOT_OBSERVED",
          "Chưa quan sát được kết quả đã lưu. Đây chưa phải kết luận thất bại.");
    return results.getFirst();
  }

  @Transactional(readOnly = true)
  public Page recent(UUID actor, int limit, String cursor) {
    if (limit < 1 || limit > 100)
      throw new ApiFailure(400, "INVALID_PAGE", "Số dòng từ 1 đến 100.");
    Instant at = Instant.parse("9999-01-01T00:00:00Z");
    UUID id = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");
    if (cursor != null)
      try {
        if (cursor.length() > 200) throw new IllegalArgumentException();
        String[] parts =
            new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8)
                .split("\\|", -1);
        if (parts.length != 2) throw new IllegalArgumentException();
        at = Instant.parse(parts[0]);
        id = UUID.fromString(parts[1]);
      } catch (IllegalArgumentException | java.time.format.DateTimeParseException e) {
        throw new ApiFailure(400, "INVALID_CURSOR", "Con trỏ trang không hợp lệ.");
      }
    var rows =
        db.query(
            "SELECT id,created_at,payload::text FROM money_commands WHERE actor_id=? AND (created_at,id)<(?,?) ORDER BY created_at DESC,id DESC LIMIT ?",
            (r, n) ->
                new Row(
                    r.getObject("id", UUID.class),
                    r.getTimestamp("created_at").toInstant(),
                    decode(r.getString("payload"))),
            actor,
            java.sql.Timestamp.from(at),
            id,
            limit + 1);
    boolean more = rows.size() > limit;
    var page = rows.subList(0, Math.min(rows.size(), limit));
    String next = null;
    if (more) {
      var last = page.getLast();
      next =
          Base64.getUrlEncoder()
              .withoutPadding()
              .encodeToString((last.at() + "|" + last.id()).getBytes(StandardCharsets.UTF_8));
    }
    return new Page(page.stream().map(Row::value).toList(), next);
  }

  private record Row(UUID id, Instant at, Terminal value) {}

  private Terminal decode(String value) {
    try {
      return json.readValue(value, Terminal.class);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException("Invalid stored terminal command", e);
    }
  }
}
