package vn.nexapay.ledger;

/** Accepted ADR-001 customer cap. Signed system accounts retain BIGINT overflow checks. */
public final class AccountLimits {
  public static final long CUSTOMER_MAX = 1000000000000L;

  private AccountLimits() {}

  public static boolean customer(String type) {
    return type.equals("PERSONAL") || type.equals("MERCHANT");
  }
}
