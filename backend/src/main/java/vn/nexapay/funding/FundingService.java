package vn.nexapay.funding;

import java.sql.SQLException;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Service;
import vn.nexapay.command.CommandStore;
import vn.nexapay.shared.ApiFailure;

@Service
public class FundingService {
  private final FundingTransaction transaction;
  private final Clock clock;
  private final Map<UUID, Bucket> windows = new HashMap<>();

  private record Bucket(Instant start, int count) {}

  public FundingService(FundingTransaction transaction, Clock clock) {
    this.transaction = transaction;
    this.clock = clock;
  }

  private synchronized void throttle(UUID actor) {
    Instant now = clock.instant();
    windows.entrySet().removeIf(e -> !now.isBefore(e.getValue().start().plusSeconds(60)));
    Bucket bucket = windows.get(actor);
    if (bucket != null && bucket.count() >= 30)
      throw new ApiFailure(
          429, "COMMAND_THROTTLED", "Vui lòng đợi một phút trước khi gửi thêm thao tác.");
    if (bucket == null && windows.size() >= 10000)
      throw new ApiFailure(429, "COMMAND_THROTTLED", "Hệ thống đang bận. Vui lòng thử lại sau.");
    windows.put(
        actor,
        new Bucket(bucket == null ? now : bucket.start(), bucket == null ? 1 : bucket.count() + 1));
  }

  public CommandStore.Terminal fund(UUID actor, UUID key, String correlation) {
    throttle(actor);
    long deadline = System.nanoTime() + 20_000_000_000L;
    for (int attempt = 0; ; attempt++) {
      try {
        return transaction.execute(actor, key, correlation);
      } catch (RuntimeException e) {
        String state = sqlState(e);
        boolean rollbackConfirmed = Set.of("40P01", "55P03", "57014", "40001").contains(state);
        if (rollbackConfirmed) {
          if (attempt < 2 && System.nanoTime() < deadline - 6_000_000_000L) continue;
          throw new ApiFailure(
              503,
              "COMMAND_RETRYABLE",
              "Thao tác đã rollback do hệ thống bận. Kiểm tra kết quả và thử lại đúng mã thao tác.");
        }
        if (state.startsWith("08")
            || e instanceof org.springframework.transaction.TransactionSystemException)
          throw new ApiFailure(
              503,
              "COMMAND_UNRESOLVED",
              "Chưa xác định được kết quả. Giữ mã thao tác và kiểm tra kết quả trước khi thử lại.");
        throw e;
      }
    }
  }

  private String sqlState(Throwable error) {
    for (Throwable e = error; e != null; e = e.getCause())
      if (e instanceof SQLException sql && sql.getSQLState() != null) return sql.getSQLState();
    return "";
  }
}
