package vn.nexapay.funding;

import java.util.UUID;
import org.springframework.stereotype.Service;
import vn.nexapay.command.*;

@Service
public class FundingService {
  private final FundingTransaction transaction;
  private final MoneyCommandExecutor executor;

  public FundingService(FundingTransaction transaction, MoneyCommandExecutor executor) {
    this.transaction = transaction;
    this.executor = executor;
  }

  public CommandStore.Terminal fund(UUID actor, UUID key, String correlation) {
    return executor.execute(actor, () -> transaction.execute(actor, key, correlation));
  }
}
