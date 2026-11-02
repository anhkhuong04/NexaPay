package vn.nexapay;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import com.fasterxml.jackson.databind.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.*;
import org.springframework.test.web.servlet.*;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.command.CommandStore;
import vn.nexapay.funding.*;
import vn.nexapay.identity.RegistrationTransaction;
import vn.nexapay.ledger.MoneyPostingService;
import vn.nexapay.shared.*;
import vn.nexapay.wallet.WalletService;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class FundingIntegrationTest {
  @Container
  static PostgreSQLContainer<?> pg =
      new PostgreSQLContainer<>("postgres:17.7-alpine")
          .withDatabaseName("nexapay")
          .withUsername("nexapay_owner")
          .withPassword("test-owner-only")
          .withInitScript("db/test-roles.sql");

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", pg::getJdbcUrl);
    r.add("spring.datasource.username", () -> "nexapay_app");
    r.add("spring.datasource.password", () -> "test-app-only");
    r.add("spring.flyway.user", pg::getUsername);
    r.add("spring.flyway.password", pg::getPassword);
  }

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate db;
  @Autowired RegistrationTransaction registration;
  @Autowired FundingService funding;
  @Autowired FundingQuota quota;
  @Autowired CommandStore commands;
  @Autowired MoneyPostingService posting;
  @Autowired WalletService wallets;
  @Autowired PlatformTransactionManager manager;
  @MockitoBean Clock clock;
  @MockitoSpyBean AuditService audit;
  @MockitoSpyBean FundingPolicy policy;
  final AtomicReference<Instant> now = new AtomicReference<>();
  static final AtomicInteger days = new AtomicInteger();
  JdbcTemplate owner;
  TransactionTemplate tx;

  @BeforeEach
  void setup() {
    now.set(Instant.parse("2026-01-01T12:00:00Z").plus(Duration.ofDays(days.incrementAndGet())));
    when(clock.instant()).thenAnswer(i -> now.get());
    owner =
        new JdbcTemplate(
            new DriverManagerDataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword()));
    tx = new TransactionTemplate(manager);
  }

  @AfterEach
  void resetSpies() {
    reset(targetAudit());
    reset(
        org.springframework.test.util.AopTestUtils.<FundingPolicy>getUltimateTargetObject(policy));
  }

  AuditService targetAudit() {
    return org.springframework.test.util.AopTestUtils.getUltimateTargetObject(audit);
  }

  ActorPrincipal actor() {
    String email = UUID.randomUUID() + "@example.test";
    UUID id =
        registration
            .create(
                email, "{bcrypt}test-only-unusable", "Funding Demo", UUID.randomUUID().toString())
            .userId();
    return new ActorPrincipal(id, email, "", List.of("INDIVIDUAL"), true);
  }

  CommandStore.Terminal fund(ActorPrincipal actor, UUID key) {
    return funding.fund(actor.id(), key, UUID.randomUUID().toString());
  }

  MvcResult fundHttp(ActorPrincipal actor, String key, String body) throws Exception {
    return mvc.perform(
            post("/api/v1/demo-fundings")
                .with(user(actor))
                .with(csrf())
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(body))
        .andReturn();
  }

  String input() {
    return "{\"amount\":\"100000\",\"currency\":\"VND\"}";
  }

  long count(String table) {
    return db.queryForObject("SELECT count(*) FROM " + table, Long.class);
  }

  long balance(ActorPrincipal actor) {
    return Long.parseLong(wallets.own(actor.id()).availableBalance());
  }

  void healthy() {
    assertThat(db.queryForList("SELECT * FROM reconciliation_findings()")).isEmpty();
  }

  @Test
  void fundingPostsBalancedLedgerAndReplaysOriginalWithoutQuotaOrAuditAgain() throws Exception {
    var actor = actor();
    UUID key = UUID.randomUUID();
    long audits = count("audit_events"), journals = count("ledger_transactions");
    var response = fundHttp(actor, key.toString(), input());
    assertThat(response.getResponse().getStatus()).isEqualTo(201);
    var original =
        json.readValue(response.getResponse().getContentAsString(), CommandStore.Terminal.class);
    assertThat(original.status()).isEqualTo("SUCCEEDED");
    assertThat(balance(actor)).isEqualTo(100000);
    assertThat(fund(actor, key)).isEqualTo(original);
    assertThat(commands.lookup(actor.id(), "DEMO_FUNDING", key)).isEqualTo(original);
    assertThat(count("ledger_transactions")).isEqualTo(journals + 1);
    assertThat(count("audit_events")).isEqualTo(audits + 1);
    assertThat(quota.capabilities(actor.id()).userRemaining()).isEqualTo("400000");
    healthy();
  }

  @Test
  void twentyConcurrentIdenticalKeysPostExactlyOnce() throws Exception {
    var actor = actor();
    UUID key = UUID.randomUUID();
    ExecutorService pool = Executors.newFixedThreadPool(20);
    try {
      var tasks =
          java.util.stream.IntStream.range(0, 20)
              .<Callable<CommandStore.Terminal>>mapToObj(i -> () -> fund(actor, key))
              .toList();
      var results =
          pool.invokeAll(tasks).stream()
              .map(
                  f -> {
                    try {
                      return f.get();
                    } catch (Exception e) {
                      throw new RuntimeException(e);
                    }
                  })
              .toList();
      assertThat(results).allMatch(r -> r.equals(results.getFirst()));
      assertThat(balance(actor)).isEqualTo(100000);
      healthy();
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void twentyDistinctKeysCannotExceedUserQuotaAndUtcResetDoesNotChangeOldRejection()
      throws Exception {
    var actor = actor();
    ExecutorService pool = Executors.newFixedThreadPool(20);
    try {
      var tasks =
          java.util.stream.IntStream.range(0, 20)
              .<Callable<CommandStore.Terminal>>mapToObj(i -> () -> fund(actor, UUID.randomUUID()))
              .toList();
      var results = new ArrayList<CommandStore.Terminal>();
      for (var f : pool.invokeAll(tasks)) results.add(f.get());
      assertThat(results.stream().filter(r -> r.status().equals("SUCCEEDED"))).hasSize(5);
      var failed =
          results.stream().filter(r -> r.status().equals("FAILED")).findFirst().orElseThrow();
      assertThat(balance(actor)).isEqualTo(500000);
      assertThat(quota.capabilities(actor.id()).userRemaining()).isEqualTo("0");
      now.set(quota.capabilities(actor.id()).nextResetAt());
      assertThat(quota.capabilities(actor.id()).userRemaining()).isEqualTo("500000");
      assertThat(fund(actor, failed.key())).isEqualTo(failed);
      assertThat(fund(actor, UUID.randomUUID()).status()).isEqualTo("SUCCEEDED");
      healthy();
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void environmentQuotaIsSharedAcrossActorsWithoutConsumingOnRejection() {
    var a = actor();
    var b = actor();
    fund(a, UUID.randomUUID());
    var env = quota.environment();
    LocalDate day = now.get().atOffset(ZoneOffset.UTC).toLocalDate();
    owner.update(
        "UPDATE funding_quotas SET spent=50000000 WHERE scope='ENVIRONMENT' AND subject=? AND utc_date=?",
        env.epoch(),
        day);
    try {
      var result = fund(b, UUID.randomUUID());
      assertThat(result.error().get("code")).isEqualTo("ENVIRONMENT_QUOTA_EXCEEDED");
      assertThat(balance(b)).isZero();
      assertThat(quota.capabilities(b.id()).userRemaining()).isEqualTo("500000");
    } finally {
      owner.update(
          "UPDATE funding_quotas SET spent=100000 WHERE scope='ENVIRONMENT' AND subject=? AND utc_date=?",
          env.epoch(),
          day);
    }
    healthy();
  }

  @Test
  void rollbackAfterAuditLeavesNoMoneyQuotaCommandOrAudit() {
    var a = actor();
    UUID key = UUID.randomUUID();
    long journals = count("ledger_transactions"), events = count("audit_events");
    doAnswer(
            i -> {
              i.callRealMethod();
              throw new IllegalStateException("injected after money audit");
            })
        .when(targetAudit())
        .money(eq(a.id()), any(), any(), any());
    assertThatThrownBy(() -> fund(a, key)).isInstanceOf(IllegalStateException.class);
    assertThat(balance(a)).isZero();
    assertThat(count("ledger_transactions")).isEqualTo(journals);
    assertThat(count("audit_events")).isEqualTo(events);
    assertThatThrownBy(() -> commands.lookup(a.id(), "DEMO_FUNDING", key))
        .isInstanceOfSatisfying(
            ApiFailure.class, e -> assertThat(e.code()).isEqualTo("COMMAND_NOT_OBSERVED"));
    assertThat(quota.capabilities(a.id()).userRemaining()).isEqualTo("500000");
    healthy();
  }

  @Test
  void lockedWalletFailureReplaysAfterUnlockAndNewIntentCanSucceed() {
    var a = actor();
    var account = wallets.reference(a.id()).accountId();
    owner.update("UPDATE ledger_accounts SET status='LOCKED' WHERE id=?", account);
    UUID key = UUID.randomUUID();
    var failed = fund(a, key);
    assertThat(failed.originalHttpStatus()).isEqualTo(422);
    owner.update("UPDATE ledger_accounts SET status='ACTIVE' WHERE id=?", account);
    assertThat(fund(a, key)).isEqualTo(failed);
    assertThat(balance(a)).isZero();
    assertThat(fund(a, UUID.randomUUID()).status()).isEqualTo("SUCCEEDED");
    healthy();
  }

  @Test
  void claimConflictAndDeferredInProgressGuardCannotChangeOriginal() {
    var a = actor();
    UUID key = UUID.randomUUID();
    var original = fund(a, key);
    assertThatThrownBy(
            () ->
                tx.execute(
                    s ->
                        commands.claim(
                            a.id(),
                            "DEMO_FUNDING",
                            key,
                            "different-canonical-fingerprint",
                            now.get())))
        .isInstanceOfSatisfying(ApiFailure.class, e -> assertThat(e.status()).isEqualTo(409));
    assertThatThrownBy(
            () ->
                tx.execute(
                    s ->
                        commands.claim(
                            a.id(), "DEMO_FUNDING", UUID.randomUUID(), "test", now.get())))
        .isInstanceOf(RuntimeException.class);
    assertThat(commands.lookup(a.id(), "DEMO_FUNDING", key)).isEqualTo(original);
    healthy();
  }

  @Test
  void strictMoneySchemaCsrfMissingKeyBadKeyAndOwnership() throws Exception {
    var a = actor();
    var b = actor();
    long commandsBefore = count("money_commands");
    for (String body :
        List.of(
            "{\"amount\":100000,\"currency\":\"VND\"}",
            "{\"amount\":\"1e5\",\"currency\":\"VND\"}",
            "{\"amount\":\"0100000\",\"currency\":\"VND\"}",
            "{\"amount\":\"100000\",\"currency\":\"VND\",\"actorId\":\"x\"}"))
      assertThat(fundHttp(a, UUID.randomUUID().toString(), body).getResponse().getStatus())
          .isEqualTo(400);
    assertThat(fundHttp(a, "bad", input()).getResponse().getStatus()).isEqualTo(400);
    assertThat(
            mvc.perform(
                    post("/api/v1/demo-fundings")
                        .with(user(a))
                        .with(csrf())
                        .contentType("application/json")
                        .content(input()))
                .andReturn()
                .getResponse()
                .getStatus())
        .isEqualTo(400);
    assertThat(
            mvc.perform(
                    post("/api/v1/demo-fundings")
                        .with(user(a))
                        .contentType("application/json")
                        .content(input()))
                .andReturn()
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    assertThat(count("money_commands")).isEqualTo(commandsBefore);
    var result = fund(a, UUID.randomUUID());
    assertThatThrownBy(() -> commands.lookup(b.id(), "DEMO_FUNDING", result.key()))
        .isInstanceOfSatisfying(ApiFailure.class, e -> assertThat(e.status()).isEqualTo(404));
    assertThat(commands.recent(b.id(), 20, null).items()).isEmpty();
  }

  @Test
  void recentCommandsCursorAndReadOnlySnapshotDetectCorruption() {
    var a = actor();
    for (int i = 0; i < 3; i++) fund(a, UUID.randomUUID());
    var first = commands.recent(a.id(), 2, null);
    var second = commands.recent(a.id(), 2, first.nextCursor());
    assertThat(first.items()).hasSize(2);
    assertThat(second.items()).hasSize(1);
    assertThat(second.items()).doesNotContainAnyElementsOf(first.items());
    healthy();
    var account = wallets.reference(a.id()).accountId();
    // Corruption probe is rolled back inside an isolated owner transaction, never a repair.
    var ownerTx =
        new TransactionTemplate(
            new org.springframework.jdbc.datasource.DataSourceTransactionManager(
                owner.getDataSource()));
    ownerTx.executeWithoutResult(
        s -> {
          owner.update(
              "UPDATE ledger_accounts SET posted_balance=posted_balance+1 WHERE id=?", account);
          assertThat(
                  owner.queryForList(
                      "SELECT * FROM reconciliation_findings() WHERE check_name='projection'"))
              .isNotEmpty();
          s.setRollbackOnly();
        });
    var readTx = new TransactionTemplate(manager);
    readTx.setReadOnly(true);
    readTx.setIsolationLevel(
        org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ);
    readTx.executeWithoutResult(
        s -> {
          assertThat(db.queryForObject("SHOW transaction_read_only", String.class)).isEqualTo("on");
          healthy();
        });
  }

  @Test
  void accountLockWinsBeforeFundingAndTimeoutRollsBackClaim() throws Exception {
    var a = actor();
    var account = wallets.reference(a.id()).accountId();
    ExecutorService pool = Executors.newSingleThreadExecutor();
    try (Connection c =
        DriverManager.getConnection(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword())) {
      c.setAutoCommit(false);
      try (var p = c.prepareStatement("UPDATE ledger_accounts SET status='LOCKED' WHERE id=?")) {
        p.setObject(1, account);
        p.executeUpdate();
      }
      var future = pool.submit(() -> fund(a, UUID.randomUUID()));
      Thread.sleep(150);
      assertThat(future).isNotDone();
      c.commit();
      assertThat(future.get(10, TimeUnit.SECONDS).error().get("code")).isEqualTo("WALLET_LOCKED");
      c.setAutoCommit(false);
      try (var p = c.prepareStatement("SELECT id FROM ledger_accounts WHERE id=? FOR UPDATE")) {
        p.setObject(1, account);
        p.executeQuery();
      }
      UUID key = UUID.randomUUID();
      var timed = pool.submit(() -> fund(a, key));
      assertThatThrownBy(
              () -> {
                try {
                  timed.get(12, TimeUnit.SECONDS);
                } catch (ExecutionException e) {
                  throw e.getCause();
                }
              })
          .isInstanceOfSatisfying(
              ApiFailure.class, e -> assertThat(e.code()).isEqualTo("COMMAND_RETRYABLE"));
      c.rollback();
      assertThatThrownBy(() -> commands.lookup(a.id(), "DEMO_FUNDING", key))
          .isInstanceOf(ApiFailure.class);
      healthy();
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void journalGuardsImmutabilityAndSignedOverflow() {
    var a = actor();
    var b = actor();
    var successful = fund(a, UUID.randomUUID());
    UUID account = wallets.reference(a.id()).accountId(), issuance = quota.environment().issuance();
    assertThatThrownBy(
            () ->
                tx.execute(
                    s -> {
                      db.update(
                          "INSERT INTO ledger_transactions(id,operation_type,operation_id,currency) VALUES(?,'TEST',?,'VND')",
                          UUID.randomUUID(),
                          UUID.randomUUID());
                      return null;
                    }))
        .isInstanceOf(RuntimeException.class);
    for (String mutation :
        List.of(
            "UPDATE ledger_entries SET amount=amount",
            "DELETE FROM ledger_entries",
            "UPDATE ledger_transactions SET status=status",
            "DELETE FROM ledger_transactions",
            "UPDATE ledger_accounts SET posted_balance=posted_balance"))
      assertThatThrownBy(() -> db.update(mutation))
          .isInstanceOf(org.springframework.dao.DataAccessException.class);
    UUID journal = UUID.fromString(successful.result().get("ledgerTransactionId").toString());
    assertThatThrownBy(
            () ->
                tx.execute(
                    s -> {
                      db.update(
                          "INSERT INTO ledger_entries(id,transaction_id,account_id,currency,amount) VALUES(?,?,?,'VND',1)",
                          UUID.randomUUID(),
                          journal,
                          wallets.reference(b.id()).accountId());
                      return null;
                    }))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(
            () ->
                tx.execute(
                    s ->
                        posting.post(
                            "OVERFLOW",
                            UUID.randomUUID(),
                            List.of(
                                new MoneyPostingService.Entry(issuance, Long.MIN_VALUE),
                                new MoneyPostingService.Entry(account, Long.MAX_VALUE),
                                new MoneyPostingService.Entry(
                                    wallets.reference(b.id()).accountId(), 1)))))
        .isInstanceOf(ArithmeticException.class);
    for (String currency : List.of("VND", "USD")) {
      assertThatThrownBy(
              () ->
                  tx.execute(
                      s -> {
                        UUID id = UUID.randomUUID();
                        db.update(
                            "INSERT INTO ledger_transactions(id,operation_type,operation_id,currency) VALUES(?,'TEST',?,'VND')",
                            id,
                            UUID.randomUUID());
                        db.update(
                            "INSERT INTO ledger_entries(id,transaction_id,account_id,currency,amount) VALUES(?,?,?,?,1)",
                            UUID.randomUUID(),
                            id,
                            account,
                            currency);
                        return null;
                      }))
          .isInstanceOf(RuntimeException.class);
    }
    healthy();
  }

  @Test
  void disabledFeatureDoesNotClaimAndTerminalReplaySurvivesFlagChange() {
    var a = actor();
    var original = fund(a, UUID.randomUUID());
    doReturn(false)
        .when(
            org.springframework.test.util.AopTestUtils.<FundingPolicy>getUltimateTargetObject(
                policy))
        .enabled();
    assertThat(fund(a, original.key())).isEqualTo(original);
    long before = count("money_commands");
    assertThatThrownBy(() -> fund(a, UUID.randomUUID()))
        .isInstanceOfSatisfying(
            ApiFailure.class, e -> assertThat(e.code()).isEqualTo("FUNDING_DISABLED"));
    assertThat(count("money_commands")).isEqualTo(before);
    healthy();
  }
}
