package vn.nexapay.ledger;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "ledger_accounts")
class LedgerAccount {
  @Id private UUID id;
  private String accountType;
  private String currency;
  private String status;

  @Column(insertable = false, updatable = false)
  private long postedBalance;

  @Column(insertable = false, updatable = false)
  private Instant createdAt;

  protected LedgerAccount() {}

  LedgerAccount(UUID id) {
    this.id = id;
    accountType = "PERSONAL";
    currency = "VND";
    status = "ACTIVE";
  }

  UUID id() {
    return id;
  }

  String status() {
    return status;
  }

  long balance() {
    return postedBalance;
  }
}
