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
class PaymentIntegrationTest {
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
  @Autowired vn.nexapay.ledger.MoneyPostingService posting;
  @Autowired org.springframework.transaction.PlatformTransactionManager manager;
  @MockitoSpyBean AuditService audit;

  ActorPrincipal actor() {
    String email = UUID.randomUUID() + "@example.test";
    UUID id =
        registration
            .create(
                email, "{bcrypt}test-only-unusable", "Payment demo", UUID.randomUUID().toString())
            .userId();
    return new ActorPrincipal(id, email, "", List.of("INDIVIDUAL"), true);
  }

  JsonNode node(MvcResult r) throws Exception {
    return json.readTree(r.getResponse().getContentAsByteArray());
  }

  MvcResult postJson(ActorPrincipal actor, String path, UUID key, Object body) throws Exception {
    var request =
        post("/api/v1" + path)
            .with(user(actor))
            .with(csrf())
            .contentType("application/json")
            .content(json.writeValueAsString(body));
    if (key != null) request.header("Idempotency-Key", key);
    return mvc.perform(request).andReturn();
  }

  UUID merchant(ActorPrincipal a) throws Exception {
    var r = postJson(a, "/merchants", null, Map.of("displayName", "Merchant payment demo"));
    assertThat(r.getResponse().getStatus()).isEqualTo(201);
    return UUID.fromString(node(r).get("id").asText());
  }

  Map<String, Object> requestBody(String amount) {
    return Map.of(
        "amount",
        amount,
        "currency",
        "VND",
        "description",
        "  Cafe\u0301 demo  ",
        "expiryMinutes",
        30);
  }

  JsonNode create(ActorPrincipal a, UUID m, String amount) throws Exception {
    var r =
        postJson(
            a, "/merchants/" + m + "/payment-requests", UUID.randomUUID(), requestBody(amount));
    assertThat(r.getResponse().getStatus()).isEqualTo(201);
    return node(r);
  }

  JsonNode pay(ActorPrincipal a, JsonNode request, UUID key, String amount) throws Exception {
    var r =
        postJson(
            a,
            "/checkout/" + request.get("publicRef").asText() + "/pay",
            key,
            Map.of("amount", amount, "currency", "VND"));
    assertThat(r.getResponse().getStatus()).isIn(201, 422);
    return node(r);
  }

  JsonNode getNode(ActorPrincipal a, String path, int status) throws Exception {
    var req = get("/api/v1" + path);
    if (a != null) req.with(user(a));
    var r = mvc.perform(req).andReturn();
    assertThat(r.getResponse().getStatus()).isEqualTo(status);
    return node(r);
  }

  void fund(ActorPrincipal a) {
    assertThat(funding.fund(a.id(), UUID.randomUUID(), "test").status()).isEqualTo("SUCCEEDED");
  }

  long balance(ActorPrincipal a) {
    return Long.parseLong(wallets.own(a.id()).availableBalance());
  }

