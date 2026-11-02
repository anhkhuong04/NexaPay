package vn.nexapay.merchant;

import java.text.Normalizer;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.shared.ApiFailure;
import vn.nexapay.wallet.WalletService;

@Service
public class MerchantService {
  private final JdbcTemplate db;
  private final WalletService wallets;
  private final AuditService audit;

  public MerchantService(JdbcTemplate db, WalletService wallets, AuditService audit) {
    this.db = db;
    this.wallets = wallets;
    this.audit = audit;
  }

  public record Profile(
      UUID id, String displayName, String status, Instant createdAt, Instant updatedAt) {}

  @Transactional(readOnly = true)
  public Optional<UUID> membership(UUID actor) {
    return db
        .query(
            "SELECT merchant_id FROM merchant_memberships WHERE user_id=? AND role='OWNER'",
            (r, n) -> r.getObject(1, UUID.class),
            actor)
        .stream()
        .findFirst();
  }

  @Transactional(readOnly = true)
  public Profile own(UUID actor) {
    return profile(actor, membership(actor).orElseThrow(MerchantService::missing));
  }

  @Transactional(readOnly = true)
  public Profile profile(UUID actor, UUID merchant) {
    return db
        .query(
            "SELECT m.* FROM merchants m JOIN merchant_memberships mm ON mm.merchant_id=m.id WHERE m.id=? AND mm.user_id=? AND mm.role='OWNER'",
            (r, n) ->
                new Profile(
                    r.getObject("id", UUID.class),
                    r.getString("display_name"),
                    r.getString("status"),
                    r.getTimestamp("created_at").toInstant(),
                    r.getTimestamp("updated_at").toInstant()),
            merchant,
            actor)
        .stream()
        .findFirst()
        .orElseThrow(MerchantService::missing);
  }

  @Transactional(readOnly = true)
  public WalletService.Wallet wallet(UUID actor, UUID merchant) {
    profile(actor, merchant);
    return wallets.merchant(merchant);
  }

  @Transactional(timeout = 6)
  public Profile onboard(UUID actor, String name, String correlation) {
    String validated = validateName(name);
    db.execute("SET LOCAL lock_timeout='2s'");
    // Serialize only this actor's onboarding, before any merchant graph exists.
    // Hash collisions serialize independent actors safely; uniqueness remains a DB invariant.
    db.queryForList(
        "SELECT pg_advisory_xact_lock(hashtextextended(?::text, 71001))", actor.toString());
    if (membership(actor).isPresent())
      throw new ApiFailure(
          409, "MERCHANT_EXISTS", "Bạn đã có merchant. Hãy tải lại thông tin doanh nghiệp.");
    UUID id = UUID.randomUUID();
    db.update("INSERT INTO merchants(id,display_name) VALUES(?,?)", id, validated);
    db.update("INSERT INTO merchant_memberships(merchant_id,user_id) VALUES(?,?)", id, actor);
    wallets.openMerchant(id);
    audit.record(actor, "MERCHANT_ONBOARDED", id, correlation);
    return profile(actor, id);
  }

  @Transactional
  public Profile rename(UUID actor, UUID merchant, String name, String correlation) {
    profile(actor, merchant);
    String validated = validateName(name);
    db.update(
        "UPDATE merchants SET display_name=?,updated_at=clock_timestamp() WHERE id=?",
        validated,
        merchant);
    audit.record(actor, "MERCHANT_RENAMED", merchant, correlation);
    return profile(actor, merchant);
  }

  public static String validateName(String value) {
    String raw = value == null ? "" : value;
    if (raw.codePoints().anyMatch(Character::isISOControl)) throw invalid();
    String n = Normalizer.normalize(raw.strip(), Normalizer.Form.NFC);
    if (n.isEmpty() || n.codePointCount(0, n.length()) > 80) throw invalid();
    return n;
  }

  private static ApiFailure invalid() {
    return new ApiFailure(
        400,
        "VALIDATION_ERROR",
        "Tên doanh nghiệp cần 1–80 ký tự, không chứa ký tự điều khiển.",
        Map.of("displayName", "Tên doanh nghiệp không hợp lệ"));
  }

  private static ApiFailure missing() {
    return new ApiFailure(404, "MERCHANT_NOT_FOUND", "Không tìm thấy doanh nghiệp.");
  }
}
