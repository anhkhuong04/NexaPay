package vn.nexapay.funding;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.command.CommandStore;
import vn.nexapay.ledger.MoneyPostingService;
import vn.nexapay.shared.ApiFailure;
import vn.nexapay.wallet.WalletService;

@Service
public class FundingTransaction {
  private final JdbcTemplate db;
  private final CommandStore commands;
  private final FundingQuota quota;
  private final MoneyPostingService posting;
  private final WalletService wallets;
  private final FundingPolicy policy;
  private final AuditService audit;
  private final Clock clock;

  public FundingTransaction(
      JdbcTemplate db,
      CommandStore commands,
      FundingQuota quota,
      MoneyPostingService posting,
      WalletService wallets,
      FundingPolicy policy,
      AuditService audit,
      Clock clock) {
    this.db = db;
    this.commands = commands;
    this.quota = quota;
    this.posting = posting;
    this.wallets = wallets;
    this.policy = policy;
    this.audit = audit;
    this.clock = clock;
  }

  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 6)
  public CommandStore.Terminal execute(UUID actor, UUID key, String correlation) {
    db.execute("SET LOCAL lock_timeout='2s'");
    db.execute("SET LOCAL statement_timeout='5s'");
    var wallet = wallets.reference(actor);
    Instant now = clock.instant();
    String fingerprint = fingerprint(actor + "|DEMO_FUNDING|" + wallet.accountId() + "|100000|VND");
    var claim = commands.claim(actor, "DEMO_FUNDING", key, fingerprint, now);
    if (claim.replay() != null) return claim.replay();
    if (!policy.enabled())
      throw new ApiFailure(403, "FUNDING_DISABLED", "Tính năng cấp tiền demo đang tắt.");
    var env = quota.environment();
    LocalDate day = now.atOffset(ZoneOffset.UTC).toLocalDate();
    String error = quota.lockAndCheck(actor, env, day);
    var accounts = posting.lock(List.of(env.issuance(), wallet.accountId()));
    var personal = accounts.get(wallet.accountId());
    if (!personal.type().equals("PERSONAL")
        || !accounts.get(env.issuance()).type().equals("DEMO_ISSUANCE"))
      throw new IllegalStateException("Invalid funding account graph");
    if (!personal.status().equals("ACTIVE")) error = "WALLET_LOCKED";
    else if (personal.balance() > 1000000000000L - FundingPolicy.PRESET)
      error = "BALANCE_LIMIT_EXCEEDED";
    UUID resource = UUID.randomUUID(), journal = null;
    if (error == null) {
      journal =
          posting.post(
              "DEMO_FUNDING",
              resource,
              List.of(
                  new MoneyPostingService.Entry(env.issuance(), -FundingPolicy.PRESET),
                  new MoneyPostingService.Entry(wallet.accountId(), FundingPolicy.PRESET)));
      quota.consume(actor, env, day);
    }
    String status = error == null ? "SUCCEEDED" : "FAILED";
    db.update(
        "INSERT INTO demo_fundings(id,command_id,actor_id,account_id,amount,currency,status,ledger_transaction_id,error_code,created_at) VALUES(?,?,?,?,?,'VND',?,?,?,?)",
        resource,
        claim.id(),
        actor,
        wallet.accountId(),
        FundingPolicy.PRESET,
        status,
        journal,
        error,
        java.sql.Timestamp.from(now));
    var result =
        new CommandStore.Terminal(
            key,
            "DEMO_FUNDING",
            resource,
            status,
            error == null ? 201 : 422,
            now,
            error == null
                ? Map.of(
                    "amount",
                    "100000",
                    "currency",
                    "VND",
                    "walletId",
                    wallet.walletId().toString(),
                    "ledgerTransactionId",
                    journal.toString())
                : Map.of(),
            error == null ? Map.of() : Map.of("code", error, "message", message(error)));
    commands.finish(claim.id(), result);
    audit.money(actor, resource, status, correlation);
    return result;
  }

  private static String fingerprint(String value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private String message(String code) {
    return switch (code) {
      case "WALLET_LOCKED" -> "Ví đang bị khóa. Không thể nhận tiền demo mới.";
      case "USER_QUOTA_EXCEEDED" -> "Bạn đã dùng hết hạn mức cấp tiền demo hôm nay.";
      case "ENVIRONMENT_QUOTA_EXCEEDED" -> "Môi trường demo đã dùng hết hạn mức hôm nay.";
      default -> "Số dư ví sẽ vượt giới hạn cho phép.";
    };
  }
}
