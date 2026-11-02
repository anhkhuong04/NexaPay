package vn.nexapay.ledger;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.shared.ApiFailure;

@Service
public class LedgerAccounts {
  private final LedgerAccountRepository repository;

  public LedgerAccounts(LedgerAccountRepository repository) {
    this.repository = repository;
  }

  public record Snapshot(String status, long balance) {}

  @Transactional(propagation = Propagation.MANDATORY)
  public UUID openPersonal() {
    UUID id = UUID.randomUUID();
    repository.save(new LedgerAccount(id));
    return id;
  }

  @Transactional(readOnly = true)
  public Snapshot snapshot(UUID id) {
    LedgerAccount a =
        repository
            .findById(id)
            .orElseThrow(() -> new ApiFailure(404, "WALLET_NOT_FOUND", "Không tìm thấy ví."));
    return new Snapshot(a.status(), a.balance());
  }
}
