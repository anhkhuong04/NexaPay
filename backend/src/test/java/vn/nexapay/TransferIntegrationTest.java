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
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.command.CommandStore;
import vn.nexapay.funding.FundingService;
import vn.nexapay.identity.RegistrationTransaction;
import vn.nexapay.shared.*;
import vn.nexapay.wallet.WalletService;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class TransferIntegrationTest {
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
  @Autowired WalletService wallets;
  @Autowired CommandStore commands;
  @MockitoSpyBean AuditService audit;
  JdbcTemplate owner;

  @BeforeEach
  void setup() {
    owner =
        new JdbcTemplate(
            new DriverManagerDataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword()));
  }

  @AfterEach
  void resetAudit() {
    reset(org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit));
  }

  ActorPrincipal actor() {
    String email = UUID.randomUUID() + "@example.test";
    UUID id =
        registration
            .create(
                email, "{bcrypt}test-only-unusable", "Transfer An", UUID.randomUUID().toString())
            .userId();
    return new ActorPrincipal(id, email, "", List.of("INDIVIDUAL"), true);
  }

  UUID wallet(ActorPrincipal a) {
    return wallets.reference(a.id()).walletId();
  }

  long balance(ActorPrincipal a) {
    return Long.parseLong(wallets.own(a.id()).availableBalance());
  }

  void fund(ActorPrincipal a) {
    assertThat(funding.fund(a.id(), UUID.randomUUID(), "test").status()).isEqualTo("SUCCEEDED");
  }

  String body(UUID destination, String amount, String note) throws Exception {
    return json.writeValueAsString(
        Map.of(
            "destinationWalletId", destination, "amount", amount, "currency", "VND", "note", note));
  }

  MvcResult postTransfer(ActorPrincipal a, UUID key, UUID destination, String amount, String note)
      throws Exception {
    return http(a, key.toString(), body(destination, amount, note));
  }

  MvcResult http(ActorPrincipal a, String key, String body) throws Exception {
    return mvc.perform(
            post("/api/v1/transfers")
                .with(user(a))
                .with(csrf())
                .header("Idempotency-Key", key)
                .contentType("application/json")
                .content(body))
        .andReturn();
  }

  CommandStore.Terminal transfer(
      ActorPrincipal a, UUID key, UUID destination, String amount, String note) throws Exception {
    var response = postTransfer(a, key, destination, amount, note).getResponse();
    assertThat(response.getStatus()).isIn(201, 422);
    return json.readValue(response.getContentAsByteArray(), CommandStore.Terminal.class);
  }

  void healthy() {
    assertThat(db.queryForList("SELECT * FROM reconciliation_findings()")).isEmpty();
  }

  @Test
  void successIsAtomicAndCanonicalReplayCannotChangeIntent() throws Exception {
    var a = actor();
    var b = actor();
    fund(a);
    UUID key = UUID.randomUUID();
    long journals = db.queryForObject("SELECT count(*) FROM ledger_transactions", Long.class);
    var first = transfer(a, key, wallet(b), "10000", "  cafe\u0301  ");
    assertThat(first.status()).isEqualTo("SUCCEEDED");
    assertThat(balance(a)).isEqualTo(90000);
    assertThat(balance(b)).isEqualTo(10000);
    assertThat(transfer(a, key, wallet(b), "10000", "café")).isEqualTo(first);
    assertThat(postTransfer(a, key, wallet(b), "10001", "café").getResponse().getStatus())
        .isEqualTo(409);
    assertThat(db.queryForObject("SELECT count(*) FROM ledger_transactions", Long.class))
        .isEqualTo(journals + 1);
    assertThat(commands.lookup(a.id(), "TRANSFER", key)).isEqualTo(first);
    assertThatThrownBy(() -> commands.lookup(b.id(), "TRANSFER", key))
        .isInstanceOf(ApiFailure.class);
    healthy();
  }

  @Test
  void twentyDistinctKeysCannotOverspendAndOppositeDirectionsDoNotDeadlock() throws Exception {
    var a = actor();
    var b = actor();
    fund(a);
    var pool = Executors.newFixedThreadPool(20);
    try {
      var tasks = new ArrayList<Callable<CommandStore.Terminal>>();
      for (int i = 0; i < 20; i++)
        tasks.add(() -> transfer(a, UUID.randomUUID(), wallet(b), "10000", ""));
      var results = new ArrayList<CommandStore.Terminal>();
      for (var f : pool.invokeAll(tasks)) results.add(f.get(20, TimeUnit.SECONDS));
      assertThat(results.stream().filter(r -> r.status().equals("SUCCEEDED"))).hasSize(10);
      assertThat(balance(a)).isZero();
      assertThat(balance(b)).isEqualTo(100000);
      // Fresh actors keep this case below the shared 30/min actor throttle.
      var c = actor();
      var d = actor();
      fund(c);
      fund(d);
      tasks.clear();
      for (int i = 0; i < 10; i++) {
        tasks.add(() -> transfer(c, UUID.randomUUID(), wallet(d), "1", ""));
        tasks.add(() -> transfer(d, UUID.randomUUID(), wallet(c), "1", ""));
      }
      for (var f : pool.invokeAll(tasks))
        assertThat(f.get(20, TimeUnit.SECONDS).status()).isEqualTo("SUCCEEDED");
      assertThat(balance(c)).isEqualTo(100000);
      assertThat(balance(d)).isEqualTo(100000);
      healthy();
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void twentySameKeysPostOnceAndFailureReplaysAfterFunding() throws Exception {
    var a = actor();
    var b = actor();
    UUID rejectedKey = UUID.randomUUID();
    var failure = transfer(a, rejectedKey, wallet(b), "10000", "");
    assertThat(failure.error().get("code")).isEqualTo("INSUFFICIENT_FUNDS");
    fund(a);
    assertThat(transfer(a, rejectedKey, wallet(b), "10000", "")).isEqualTo(failure);
    UUID key = UUID.randomUUID();
    var pool = Executors.newFixedThreadPool(20);
    try {
      var tasks = new ArrayList<Callable<CommandStore.Terminal>>();
      for (int i = 0; i < 20; i++) tasks.add(() -> transfer(a, key, wallet(b), "10000", ""));
      var results = new ArrayList<CommandStore.Terminal>();
      for (var f : pool.invokeAll(tasks)) results.add(f.get(20, TimeUnit.SECONDS));
      assertThat(results).allMatch(r -> r.equals(results.getFirst()));
      assertThat(balance(a)).isEqualTo(90000);
      assertThat(balance(b)).isEqualTo(10000);
      healthy();
    } finally {
      pool.shutdownNow();
    }
  }

  @Test
  void schemaCsrfAndBusinessRejectionsNeverMoveMoney() throws Exception {
    var a = actor();
    var b = actor();
    fund(a);
    long before = db.queryForObject("SELECT count(*) FROM money_commands", Long.class);
    for (String amount :
        List.of("0", "-1", "01", "1.0", "1e4", "10,000", "100000001", "9223372036854775808"))
      assertThat(
              postTransfer(a, UUID.randomUUID(), wallet(b), amount, "").getResponse().getStatus())
          .isEqualTo(400);
    assertThat(http(a, "bad", body(wallet(b), "1", "")).getResponse().getStatus()).isEqualTo(400);
    assertThat(
            http(a, UUID.randomUUID().toString(), body(wallet(b), "1", "").replace("\"1\"", "1"))
                .getResponse()
                .getStatus())
        .isEqualTo(400);
    assertThat(
            postTransfer(a, UUID.randomUUID(), wallet(b), "1", "x".repeat(141))
                .getResponse()
                .getStatus())
        .isEqualTo(400);
    assertThat(
            mvc.perform(
                    post("/api/v1/transfers")
                        .with(user(a))
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json")
                        .content(body(wallet(b), "1", "")))
                .andReturn()
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    assertThat(db.queryForObject("SELECT count(*) FROM money_commands", Long.class))
        .isEqualTo(before);
    assertThat(transfer(a, UUID.randomUUID(), wallet(a), "1", "").error().get("code"))
        .isEqualTo("SELF_TRANSFER");
    assertThat(transfer(a, UUID.randomUUID(), UUID.randomUUID(), "1", "").error().get("code"))
        .isEqualTo("RECIPIENT_NOT_FOUND");
    owner.update(
        "UPDATE ledger_accounts SET status='LOCKED' WHERE id=?",
        wallets.reference(b.id()).accountId());
    UUID key = UUID.randomUUID();
    var rejected = transfer(a, key, wallet(b), "1", "");
    assertThat(rejected.error().get("code")).isEqualTo("WALLET_LOCKED");
    owner.update(
        "UPDATE ledger_accounts SET status='ACTIVE' WHERE id=?",
        wallets.reference(b.id()).accountId());
    assertThat(transfer(a, key, wallet(b), "1", "")).isEqualTo(rejected);
    assertThat(balance(a)).isEqualTo(100000);
    assertThat(balance(b)).isZero();
    healthy();
  }

  @Test
  void faultAfterAuditRollsBackBothLegsAndCommand() throws Exception {
    var a = actor();
    var b = actor();
    fund(a);
    UUID key = UUID.randomUUID();
    var target =
        org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit);
    doAnswer(
            i -> {
              i.callRealMethod();
              throw new IllegalStateException("injected after transfer audit");
            })
        .when(target)
        .money(eq(a.id()), eq("TRANSFER"), any(), any(), any());
    assertThat(postTransfer(a, key, wallet(b), "10000", "").getResponse().getStatus())
        .isEqualTo(500);
    assertThat(balance(a)).isEqualTo(100000);
    assertThat(balance(b)).isZero();
    assertThatThrownBy(() -> commands.lookup(a.id(), "TRANSFER", key))
        .isInstanceOf(ApiFailure.class);
    healthy();
  }
}
