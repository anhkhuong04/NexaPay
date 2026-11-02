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
import vn.nexapay.funding.FundingService;
import vn.nexapay.identity.RegistrationTransaction;
import vn.nexapay.shared.*;
import vn.nexapay.wallet.WalletService;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class MerchantIntegrationTest {
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
  @Autowired org.springframework.transaction.PlatformTransactionManager manager;
  @Autowired vn.nexapay.ledger.MoneyPostingService posting;
  @MockitoSpyBean AuditService audit;

  ActorPrincipal actor() {
    String email = UUID.randomUUID() + "@example.test";
    UUID id =
        registration
            .create(email, "{bcrypt}test-only-unusable", "Owner demo", UUID.randomUUID().toString())
            .userId();
    return new ActorPrincipal(id, email, "", List.of("INDIVIDUAL"), true);
  }

  MvcResult create(ActorPrincipal a, String name) throws Exception {
    return mvc.perform(
            post("/api/v1/merchants")
                .with(user(a))
                .with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(Map.of("displayName", name))))
        .andReturn();
  }

  JsonNode created(ActorPrincipal a) throws Exception {
    var r = create(a, "  Cửa hàng Demo  ");
    assertThat(r.getResponse().getStatus()).isEqualTo(201);
    return json.readTree(r.getResponse().getContentAsByteArray());
  }

  JsonNode getJson(ActorPrincipal a, String path, int status) throws Exception {
    var r = mvc.perform(get("/api/v1" + path).with(user(a))).andReturn().getResponse();
    assertThat(r.getStatus()).isEqualTo(status);
    return json.readTree(r.getContentAsByteArray());
  }

  JdbcTemplate owner() {
    return new JdbcTemplate(
        new DriverManagerDataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword()));
  }

  @Test
  void onboardingCreatesOneOwnedActiveZeroGraphWithoutTouchingPersonal() throws Exception {
    var a = actor();
    var before = wallets.own(a.id());
    var journals = db.queryForObject("SELECT count(*) FROM ledger_transactions", Long.class);
    var c = created(a);
    var id = c.get("id").asText();
    assertThat(c.get("displayName").asText()).isEqualTo("Cửa hàng Demo");
    assertThat(c.get("status").asText()).isEqualTo("ACTIVE");
    assertThat(getJson(a, "/merchants/me", 200)).isEqualTo(c);
    assertThat(getJson(a, "/merchants/" + id, 200)).isEqualTo(c);
    var w = getJson(a, "/merchants/" + id + "/wallet", 200);
    assertThat(w.get("availableBalance").asText()).isEqualTo("0");
    assertThat(w.get("heldBalance").asText()).isEqualTo("0");
    assertThat(w.get("id").asText()).isNotEqualTo(before.id().toString());
    assertThat(wallets.own(a.id())).isEqualTo(before);
    assertThat(db.queryForObject("SELECT count(*) FROM ledger_transactions", Long.class))
        .isEqualTo(journals);
    assertThat(
            db.queryForObject(
                "SELECT account_type FROM ledger_accounts WHERE id=(SELECT ledger_account_id FROM wallets WHERE merchant_id=?::uuid)",
                String.class,
                id))
        .isEqualTo("MERCHANT");
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM audit_events WHERE actor_id=? AND action='MERCHANT_ONBOARDED'",
                Long.class,
                a.id()))
        .isEqualTo(1);
    assertThat(db.queryForList("SELECT * FROM reconciliation_findings()")).isEmpty();
  }

  @Test
  void ownershipValidationCsrfAndOverpostingAreEnforced() throws Exception {
    var a = actor();
    var b = actor();
    getJson(a, "/merchants/me", 404);
    assertThat(mvc.perform(get("/api/v1/merchants/me")).andReturn().getResponse().getStatus())
        .isEqualTo(401);
    assertThat(
            mvc.perform(
                    post("/api/v1/merchants")
                        .with(user(a))
                        .contentType("application/json")
                        .content("{\"displayName\":\"Demo\"}"))
                .andReturn()
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    for (var name : List.of(" ", "a".repeat(81), "bad\nname"))
      assertThat(create(a, name).getResponse().getStatus()).isEqualTo(400);
    for (var field : List.of("ownerId", "role", "status", "balance")) {
      var r =
          mvc.perform(
                  post("/api/v1/merchants")
                      .with(user(a))
                      .with(csrf())
                      .contentType("application/json")
                      .content(
                          json.writeValueAsString(Map.of("displayName", "Demo", field, "ADMIN"))))
              .andReturn();
      assertThat(r.getResponse().getStatus()).isEqualTo(400);
    }
    var id = created(a).get("id").asText();
    getJson(b, "/merchants/" + id, 404);
    getJson(b, "/merchants/" + id + "/wallet", 404);
    var patch =
        patch("/api/v1/merchants/" + id)
            .with(user(b))
            .with(csrf())
            .contentType("application/json")
            .content("{\"displayName\":\"Hacked\"}");
    assertThat(mvc.perform(patch).andReturn().getResponse().getStatus()).isEqualTo(404);
    assertThat(db.queryForList("SELECT role FROM user_roles WHERE user_id=?", a.id()))
        .doesNotContain(Map.of("role", "ADMIN"));
  }

  @Test
  void renameIsOwnedAuditedNormalizedAndLockedWalletRemainsReadable() throws Exception {
    var a = actor();
    var c = created(a);
    var id = c.get("id").asText();
    var r =
        mvc.perform(
                patch("/api/v1/merchants/" + id)
                    .with(user(a))
                    .with(csrf())
                    .contentType("application/json")
                    .content(json.writeValueAsString(Map.of("displayName", "  Cafe\u0301 Demo  "))))
            .andReturn()
            .getResponse();
    assertThat(r.getStatus()).isEqualTo(200);
    assertThat(json.readTree(r.getContentAsByteArray()).get("displayName").asText())
        .isEqualTo("Café Demo");
    owner()
        .update(
            "UPDATE ledger_accounts SET status='LOCKED' WHERE id=(SELECT ledger_account_id FROM wallets WHERE merchant_id=?::uuid)",
            id);
    assertThat(getJson(a, "/merchants/" + id + "/wallet", 200).get("status").asText())
        .isEqualTo("LOCKED");
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM audit_events WHERE resource_id=?::uuid AND action='MERCHANT_RENAMED'",
                Long.class,
                id))
        .isEqualTo(1);
  }

  @Test
  void concurrentOnboardingHasExactlyOneWinnerAndNoOrphans() throws Exception {
    var a = actor();
    long accounts = db.queryForObject("SELECT count(*) FROM ledger_accounts", Long.class);
    try (var pool = Executors.newFixedThreadPool(8)) {
      var start = new CountDownLatch(1);
      List<Future<Integer>> tasks = new ArrayList<>();
      for (int i = 0; i < 8; i++)
        tasks.add(
            pool.submit(
                () -> {
                  start.await();
                  return create(a, "Concurrent").getResponse().getStatus();
                }));
      start.countDown();
      List<Integer> statuses = new ArrayList<>();
      for (var t : tasks) statuses.add(t.get(20, TimeUnit.SECONDS));
      assertThat(statuses).containsOnly(201, 409);
      assertThat(statuses.stream().filter(s -> s == 201)).hasSize(1);
    }
    assertThat(db.queryForObject("SELECT count(*) FROM ledger_accounts", Long.class))
        .isEqualTo(accounts + 1);
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM merchant_memberships WHERE user_id=?", Long.class, a.id()))
        .isEqualTo(1);
    assertThat(create(a, "Changed").getResponse().getStatus()).isEqualTo(409);
    assertThat(getJson(a, "/merchants/me", 200).get("displayName").asText())
        .isEqualTo("Concurrent");
  }

  @Test
  void auditFailureRollsBackWholeMerchantGraphAndRename() throws Exception {
    var a = actor();
    long accounts = db.queryForObject("SELECT count(*) FROM ledger_accounts", Long.class);
    doThrow(new IllegalStateException("fault"))
        .when(
            org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit))
        .record(eq(a.id()), eq("MERCHANT_ONBOARDED"), any(), anyString());
    try {
      assertThat(create(a, "Fault").getResponse().getStatus()).isEqualTo(500);
    } finally {
      reset(
          org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit));
    }
    getJson(a, "/merchants/me", 404);
    assertThat(db.queryForObject("SELECT count(*) FROM ledger_accounts", Long.class))
        .isEqualTo(accounts);
    var id = created(a).get("id").asText();
    doThrow(new IllegalStateException("fault"))
        .when(
            org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit))
        .record(eq(a.id()), eq("MERCHANT_RENAMED"), any(), anyString());
    try {
      assertThat(
              mvc.perform(
                      patch("/api/v1/merchants/" + id)
                          .with(user(a))
                          .with(csrf())
                          .contentType("application/json")
                          .content("{\"displayName\":\"Fault rename\"}"))
                  .andReturn()
                  .getResponse()
                  .getStatus())
          .isEqualTo(500);
    } finally {
      reset(
          org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit));
    }
    assertThat(getJson(a, "/merchants/me", 200).get("displayName").asText())
        .isEqualTo("Cửa hàng Demo");
  }

  @Test
  void merchantCannotReceiveP2pAndFundingStaysPersonalOnly() throws Exception {
    var a = actor();
    var id = created(a).get("id").asText();
    var wallet = getJson(a, "/merchants/" + id + "/wallet", 200).get("id").asText();
    assertThat(wallets.recipient(UUID.fromString(wallet))).isEmpty();
    assertThat(funding.fund(a.id(), UUID.randomUUID(), "test").status()).isEqualTo("SUCCEEDED");
    assertThat(wallets.own(a.id()).availableBalance()).isEqualTo("100000");
    assertThat(getJson(a, "/merchants/" + id + "/wallet", 200).get("availableBalance").asText())
        .isEqualTo("0");
    var r =
        mvc.perform(
                post("/api/v1/transfers")
                    .with(user(a))
                    .with(csrf())
                    .header("Idempotency-Key", UUID.randomUUID())
                    .contentType("application/json")
                    .content(
                        json.writeValueAsString(
                            Map.of(
                                "destinationWalletId",
                                wallet,
                                "amount",
                                "1",
                                "currency",
                                "VND",
                                "note",
                                ""))))
            .andReturn()
            .getResponse();
    assertThat(r.getStatus()).isEqualTo(422);
    assertThat(json.readTree(r.getContentAsByteArray()).path("error").path("code").asText())
        .isEqualTo("RECIPIENT_NOT_FOUND");
    assertThat(wallets.own(a.id()).availableBalance()).isEqualTo("100000");
  }

  @Test
  void databaseRejectsIncompleteGraphWrongOwnershipAndMerchantBalanceViolations() throws Exception {
    var a = actor();
    var m = created(a).get("id").asText();
    assertThatThrownBy(
            () ->
                db.update(
                    "INSERT INTO merchants(id,display_name) VALUES(?,?)",
                    UUID.randomUUID(),
                    "Orphan"))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                db.update(
                    "INSERT INTO wallets(id,user_id,merchant_id,ledger_account_id) VALUES(?,?,?::uuid,?)",
                    UUID.randomUUID(),
                    a.id(),
                    m,
                    UUID.randomUUID()))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    var w = getJson(a, "/merchants/" + m + "/wallet", 200);
    var account =
        db.queryForObject(
            "SELECT ledger_account_id FROM wallets WHERE id=?::uuid",
            UUID.class,
            w.get("id").asText());
    for (long value : List.of(-1L, 1000000000001L))
      assertThatThrownBy(
              () ->
                  owner()
                      .update(
                          "UPDATE ledger_accounts SET posted_balance=? WHERE id=?", value, account))
          .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () -> db.update("UPDATE ledger_accounts SET posted_balance=1 WHERE id=?", account))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(() -> db.update("UPDATE merchants SET status='LOCKED' WHERE id=?::uuid", m))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(
            () ->
                db.update(
                    "UPDATE merchant_memberships SET user_id=? WHERE merchant_id=?::uuid",
                    actor().id(),
                    m))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    var tx = new org.springframework.transaction.support.TransactionTemplate(manager);
    UUID issuance =
        db.queryForObject("SELECT issuance_account_id FROM demo_environment", UUID.class);
    assertThatThrownBy(
            () ->
                tx.execute(
                    status -> {
                      posting.post(
                          "TEST",
                          UUID.randomUUID(),
                          List.of(
                              new vn.nexapay.ledger.MoneyPostingService.Entry(account, -1),
                              new vn.nexapay.ledger.MoneyPostingService.Entry(issuance, 1)));
                      return null;
                    }))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("Customer balance limit");
    assertThat(db.queryForList("SELECT * FROM reconciliation_findings()")).isEmpty();
  }

  @Test
  void walletKindAndMembershipUniqueConstraintsProtectRawAppInserts() throws Exception {
    var a = actor();
    var b = actor();
    var m = created(a).get("id").asText();
    var tx = new org.springframework.transaction.support.TransactionTemplate(manager);
    UUID unprovisioned = UUID.randomUUID();
    db.update(
        "INSERT INTO users(id,email,password_hash) VALUES(?,?,?)",
        unprovisioned,
        unprovisioned + "@example.test",
        "fixture");
    assertThatThrownBy(
            () ->
                tx.execute(
                    status -> {
                      UUID id = UUID.randomUUID();
                      db.update(
                          "INSERT INTO ledger_accounts(id,account_type) VALUES(?,'MERCHANT')", id);
                      db.update(
                          "INSERT INTO wallets(id,user_id,ledger_account_id) VALUES(?,?,?)",
                          UUID.randomUUID(),
                          unprovisioned,
                          id);
                      return null;
                    }))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                db.update(
                    "INSERT INTO merchant_memberships(merchant_id,user_id) VALUES(?::uuid,?)",
                    m,
                    b.id()))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThat(wallets.own(b.id()).availableBalance()).isEqualTo("0");
  }

  @Test
  void sessionSummaryRefreshesMembershipWithoutGrantingAdminOrRelogin() throws Exception {
    var a = actor();
    var session = new org.springframework.mock.web.MockHttpSession();
    session.setAttribute(vn.nexapay.identity.SessionExpiryFilter.AUTHENTICATED_AT, Instant.now());
    session.setAttribute(vn.nexapay.identity.SessionExpiryFilter.LAST_SEEN, Instant.now());
    var before =
        mvc.perform(get("/api/v1/auth/session").with(user(a)).session(session))
            .andReturn()
            .getResponse();
    assertThat(json.readTree(before.getContentAsByteArray()).path("roles").toString())
        .doesNotContain("MERCHANT");
    var id = created(a).get("id").asText();
    var after =
        mvc.perform(get("/api/v1/auth/session").with(user(a)).session(session))
            .andReturn()
            .getResponse();
    assertThat(after.getStatus()).isEqualTo(200);
    var data = json.readTree(after.getContentAsByteArray());
    assertThat(data.path("merchantId").asText()).isEqualTo(id);
    assertThat(data.path("roles").toString()).contains("MERCHANT").doesNotContain("ADMIN");
  }

  @Test
  void upgradeFromV3PreservesExistingWalletAuditAndMigrationChecksums() {
    String name = "upgrade_" + UUID.randomUUID().toString().replace("-", "");
    owner().execute("CREATE DATABASE " + name);
    String url = pg.getJdbcUrl().replace("/nexapay", "/" + name);
    var flyway =
        org.flywaydb.core.Flyway.configure()
            .dataSource(url, pg.getUsername(), pg.getPassword())
            .target("3")
            .load();
    flyway.migrate();
    var old =
        new JdbcTemplate(new DriverManagerDataSource(url, pg.getUsername(), pg.getPassword()));
    UUID u = UUID.randomUUID(), a = UUID.randomUUID(), w = UUID.randomUUID();
    old.update(
        "INSERT INTO users(id,email,password_hash) VALUES(?,?,'test')", u, name + "@example.test");
    old.update("INSERT INTO ledger_accounts(id,account_type) VALUES(?,'PERSONAL')", a);
    old.update("INSERT INTO wallets(id,user_id,ledger_account_id) VALUES(?,?,?)", w, u, a);
    old.update(
        "INSERT INTO audit_events(id,actor_id,action,resource_id,outcome,correlation_id) VALUES(?,?,'REGISTERED',?,'SUCCEEDED',?)",
        UUID.randomUUID(),
        u,
        w,
        UUID.randomUUID().toString());
    var checks =
        old.queryForList(
            "SELECT version,checksum FROM flyway_schema_history WHERE version IS NOT NULL ORDER BY installed_rank");
    org.flywaydb.core.Flyway.configure()
        .dataSource(url, pg.getUsername(), pg.getPassword())
        .load()
        .migrate();
    assertThat(
            old.queryForList(
                "SELECT version,checksum FROM flyway_schema_history WHERE version IN ('1','2','3') ORDER BY installed_rank"))
        .isEqualTo(checks);
    assertThat(
            old.queryForObject(
                "SELECT ledger_account_id FROM wallets WHERE id=? AND user_id=? AND merchant_id IS NULL",
                UUID.class,
                w,
                u))
        .isEqualTo(a);
    assertThat(
            old.queryForObject(
                "SELECT posted_balance FROM ledger_accounts WHERE id=?", Long.class, a))
        .isZero();
    assertThat(
            old.queryForObject("SELECT count(*) FROM audit_events WHERE actor_id=?", Long.class, u))
        .isEqualTo(1);
    assertThat(old.queryForList("SELECT * FROM reconciliation_findings()")).isEmpty();
  }
}