  JdbcTemplate owner() {
    return new JdbcTemplate(
        new DriverManagerDataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword()));
  }

  void healthy() {
    assertThat(db.queryForList("SELECT * FROM reconciliation_findings()")).isEmpty();
  }

  @Test
  void requestCreationReplayValidationPublicPrivacyAndOwnerPaging() throws Exception {
    var a = actor();
    var m = merchant(a);
    var key = UUID.randomUUID();
    var path = "/merchants/" + m + "/payment-requests";
    var r = postJson(a, path, key, requestBody("10000"));
    assertThat(r.getResponse().getStatus()).isEqualTo(201);
    var first = node(r);
    assertThat(node(postJson(a, path, key, requestBody("10000")))).isEqualTo(first);
    assertThat(postJson(a, path, key, requestBody("10001")).getResponse().getStatus())
        .isEqualTo(409);
    assertThat(first.path("description").asText()).isEqualTo("Café demo");
    assertThat(getNode(a, path + "/by-key/" + key, 200)).isEqualTo(first);
    assertThat(
            Duration.between(
                Instant.parse(first.path("createdAt").asText()),
                Instant.parse(first.path("expiresAt").asText())))
        .isEqualTo(Duration.ofMinutes(30));
    var publicView = getNode(null, "/checkout/" + first.path("publicRef").asText(), 200);
    assertThat(publicView.toString())
        .doesNotContain("creationKey", "command", "payer", "email", "walletId", "merchantId");
    for (Object value : List.of(4, 1441, 5.9, "30")) {
      var body = new HashMap<String, Object>(requestBody("10000"));
      body.put("expiryMinutes", value);
      assertThat(postJson(a, path, UUID.randomUUID(), body).getResponse().getStatus())
          .isEqualTo(400);
    }
    for (Object value : List.of(10000, "0", "1e4", "100000001")) {
      var body = new HashMap<String, Object>(requestBody("10000"));
      body.put("amount", value);
      assertThat(postJson(a, path, UUID.randomUUID(), body).getResponse().getStatus())
          .isEqualTo(400);
    }
    var b = actor();
    getNode(b, path, 404);
    getNode(b, path + "/" + first.path("id").asText(), 404);
    assertThat(
            postJson(b, path + "/" + first.path("id").asText() + "/cancel", null, Map.of())
                .getResponse()
                .getStatus())
        .isEqualTo(404);
    create(a, m, "20000");
    var page = getNode(a, path + "?limit=1&status=PENDING", 200);
    assertThat(page.path("items")).hasSize(1);
    assertThat(
            getNode(a, path + "?limit=1&cursor=" + page.path("nextCursor").asText(), 200)
                .path("items"))
        .hasSize(1);
    getNode(a, path + "?status=FAILED", 400);
    getNode(a, path + "?limit=0", 400);
    getNode(a, path + "?cursor=bad", 400);
    String outside =
        Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(
                ("+999999999-01-01T00:00:00Z|" + UUID.randomUUID())
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8));
    getNode(a, path + "?cursor=" + outside, 400);
    healthy();
  }

  @Test
  void paymentPostsExactlyTwoLegsAndReplaysBeforeCurrentStateChecks() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    fund(a);
    var req = create(o, m, "10000");
    var key = UUID.randomUUID();
    var paid = pay(a, req, key, "10000");
    assertThat(paid.path("status").asText()).isEqualTo("SUCCEEDED");
    assertThat(balance(a)).isEqualTo(90000);
    assertThat(wallets.merchant(m).availableBalance()).isEqualTo("10000");
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM ledger_entries WHERE transaction_id=?::uuid",
                Long.class,
                paid.path("result").path("ledgerTransactionId").asText()))
        .isEqualTo(2);
    owner()
        .update(
            "UPDATE ledger_accounts SET status='LOCKED' WHERE id=(SELECT ledger_account_id FROM wallets WHERE user_id=?)",
            a.id());
    assertThat(pay(a, req, key, "10000")).isEqualTo(paid);
    assertThat(
            postJson(
                    a,
                    "/checkout/" + req.path("publicRef").asText() + "/pay",
                    key,
                    Map.of("amount", "10001", "currency", "VND"))
                .getResponse()
                .getStatus())
        .isEqualTo(409);
    assertThat(
            getNode(o, "/merchants/" + m + "/payment-requests/" + req.path("id").asText(), 200)
                .path("status")
                .asText())
        .isEqualTo("PAID");
    assertThat(getNode(a, "/commands/PAYMENT/" + key, 200)).isEqualTo(paid);
    getNode(o, "/commands/PAYMENT/" + key, 404);
    healthy();
  }

  @Test
  void failedAttemptDoesNotCloseRequestAndOriginalRejectionStaysImmutable() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    var req = create(o, m, "10000");
    var key = UUID.randomUUID();
    var failed = pay(a, req, key, "10000");
    assertThat(failed.path("error").path("code").asText()).isEqualTo("INSUFFICIENT_FUNDS");
    assertThat(
            getNode(null, "/checkout/" + req.path("publicRef").asText(), 200)
                .path("status")
                .asText())
        .isEqualTo("PENDING");
    fund(a);
    assertThat(pay(a, req, key, "10000")).isEqualTo(failed);
    assertThat(pay(a, req, UUID.randomUUID(), "10000").path("status").asText())
        .isEqualTo("SUCCEEDED");
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM payment_attempts WHERE request_id=?::uuid",
                Long.class,
                req.path("id").asText()))
        .isEqualTo(2);
    healthy();
  }

  @Test
  void sameKeyAndDifferentPayersCannotCaptureTwice() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    fund(a);
    var req = create(o, m, "10000");
    var key = UUID.randomUUID();
    try (var pool = Executors.newFixedThreadPool(8)) {
      var start = new CountDownLatch(1);
      List<Future<JsonNode>> futures = new ArrayList<>();
      for (int i = 0; i < 20; i++)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  return pay(a, req, key, "10000");
                }));
      start.countDown();
      JsonNode first = futures.getFirst().get(30, TimeUnit.SECONDS);
      for (var f : futures) assertThat(f.get(30, TimeUnit.SECONDS)).isEqualTo(first);
    }
    assertThat(balance(a)).isEqualTo(90000);
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM payments WHERE request_id=?::uuid",
                Long.class,
                req.path("id").asText()))
        .isEqualTo(1);
    var other = create(o, m, "10000");
    List<ActorPrincipal> actors = new ArrayList<>();
    for (int i = 0; i < 8; i++) {
      var b = actor();
      fund(b);
      actors.add(b);
    }
    try (var pool = Executors.newFixedThreadPool(8)) {
      var start = new CountDownLatch(1);
      List<Future<JsonNode>> futures = new ArrayList<>();
      for (var b : actors)
        futures.add(
            pool.submit(
                () -> {
                  start.await();
                  return pay(b, other, UUID.randomUUID(), "10000");
                }));
      start.countDown();
      int successes = 0;
      for (var f : futures)
        if (f.get(30, TimeUnit.SECONDS).path("status").asText().equals("SUCCEEDED")) successes++;
      assertThat(successes).isEqualTo(1);
    }
    assertThat(actors.stream().mapToLong(this::balance).sum()).isEqualTo(790000);
    assertThat(wallets.merchant(m).availableBalance()).isEqualTo("20000");
    healthy();
  }

  @Test
  void selfLockedAndWrongAmountRejectionsNeverPostMoney() throws Exception {
    var o = actor();
    var m = merchant(o);
    fund(o);
    var req = create(o, m, "10000");
    assertThat(pay(o, req, UUID.randomUUID(), "10000").path("error").path("code").asText())
        .isEqualTo("SELF_PAYMENT");
    var a = actor();
    fund(a);
    assertThat(pay(a, req, UUID.randomUUID(), "9999").path("error").path("code").asText())
        .isEqualTo("AMOUNT_MISMATCH");
    owner()
        .update(
            "UPDATE ledger_accounts SET status='LOCKED' WHERE id=(SELECT ledger_account_id FROM wallets WHERE merchant_id=?)",
            m);
    assertThat(pay(a, req, UUID.randomUUID(), "10000").path("error").path("code").asText())
        .isEqualTo("WALLET_LOCKED");
    assertThat(balance(a)).isEqualTo(100000);
    assertThat(wallets.merchant(m).availableBalance()).isEqualTo("0");
    healthy();
  }

  @Test
  void payCancelRaceHasOneConsistentTerminalWinner() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    fund(a);
    for (int i = 0; i < 5; i++) {
      var req = create(o, m, "1000");
      try (var pool = Executors.newFixedThreadPool(2)) {
        var start = new CountDownLatch(1);
        var p =
            pool.submit(
                () -> {
                  start.await();
                  return pay(a, req, UUID.randomUUID(), "1000");
                });
        var c =
            pool.submit(
                () -> {
                  start.await();
                  return postJson(
                      o,
                      "/merchants/"
                          + m
                          + "/payment-requests/"
                          + req.path("id").asText()
                          + "/cancel",
                      null,
                      Map.of());
                });
        start.countDown();
        var result = p.get(20, TimeUnit.SECONDS);
        assertThat(c.get(20, TimeUnit.SECONDS).getResponse().getStatus()).isEqualTo(200);
        var status =
            getNode(null, "/checkout/" + req.path("publicRef").asText(), 200)
                .path("status")
                .asText();
        assertThat(status)
            .isEqualTo(result.path("status").asText().equals("SUCCEEDED") ? "PAID" : "CANCELLED");
      }
    }
    healthy();
  }

  @Test
  void expiryUsesActualDatabaseClockAfterObtainingRequestLock() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    fund(a);
    UUID id = UUID.randomUUID(), ref = UUID.randomUUID();
    owner()
        .update(
            "INSERT INTO payment_requests(id,public_ref,merchant_id,creator_id,merchant_name,amount,currency,description,creation_key,fingerprint,created_at,expires_at) VALUES(?,?,?,?,'Expiry demo',1000,'VND','Expiry fixture',?,'fixture',clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '1 second')",
            id,
            ref,
            m,
            o.id(),
            UUID.randomUUID());
    JsonNode req =
        json.createObjectNode().put("id", id.toString()).put("publicRef", ref.toString());
    try (var connection =
            DriverManager.getConnection(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword());
        var pool = Executors.newSingleThreadExecutor()) {
      connection.setAutoCommit(false);
      try (var stmt =
          connection.prepareStatement("SELECT id FROM payment_requests WHERE id=? FOR UPDATE")) {
        stmt.setObject(1, id);
        stmt.executeQuery();
      }
      var started = new CountDownLatch(1);
      var waiting =
          pool.submit(
              () -> {
                started.countDown();
                return pay(a, req, UUID.randomUUID(), "1000");
              });
      started.await();
      Thread.sleep(1300);
      connection.commit();
      assertThat(waiting.get(20, TimeUnit.SECONDS).path("error").path("code").asText())
          .isEqualTo("REQUEST_EXPIRED");
    }
    assertThat(getNode(null, "/checkout/" + ref, 200).path("status").asText()).isEqualTo("EXPIRED");
    assertThat(balance(a)).isEqualTo(100000);
    healthy();
  }

  @Test
  void auditFaultRollsBackRequestPaymentBothLegsAndCommand() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    fund(a);
    var req = create(o, m, "10000");
    var key = UUID.randomUUID();
    doThrow(new IllegalStateException("audit fault"))
        .when(
            org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit))
        .money(eq(a.id()), eq("PAYMENT"), any(), anyString(), anyString());
    try {
      assertThat(
              postJson(
                      a,
                      "/checkout/" + req.path("publicRef").asText() + "/pay",
                      key,
                      Map.of("amount", "10000", "currency", "VND"))
                  .getResponse()
                  .getStatus())
          .isEqualTo(500);
    } finally {
      reset(
          org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit));
    }
    assertThat(balance(a)).isEqualTo(100000);
    assertThat(wallets.merchant(m).availableBalance()).isEqualTo("0");
    getNode(a, "/commands/PAYMENT/" + key, 404);
    assertThat(
            getNode(null, "/checkout/" + req.path("publicRef").asText(), 200)
                .path("status")
                .asText())
        .isEqualTo("PENDING");
    assertThat(pay(a, req, key, "10000").path("status").asText()).isEqualTo("SUCCEEDED");
    healthy();
  }

  @Test
  void payerHistoryAndBusinessPaymentsHaveIndependentOwnershipAndNoFailedPayerLeak()
      throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    var b = actor();
    var req = create(o, m, "10000");
    var failed = pay(b, req, UUID.randomUUID(), "10000");
    fund(a);
    var paid = pay(a, req, UUID.randomUUID(), "10000");
    getNode(a, "/transactions/PAYMENT/" + paid.path("resourceId").asText(), 200);
    getNode(o, "/transactions/PAYMENT/" + paid.path("resourceId").asText(), 404);
    getNode(a, "/transactions/PAYMENT/" + failed.path("resourceId").asText(), 404);
    var business = getNode(o, "/merchants/" + m + "/payments", 200);
    assertThat(business.path("items")).hasSize(1);
    assertThat(business.toString())
        .doesNotContain(
            a.getUsername(),
            b.getUsername(),
            "INSUFFICIENT_FUNDS",
            failed.path("resourceId").asText());
    getNode(b, "/merchants/" + m + "/payments", 404);
    var stats = getNode(o, "/merchants/" + m + "/payments/summary", 200);
    assertThat(stats.path("paidToday").asLong()).isEqualTo(1);
    assertThat(stats.path("receivedToday").asText()).isEqualTo("10000");
    healthy();
  }

  @Test
  void databaseRejectsMutableRequestAndIncompletePaidState() throws Exception {
    var o = actor();
    var m = merchant(o);
    var req = create(o, m, "10000");
    String id = req.path("id").asText();
    assertThatThrownBy(
            () -> owner().update("UPDATE payment_requests SET amount=1 WHERE id=?::uuid", id))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                owner()
                    .update(
                        "UPDATE payment_requests SET status='PAID',state_changed_at=clock_timestamp() WHERE id=?::uuid",
                        id))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(
            () ->
                db.update("UPDATE payment_requests SET description='Hacked' WHERE id=?::uuid", id))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    var tx = new org.springframework.transaction.support.TransactionTemplate(manager);
    assertThatThrownBy(
            () ->
                tx.execute(
                    s -> {
                      commands.claim(
                          o.id(), "PAYMENT", UUID.randomUUID(), "incomplete", Instant.now());
                      return null;
                    }))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    healthy();
  }

  @Test
  void rawRequestCannotClaimAnotherMerchantCreator() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    assertThatThrownBy(
            () ->
                db.update(
                    "INSERT INTO payment_requests(id,public_ref,merchant_id,creator_id,merchant_name,amount,currency,description,creation_key,fingerprint,created_at,expires_at) VALUES(?,?,?,?,'Wrong owner',1,'VND','Fixture',?,'fixture',clock_timestamp(),clock_timestamp()+interval '30 minutes')",
                    UUID.randomUUID(),
                    UUID.randomUUID(),
                    m,
                    a.id(),
                    UUID.randomUUID()))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    healthy();
  }

  @Test
  void authenticationCsrfAndStrictPaySchemaDoNotClaimCommands() throws Exception {
    var o = actor();
    var m = merchant(o);
    var req = create(o, m, "10000");
    var a = actor();
    String path = "/api/v1/checkout/" + req.path("publicRef").asText() + "/pay";
    assertThat(
            mvc.perform(
                    post(path)
                        .with(user(a))
                        .contentType("application/json")
                        .content("{\"amount\":\"10000\",\"currency\":\"VND\"}"))
                .andReturn()
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    assertThat(
            mvc.perform(
                    post(path)
                        .with(csrf())
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json")
                        .content("{\"amount\":\"10000\",\"currency\":\"VND\"}"))
                .andReturn()
                .getResponse()
                .getStatus())
        .isEqualTo(401);
    for (var body :
        List.of(
            Map.of("amount", 10000, "currency", "VND"),
            Map.of("amount", "10000", "currency", "VND", "actorId", a.id().toString()))) {
      assertThat(postJson(a, path.substring(7), UUID.randomUUID(), body).getResponse().getStatus())
          .isEqualTo(400);
    }
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM money_commands WHERE actor_id=?", Long.class, a.id()))
        .isZero();
  }

  @Test
  void acceptedPayCanCommitAfterExpiryAndLateObserverCannotOverridePaid() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    fund(a);
    UUID id = UUID.randomUUID(), ref = UUID.randomUUID();
    owner()
        .update(
            "INSERT INTO payment_requests(id,public_ref,merchant_id,creator_id,merchant_name,amount,currency,description,creation_key,fingerprint,created_at,expires_at) VALUES(?,?,?,?,'Accepted demo',1000,'VND','Accepted fixture',?,'fixture',clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '1 second')",
            id,
            ref,
            m,
            o.id(),
            UUID.randomUUID());
    var req = json.createObjectNode().put("id", id.toString()).put("publicRef", ref.toString());
    var accepted = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    doAnswer(
            invocation -> {
              accepted.countDown();
              if (!release.await(4, TimeUnit.SECONDS))
                throw new IllegalStateException("test gate timeout");
              return invocation.callRealMethod();
            })
        .when(
            org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit))
        .money(eq(a.id()), eq("PAYMENT"), any(), anyString(), anyString());
    try (var pool = Executors.newFixedThreadPool(2)) {
      var p = pool.submit(() -> pay(a, req, UUID.randomUUID(), "1000"));
      assertThat(accepted.await(3, TimeUnit.SECONDS)).isTrue();
      Thread.sleep(1100);
      var observer = pool.submit(() -> getNode(null, "/checkout/" + ref, 200));
      release.countDown();
      assertThat(p.get(10, TimeUnit.SECONDS).path("status").asText()).isEqualTo("SUCCEEDED");
      assertThat(observer.get(10, TimeUnit.SECONDS).path("status").asText()).isEqualTo("PAID");
    } finally {
      release.countDown();
      reset(
          org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit));
    }
    assertThat(balance(a)).isEqualTo(99000);
    healthy();
  }

  @Test
  void mismatchedPaymentLegsCannotCommitAndOrphanPostingIsDetectedWithoutRepair() throws Exception {
    var o = actor();
    var m = merchant(o);
    var a = actor();
    fund(a);
    var req = create(o, m, "10000");
    UUID request = UUID.fromString(req.path("id").asText());
    var source = wallets.reference(a.id());
    var dest = wallets.merchantReference(m);
    var tx = new org.springframework.transaction.support.TransactionTemplate(manager);
    assertThatThrownBy(
            () ->
                tx.execute(
                    status -> {
                      UUID attempt = UUID.randomUUID(), payId = UUID.randomUUID();
                      var now = db.queryForObject("SELECT clock_timestamp()", Timestamp.class);
                      var claim =
                          commands.claim(
                              a.id(), "PAYMENT", UUID.randomUUID(), "fixture", now.toInstant());
                      UUID journal =
                          posting.post(
                              "PAYMENT",
                              payId,
                              List.of(
                                  new vn.nexapay.ledger.MoneyPostingService.Entry(
                                      source.accountId(), -9999),
                                  new vn.nexapay.ledger.MoneyPostingService.Entry(
                                      dest.accountId(), 9999)));
                      assertThat(
                              db.queryForList(
                                  "SELECT * FROM reconciliation_findings() WHERE check_name='orphan_payment_posting'"))
                          .isNotEmpty();
                      db.update(
                          "INSERT INTO payment_attempts(id,command_id,request_id,actor_id,source_wallet_id,destination_wallet_id,amount,payer_name,status,created_at) VALUES(?,?,?,?,?,?,10000,'Fixture','SUCCEEDED',?)",
                          attempt,
                          claim.id(),
                          request,
                          a.id(),
                          source.walletId(),
                          dest.walletId(),
                          now);
                      db.update(
                          "INSERT INTO payments(id,request_id,attempt_id,merchant_id,source_account_id,destination_account_id,amount,ledger_transaction_id,created_at) VALUES(?,?,?,?,?,?,10000,?,?)",
                          payId,
                          request,
                          attempt,
                          m,
                          source.accountId(),
                          dest.accountId(),
                          journal,
                          now);
                      db.update(
                          "UPDATE payment_requests SET status='PAID',state_changed_at=? WHERE id=?",
                          now,
                          request);
                      commands.finish(
                          claim.id(),
                          new CommandStore.Terminal(
                              UUID.randomUUID(),
                              "PAYMENT",
                              attempt,
                              "SUCCEEDED",
                              201,
                              now.toInstant(),
                              Map.of(),
                              Map.of()));
                      return null;
                    }))
        .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThat(balance(a)).isEqualTo(100000);
    assertThat(wallets.merchant(m).availableBalance()).isEqualTo("0");
    healthy();
  }
}
