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
  private final vn.nexapay.profile.ProfileService profiles;

  public WalletService(
      WalletRepository repository,
      LedgerAccounts accounts,
      vn.nexapay.profile.ProfileService profiles) {
    this.repository = repository;
    this.accounts = accounts;
    this.profiles = profiles;
  }

  public record Wallet(
      UUID id,
      String currency,
      String status,
      String availableBalance,
      String heldBalance,
      String totalBalance) {}

  public record Reference(UUID walletId, UUID accountId) {}

  public record Recipient(UUID walletId, UUID accountId, String displayName) {}

  @Transactional(readOnly = true)
  public java.util.Optional<Recipient> recipient(UUID id) {
    return repository
        .findById(id)
        .filter(w -> w.user() != null)
        .map(w -> new Recipient(w.id(), w.account(), profiles.name(w.user())));
  }

  @Transactional(readOnly = true)
  public Reference reference(UUID user) {
    WalletEntity wallet =
        repository
            .findByUserId(user)
            .orElseThrow(() -> new ApiFailure(404, "WALLET_NOT_FOUND", "Không tìm thấy ví."));
    return new Reference(wallet.id(), wallet.account());
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public UUID openPersonal(UUID user) {
    WalletEntity wallet = new WalletEntity(user, accounts.openPersonal());
    repository.save(wallet);
    return wallet.id();
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public UUID openMerchant(UUID merchant) {
    WalletEntity wallet = WalletEntity.forMerchant(merchant, accounts.openMerchant());
    repository.saveAndFlush(wallet);
    return wallet.id();
  }

  /** Caller must authorize the merchant membership before this module query. */
  @Transactional(readOnly = true)
  public Wallet merchant(UUID merchant) {
    WalletEntity wallet =
        repository
            .findByMerchantId(merchant)
            .orElseThrow(() -> new ApiFailure(404, "WALLET_NOT_FOUND", "Không tìm thấy ví."));
    return snapshot(wallet);
  }

  private Wallet snapshot(WalletEntity wallet) {
    LedgerAccounts.Snapshot a = accounts.snapshot(wallet.account());
    String balance = Long.toString(a.balance());
    return new Wallet(wallet.id(), "VND", a.status(), balance, "0", balance);
  }

  /** Merchant caller authorizes membership or immutable request before resolving this reference. */
  @Transactional(readOnly = true)
  public Reference merchantReference(UUID merchant) {
    WalletEntity wallet =
        repository
            .findByMerchantId(merchant)
            .orElseThrow(() -> new ApiFailure(404, "WALLET_NOT_FOUND", "Không tìm thấy ví."));
    return new Reference(wallet.id(), wallet.account());
  }

  @Transactional(readOnly = true)
  public Wallet own(UUID user) {
    WalletEntity wallet =
        repository
            .findByUserId(user)
            .orElseThrow(() -> new ApiFailure(404, "WALLET_NOT_FOUND", "Không tìm thấy ví."));
    return snapshot(wallet);
  }
}
