package vn.nexapay.transfer;

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
import vn.nexapay.wallet.WalletService;

@Service
public class TransferTransaction {
  private final JdbcTemplate db;
  private final CommandStore commands;
  private final MoneyPostingService posting;
  private final WalletService wallets;
  private final AuditService audit;
  private final Clock clock;

  public TransferTransaction(
      JdbcTemplate db,
      CommandStore commands,
      MoneyPostingService posting,
      WalletService wallets,
      AuditService audit,
      Clock clock) {
    this.db = db;
    this.commands = commands;
    this.posting = posting;
    this.wallets = wallets;
    this.audit = audit;
    this.clock = clock;
  }

  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 6)
  public CommandStore.Terminal execute(
      UUID actor, UUID key, TransferInput.Intent intent, String correlation) {
    db.execute("SET LOCAL lock_timeout='2s'");
    db.execute("SET LOCAL statement_timeout='5s'");
    var source = wallets.reference(actor);
    Instant now = clock.instant();
    var claim =
        commands.claim(
            actor,
            "TRANSFER",
            key,
            fingerprint(
                source.accountId()
                    + "|"
                    + intent.destination()
                    + "|"
                    + intent.amount()
                    + "|VND|"
                    + intent.note()),
            now);
    if (claim.replay() != null) return claim.replay();
    var recipient = wallets.recipient(intent.destination()).orElse(null);
    String error = null;
    if (source.walletId().equals(intent.destination())) error = "SELF_TRANSFER";
    else if (recipient == null) error = "RECIPIENT_NOT_FOUND";
    else {
      var locked = posting.lock(List.of(source.accountId(), recipient.accountId()));
      var from = locked.get(source.accountId());
      var to = locked.get(recipient.accountId());
      if (!from.type().equals("PERSONAL") || !to.type().equals("PERSONAL"))
        throw new IllegalStateException("Invalid personal account graph");
      if (!from.status().equals("ACTIVE") || !to.status().equals("ACTIVE")) error = "WALLET_LOCKED";
      else if (from.balance() < intent.amount()) error = "INSUFFICIENT_FUNDS";
      else if (to.balance() > vn.nexapay.ledger.AccountLimits.CUSTOMER_MAX - intent.amount())
        error = "BALANCE_LIMIT_EXCEEDED";
    }
    UUID resource = UUID.randomUUID(), journal = null;
    if (error == null)
      journal =
          posting.post(
              "TRANSFER",
              resource,
              List.of(
                  new MoneyPostingService.Entry(source.accountId(), -intent.amount()),
                  new MoneyPostingService.Entry(recipient.accountId(), intent.amount())));
    String status = error == null ? "SUCCEEDED" : "FAILED";
    String senderName = wallets.recipient(source.walletId()).orElseThrow().displayName();
    String recipientName = recipient == null ? "" : recipient.displayName();
    db.update(
        "INSERT INTO transfers(id,command_id,actor_id,source_wallet_id,source_account_id,destination_wallet_id,destination_account_id,sender_name,recipient_name,amount,currency,note,status,ledger_transaction_id,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'VND',?,?,?,?,?)",
        resource,
        claim.id(),
        actor,
        source.walletId(),
        source.accountId(),
        intent.destination(),
        recipient == null ? null : recipient.accountId(),
        senderName,
        recipientName,
        intent.amount(),
        intent.note(),
        status,
        journal,
        error,
        java.sql.Timestamp.from(now));
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("amount", Long.toString(intent.amount()));
    result.put("currency", "VND");
    result.put("fee", "0");
    result.put("sourceWalletId", source.walletId().toString());
    result.put("destinationWalletId", intent.destination().toString());
    result.put("recipientName", recipientName);
    result.put("note", intent.note());
    if (journal != null) result.put("ledgerTransactionId", journal.toString());
    var terminal =
        new CommandStore.Terminal(
            key,
            "TRANSFER",
            resource,
            status,
            error == null ? 201 : 422,
            now,
            result,
            error == null ? Map.of() : Map.of("code", error, "message", message(error)));
    commands.finish(claim.id(), terminal);
    audit.money(actor, "TRANSFER", resource, status, correlation);
    return terminal;
  }

  private String fingerprint(String text) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private String message(String code) {
    return switch (code) {
      case "SELF_TRANSFER" -> "Không thể chuyển tiền cho chính ví của bạn.";
      case "RECIPIENT_NOT_FOUND" -> "Không tìm thấy ví người nhận.";
      case "WALLET_LOCKED" -> "Ví gửi hoặc ví nhận đang bị khóa.";
      case "INSUFFICIENT_FUNDS" -> "Số dư không đủ để chuyển tiền.";
      default -> "Số dư người nhận sẽ vượt giới hạn cho phép.";
    };
  }
}
