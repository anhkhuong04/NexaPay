package vn.nexapay.identity;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vn.nexapay.audit.AuditService;
import vn.nexapay.profile.ProfileService;
import vn.nexapay.wallet.WalletService;

@Service
public class RegistrationTransaction {
  private final UserRepository users;
  private final ProfileService profiles;
  private final WalletService wallets;
  private final AuditService audit;

  public RegistrationTransaction(
      UserRepository users, ProfileService profiles, WalletService wallets, AuditService audit) {
    this.users = users;
    this.profiles = profiles;
    this.wallets = wallets;
    this.audit = audit;
  }

  public record Created(UUID userId, UUID walletId) {}

  @Transactional
  public Created create(String email, String hash, String name, String correlation) {
    UUID id = UUID.randomUUID();
    users.saveAndFlush(new UserEntity(id, email, hash));
    profiles.create(id, name);
    UUID wallet = wallets.openPersonal(id);
    audit.record(id, "USER_REGISTERED", id, correlation);
    return new Created(id, wallet);
  }
}
