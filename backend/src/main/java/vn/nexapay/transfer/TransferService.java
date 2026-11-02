package vn.nexapay.transfer;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vn.nexapay.command.*;
import vn.nexapay.shared.ApiFailure;
import vn.nexapay.wallet.WalletService;

@Service
public class TransferService {
  private final TransferTransaction transaction;
  private final MoneyCommandExecutor executor;
  private final WalletService wallets;
  private final JdbcTemplate db;
  private final Clock clock;
  private final Map<UUID, Window> lookups = new HashMap<>();

  private record Window(Instant start, int count) {}

  public TransferService(
      TransferTransaction transaction,
      MoneyCommandExecutor executor,
      WalletService wallets,
      JdbcTemplate db,
      Clock clock) {
    this.transaction = transaction;
    this.executor = executor;
    this.wallets = wallets;
    this.db = db;
    this.clock = clock;
  }

  public CommandStore.Terminal send(
      UUID actor, UUID key, TransferInput.Intent intent, String correlation) {
    return executor.execute(actor, () -> transaction.execute(actor, key, intent, correlation));
  }

  public record Recipient(UUID walletId, String displayName) {}

  public Recipient recipient(UUID actor, UUID id) {
    throttleLookup(actor);
    var r =
        wallets
            .recipient(id)
            .orElseThrow(
                () -> new ApiFailure(404, "RECIPIENT_NOT_FOUND", "Không tìm thấy ví người nhận."));
    return new Recipient(r.walletId(), r.displayName());
  }

  private synchronized void throttleLookup(UUID actor) {
    Instant now = clock.instant();
    lookups.entrySet().removeIf(e -> !now.isBefore(e.getValue().start().plusSeconds(60)));
    var old = lookups.get(actor);
    if ((old != null && old.count() >= 30) || (old == null && lookups.size() >= 10000))
      throw new ApiFailure(
          429, "RECIPIENT_THROTTLED", "Vui lòng đợi một phút trước khi tra cứu thêm.");
    lookups.put(
        actor, new Window(old == null ? now : old.start(), old == null ? 1 : old.count() + 1));
  }

  public record Capabilities(
      UUID environmentEpoch,
      String minAmount,
      String maxAmount,
      String maxBalance,
      String fee,
      String currency,
      int noteMaxLength) {}

  @Transactional(readOnly = true)
  public Capabilities capabilities() {
    return new Capabilities(
        db.queryForObject("SELECT epoch FROM demo_environment", UUID.class),
        "1",
        "100000000",
        "1000000000000",
        "0",
        "VND",
        140);
  }
}
