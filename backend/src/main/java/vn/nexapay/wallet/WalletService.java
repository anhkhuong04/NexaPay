package vn.nexapay.wallet;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.ledger.LedgerAccounts;
import vn.nexapay.shared.ApiFailure;

@Service
public class WalletService {
  private final WalletRepository repository;
  private final LedgerAccounts accounts;

  public WalletService(WalletRepository repository, LedgerAccounts accounts) {
    this.repository = repository;
    this.accounts = accounts;
  }

  public record Wallet(
      UUID id,
      String currency,
      String status,
      String availableBalance,
      String heldBalance,
      String totalBalance) {}

  @Transactional(propagation = Propagation.MANDATORY)
  public UUID openPersonal(UUID user) {
    WalletEntity wallet = new WalletEntity(user, accounts.openPersonal());
    repository.save(wallet);
    return wallet.id();
  }

  @Transactional(readOnly = true)
  public Wallet own(UUID user) {
    WalletEntity wallet =
        repository
            .findByUserId(user)
            .orElseThrow(() -> new ApiFailure(404, "WALLET_NOT_FOUND", "Không tìm thấy ví."));
    LedgerAccounts.Snapshot a = accounts.snapshot(wallet.account());
    String balance = Long.toString(a.balance());
    return new Wallet(wallet.id(), "VND", a.status(), balance, "0", balance);
  }
}
