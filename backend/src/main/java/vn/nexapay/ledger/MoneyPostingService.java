package vn.nexapay.ledger;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class MoneyPostingService {
  private final JdbcTemplate db;

  public MoneyPostingService(JdbcTemplate db) {
    this.db = db;
  }

  public record Account(UUID id, String type, String status, long balance) {}

  public record Entry(UUID accountId, long amount) {}

  @Transactional(propagation = Propagation.MANDATORY)
  public Map<UUID, Account> lock(Collection<UUID> ids) {
    // PostgreSQL UUID byte ordering; String ordering preserves it for canonical UUID text.
    Map<UUID, Account> accounts = new LinkedHashMap<>();
    ids.stream()
        .distinct()
        .sorted(Comparator.comparing(UUID::toString))
        .forEach(
            id -> {
              Account account =
                  db.queryForObject(
                      "SELECT id,account_type,status,posted_balance FROM lock_ledger_account(?)",
                      (r, n) ->
                          new Account(
                              r.getObject(1, UUID.class),
                              r.getString(2),
                              r.getString(3),
                              r.getLong(4)),
                      id);
              accounts.put(id, account);
            });
    return accounts;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public UUID post(String operationType, UUID operationId, List<Entry> entries) {
    if (entries.size() < 2
        || entries.stream().anyMatch(e -> e.amount() == 0)
        || entries.stream().map(Entry::accountId).distinct().count() != entries.size())
      throw new IllegalArgumentException("Journal needs distinct accounts and nonzero entries");
    java.math.BigInteger sum =
        entries.stream()
            .map(e -> java.math.BigInteger.valueOf(e.amount()))
            .reduce(java.math.BigInteger.ZERO, java.math.BigInteger::add);
    if (sum.signum() != 0) throw new IllegalArgumentException("Unbalanced journal");
    var accounts = lock(entries.stream().map(Entry::accountId).toList());
    for (Entry entry : entries) {
      Account account = accounts.get(entry.accountId());
      long next = Math.addExact(account.balance(), entry.amount());
      if (account.type().equals("PERSONAL") && (next < 0 || next > 1000000000000L))
        throw new IllegalArgumentException("Customer balance limit");
    }
    UUID id = UUID.randomUUID();
    db.update(
        "INSERT INTO ledger_transactions(id,operation_type,operation_id,currency) VALUES(?,?,?,'VND')",
        id,
        operationType,
        operationId);
    entries.stream()
        .sorted(Comparator.comparing(e -> e.accountId().toString()))
        .forEach(
            entry ->
                db.update(
                    "INSERT INTO ledger_entries(id,transaction_id,account_id,currency,amount) VALUES(?,?,?,'VND',?)",
                    UUID.randomUUID(),
                    id,
                    entry.accountId(),
                    entry.amount()));
    return id;
  }
}
