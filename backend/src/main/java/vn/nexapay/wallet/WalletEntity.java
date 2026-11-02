package vn.nexapay.wallet;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "wallets")
class WalletEntity {
  @Id private UUID id;
  private UUID userId;
  private UUID merchantId;
  private UUID ledgerAccountId;
  private String currency;

  @Column(insertable = false, updatable = false)
  private Instant createdAt;

  protected WalletEntity() {}

  WalletEntity(UUID user, UUID account) {
    id = UUID.randomUUID();
    userId = user;
    ledgerAccountId = account;
    currency = "VND";
  }

  static WalletEntity forMerchant(UUID merchant, UUID account) {
    WalletEntity wallet = new WalletEntity(null, account);
    wallet.merchantId = merchant;
    return wallet;
  }

  UUID id() {
    return id;
  }

  UUID user() {
    return userId;
  }

  UUID account() {
    return ledgerAccountId;
  }
}
