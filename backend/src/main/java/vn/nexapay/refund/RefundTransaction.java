package vn.nexapay.refund;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Clock;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.command.CommandStore;
import vn.nexapay.ledger.*;
import vn.nexapay.merchant.MerchantService;
import vn.nexapay.payment.PaymentRequests;

@Service
public class RefundTransaction {
  private final JdbcTemplate db;
  private final MerchantService merchants;
  private final PaymentRequests payments;
  private final CommandStore commands;
  private final MoneyPostingService posting;
  private final AuditService audit;
  private final Clock clock;

  public RefundTransaction(
      JdbcTemplate db,
      MerchantService merchants,
      PaymentRequests payments,
      CommandStore commands,
      MoneyPostingService posting,
      AuditService audit,
      Clock clock) {
    this.db = db;
    this.merchants = merchants;
    this.payments = payments;
    this.commands = commands;
    this.posting = posting;
    this.audit = audit;
    this.clock = clock;
  }

  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 6)
  public CommandStore.Terminal execute(
      UUID actor,
      UUID merchant,
      UUID payment,
      UUID key,
      RefundInput.Intent input,
      String correlation) {
    db.execute("SET LOCAL lock_timeout='2s'");
    db.execute("SET LOCAL statement_timeout='5s'");
    var owner = merchants.profile(actor, merchant);
    var claim =
        commands.claim(
            actor,
            "REFUND",
            key,
            hash(merchant + "|" + payment + "|" + input.amount() + "|VND|" + input.note()),
            clock.instant());
    if (claim.replay() != null) return claim.replay();
    var p = payments.lockCapture(merchant, payment);
    long refunded =
        db.queryForObject(
            "SELECT coalesce(sum(amount::numeric),0)::bigint FROM refunds WHERE payment_id=? AND status='SUCCEEDED'",
            Long.class,
            payment);
    long amount = input.amount();
    String error = null;
    if (amount > p.amount() - refunded) error = "REFUND_LIMIT_EXCEEDED";
    else if (!owner.status().equals("ACTIVE")) error = "MERCHANT_INACTIVE";
    else {
      var accounts = posting.lock(List.of(p.merchantAccount(), p.payerAccount()));
      var source = accounts.get(p.merchantAccount());
      var dest = accounts.get(p.payerAccount());
      if (!source.type().equals("MERCHANT") || !dest.type().equals("PERSONAL"))
        throw new IllegalStateException("Invalid refund account graph");
      if (!source.status().equals("ACTIVE")) error = "WALLET_LOCKED";
      else if (source.balance() < amount) error = "INSUFFICIENT_FUNDS";
      else if (dest.balance() > AccountLimits.CUSTOMER_MAX - amount)
        error = "BALANCE_LIMIT_EXCEEDED";
      // Original payer LOCKED still receives this obligation; never choose a destination from
      // client input.
    }
    UUID id = UUID.randomUUID(), journal = null;
    var now = clock.instant();
    String status = error == null ? "SUCCEEDED" : "FAILED";
    if (error == null)
      journal =
          posting.post(
              "REFUND",
              id,
              List.of(
                  new MoneyPostingService.Entry(p.merchantAccount(), -amount),
                  new MoneyPostingService.Entry(p.payerAccount(), amount)));
    db.update(
        "INSERT INTO refunds(id,command_id,payment_id,merchant_id,actor_id,payer_id,source_account_id,destination_account_id,source_wallet_id,destination_wallet_id,amount,currency,note,merchant_name,payer_name,status,ledger_transaction_id,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'VND',?,?,?,?,?,?,?)",
        id,
        claim.id(),
        payment,
        merchant,
        actor,
        p.payerId(),
        p.merchantAccount(),
        p.payerAccount(),
        p.merchantWallet(),
        p.payerWallet(),
        amount,
        input.note(),
        p.merchantName(),
        p.payerName(),
        status,
        journal,
        error,
        java.sql.Timestamp.from(now));
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("amount", Long.toString(amount));
    result.put("currency", "VND");
    result.put("fee", "0");
    result.put("paymentId", payment.toString());
    result.put("merchantId", merchant.toString());
    result.put("sourceWalletId", p.merchantWallet().toString());
    result.put("destinationWalletId", p.payerWallet().toString());
    result.put("recipientName", p.payerName());
    result.put("note", input.note());
    if (journal != null) result.put("ledgerTransactionId", journal.toString());
    var terminal =
        new CommandStore.Terminal(
            key,
            "REFUND",
            id,
            status,
            error == null ? 201 : 422,
            now,
            result,
            error == null ? Map.of() : Map.of("code", error, "message", message(error)));
    commands.finish(claim.id(), terminal);
    audit.money(actor, "REFUND", id, status, correlation);
    return terminal;
  }

  private String hash(String value) {
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
      case "REFUND_LIMIT_EXCEEDED" -> "Số tiền vượt phần còn được hoàn của thanh toán gốc.";
      case "MERCHANT_INACTIVE" -> "Doanh nghiệp hiện không thể khởi tạo hoàn tiền.";
      case "WALLET_LOCKED" -> "Ví doanh nghiệp đang bị khóa.";
      case "INSUFFICIENT_FUNDS" -> "Ví doanh nghiệp không đủ số dư để hoàn tiền.";
      default -> "Ví người nhận vượt giới hạn số dư.";
    };
  }
}
