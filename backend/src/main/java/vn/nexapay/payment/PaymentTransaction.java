package vn.nexapay.payment;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.command.*;
import vn.nexapay.ledger.*;
import vn.nexapay.merchant.MerchantService;
import vn.nexapay.wallet.WalletService;

@Service
public class PaymentTransaction {
  private final JdbcTemplate db;
  private final PaymentRequests requests;
  private final CommandStore commands;
  private final WalletService wallets;
  private final MerchantService merchants;
  private final MoneyPostingService posting;
  private final AuditService audit;
  private final Clock clock;

  public PaymentTransaction(
      JdbcTemplate db,
      PaymentRequests requests,
      CommandStore commands,
      WalletService wallets,
      MerchantService merchants,
      MoneyPostingService posting,
      AuditService audit,
      Clock clock) {
    this.db = db;
    this.requests = requests;
    this.commands = commands;
    this.wallets = wallets;
    this.merchants = merchants;
    this.posting = posting;
    this.audit = audit;
    this.clock = clock;
  }

  @Transactional(isolation = Isolation.READ_COMMITTED, timeout = 6)
  public CommandStore.Terminal execute(
      UUID actor, UUID key, UUID ref, long amount, String correlation) {
    db.execute("SET LOCAL lock_timeout='2s'");
    db.execute("SET LOCAL statement_timeout='5s'");
    var source = wallets.reference(actor);
    var claim =
        commands.claim(
            actor,
            "PAYMENT",
            key,
            PaymentRequests.hash(source.accountId() + "|" + ref + "|" + amount + "|VND"),
            clock.instant());
    if (claim.replay() != null) return claim.replay();
    var decision = requests.lock(ref, correlation);
    var r = decision.request();
    var destination = wallets.merchantReference(r.merchantId());
    String error = null;
    if (amount != r.amount()) error = "AMOUNT_MISMATCH";
    else if (r.status().equals("EXPIRED")) error = "REQUEST_EXPIRED";
    else if (!r.status().equals("PENDING")) error = "REQUEST_UNAVAILABLE";
    else if (actor.equals(r.creatorId())) error = "SELF_PAYMENT";
    else if (!merchants.profile(r.creatorId(), r.merchantId()).status().equals("ACTIVE"))
      error = "MERCHANT_INACTIVE";
    else {
      var accounts = posting.lock(List.of(source.accountId(), destination.accountId()));
      var from = accounts.get(source.accountId());
      var to = accounts.get(destination.accountId());
      if (!from.type().equals("PERSONAL") || !to.type().equals("MERCHANT"))
        throw new IllegalStateException("Invalid payment account graph");
      if (!from.status().equals("ACTIVE") || !to.status().equals("ACTIVE")) error = "WALLET_LOCKED";
      else if (from.balance() < amount) error = "INSUFFICIENT_FUNDS";
      else if (to.balance() > AccountLimits.CUSTOMER_MAX - amount) error = "BALANCE_LIMIT_EXCEEDED";
    }
    UUID attempt = UUID.randomUUID();
    UUID payment = null, journal = null;
    String status = error == null ? "SUCCEEDED" : "FAILED";
    String payerName = wallets.recipient(source.walletId()).orElseThrow().displayName();
    db.update(
        "INSERT INTO payment_attempts(id,command_id,request_id,actor_id,source_wallet_id,destination_wallet_id,amount,payer_name,status,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        attempt,
        claim.id(),
        r.id(),
        actor,
        source.walletId(),
        destination.walletId(),
        amount,
        payerName,
        status,
        error,
        java.sql.Timestamp.from(decision.now()));
    if (error == null) {
      payment = UUID.randomUUID();
      journal =
          posting.post(
              "PAYMENT",
              payment,
              List.of(
                  new MoneyPostingService.Entry(source.accountId(), -amount),
                  new MoneyPostingService.Entry(destination.accountId(), amount)));
      db.update(
          "INSERT INTO payments(id,request_id,attempt_id,merchant_id,source_account_id,destination_account_id,amount,ledger_transaction_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
          payment,
          r.id(),
          attempt,
          r.merchantId(),
          source.accountId(),
          destination.accountId(),
          amount,
          journal,
          java.sql.Timestamp.from(decision.now()));
      db.update(
          "UPDATE payment_requests SET status='PAID',state_changed_at=? WHERE id=?",
          java.sql.Timestamp.from(decision.now()),
          r.id());
    }
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("requestRef", ref.toString());
    result.put("amount", Long.toString(amount));
    result.put("currency", "VND");
    result.put("fee", "0");
    result.put("recipientName", r.merchantName());
    result.put("sourceWalletId", source.walletId().toString());
    result.put("destinationWalletId", destination.walletId().toString());
    result.put("note", r.description());
    if (payment != null) {
      result.put("paymentId", payment.toString());
      result.put("ledgerTransactionId", journal.toString());
    }
    var terminal =
        new CommandStore.Terminal(
            key,
            "PAYMENT",
            attempt,
            status,
            error == null ? 201 : 422,
            decision.now(),
            result,
            error == null ? Map.of() : Map.of("code", error, "message", message(error)));
    commands.finish(claim.id(), terminal);
    audit.money(actor, "PAYMENT", attempt, status, correlation);
    return terminal;
  }

  private String message(String code) {
    return switch (code) {
      case "SELF_PAYMENT" -> "Bạn không thể tự thanh toán cho doanh nghiệp của mình.";
      case "REQUEST_EXPIRED" -> "Yêu cầu thanh toán đã hết hạn.";
      case "REQUEST_UNAVAILABLE" -> "Yêu cầu đã thanh toán hoặc đã bị hủy.";
      case "WALLET_LOCKED" -> "Ví trả tiền hoặc ví doanh nghiệp đang bị khóa.";
      case "INSUFFICIENT_FUNDS" -> "Ví cá nhân không đủ số dư.";
      case "AMOUNT_MISMATCH" -> "Số tiền không khớp yêu cầu. Hãy tải lại trước khi xác nhận.";
      case "BALANCE_LIMIT_EXCEEDED" -> "Ví doanh nghiệp vượt giới hạn số dư.";
      default -> "Doanh nghiệp chưa thể nhận thanh toán.";
    };
  }
}
