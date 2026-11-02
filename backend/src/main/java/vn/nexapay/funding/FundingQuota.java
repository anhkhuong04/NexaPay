package vn.nexapay.funding;

import java.time.*;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class FundingQuota {
  private final JdbcTemplate db;
  private final Clock clock;
  private final FundingPolicy policy;

  public FundingQuota(JdbcTemplate db, Clock clock, FundingPolicy policy) {
    this.db = db;
    this.clock = clock;
    this.policy = policy;
  }

  public record Environment(UUID epoch, UUID issuance) {}

  public record Capabilities(
      boolean enabled,
      UUID environmentEpoch,
      String presetAmount,
      String currency,
      String userRemaining,
      String environmentRemaining,
      Instant nextResetAt) {}

  public Environment environment() {
    return db.queryForObject(
        "SELECT epoch,issuance_account_id FROM demo_environment",
        (r, n) -> new Environment(r.getObject(1, UUID.class), r.getObject(2, UUID.class)));
  }

  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
  public Capabilities capabilities(UUID actor) {
    Environment env = environment();
    LocalDate day = clock.instant().atOffset(ZoneOffset.UTC).toLocalDate();
    return new Capabilities(
        policy.enabled(),
        env.epoch(),
        Long.toString(FundingPolicy.PRESET),
        "VND",
        Long.toString(FundingPolicy.USER_LIMIT - spent("USER", actor, day)),
        Long.toString(FundingPolicy.ENVIRONMENT_LIMIT - spent("ENVIRONMENT", env.epoch(), day)),
        day.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC));
  }

  private long spent(String scope, UUID subject, LocalDate day) {
    return db.queryForObject(
        "SELECT coalesce((SELECT spent FROM funding_quotas WHERE scope=? AND subject=? AND utc_date=?),0)",
        Long.class,
        scope,
        subject,
        day);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public String lockAndCheck(UUID actor, Environment env, LocalDate day) {
    long environment = locked("ENVIRONMENT", env.epoch(), day);
    long user = locked("USER", actor, day);
    if (environment > FundingPolicy.ENVIRONMENT_LIMIT - FundingPolicy.PRESET)
      return "ENVIRONMENT_QUOTA_EXCEEDED";
    if (user > FundingPolicy.USER_LIMIT - FundingPolicy.PRESET) return "USER_QUOTA_EXCEEDED";
    return null;
  }

  private long locked(String scope, UUID subject, LocalDate day) {
    db.update(
        "INSERT INTO funding_quotas(scope,subject,utc_date) VALUES(?,?,?) ON CONFLICT DO NOTHING",
        scope,
        subject,
        day);
    return db.queryForObject(
        "SELECT spent FROM funding_quotas WHERE scope=? AND subject=? AND utc_date=? FOR UPDATE",
        Long.class,
        scope,
        subject,
        day);
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void consume(UUID actor, Environment env, LocalDate day) {
    db.update(
        "UPDATE funding_quotas SET spent=spent+? WHERE utc_date=? AND ((scope='ENVIRONMENT' AND subject=?) OR (scope='USER' AND subject=?))",
        FundingPolicy.PRESET,
        day,
        env.epoch(),
        actor);
  }
}
