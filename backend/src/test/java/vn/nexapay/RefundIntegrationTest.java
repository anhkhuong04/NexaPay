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
class RefundIntegrationTest {
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
            .with(csrf())
            .contentType("application/json")
            .content(json.writeValueAsString(body));
    if (actor != null) request.with(user(actor));
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

  record Fixture(
      ActorPrincipal merchantOwner,
      ActorPrincipal payer,
      UUID merchant,
      JsonNode request,
      UUID payment) {}

  Fixture fixture() throws Exception {
    var a = actor();
    var b = actor();
    var m = merchant(a);
    fund(b);
    var request = create(a, m, "10000");
    var paid = pay(b, request, UUID.randomUUID(), "10000");
    return new Fixture(
        a, b, m, request, UUID.fromString(paid.path("result").path("paymentId").asText()));
  }

  String path(Fixture f) {
    return "/merchants/" + f.merchant() + "/payments/" + f.payment() + "/refunds";
  }

  JsonNode refund(Fixture f, UUID key, String amount) throws Exception {
    var r =
        postJson(
            f.merchantOwner(),
            path(f),
            key,
            Map.of("amount", amount, "currency", "VND", "note", "  Cafe\u0301 refund  "));
    assertThat(r.getResponse().getStatus()).isIn(201, 422);
    return node(r);
  }

  JsonNode payment(Fixture f) throws Exception {
    return getNode(
        f.merchantOwner(), "/merchants/" + f.merchant() + "/payments/" + f.payment(), 200);
  }

  long merchantBalance(Fixture f) {
    return db.queryForObject(
        "SELECT posted_balance FROM ledger_accounts WHERE id=(SELECT ledger_account_id FROM wallets WHERE merchant_id=?)",
        Long.class,
        f.merchant());
  }

  org.springframework.transaction.support.TransactionTemplate tx() {
    return new org.springframework.transaction.support.TransactionTemplate(manager);
  }

  void locked(UUID account, boolean lock) {
    owner()
        .update(
            "UPDATE ledger_accounts SET status=? WHERE id=?", lock ? "LOCKED" : "ACTIVE", account);
  }

  UUID merchantAccount(Fixture f) {
    return db.queryForObject(
        "SELECT ledger_account_id FROM wallets WHERE merchant_id=?", UUID.class, f.merchant());
  }

  @Test
  void partialThenFullPostsExactReverseLegsAndKeepsPaidWithImmutableReplay() throws Exception {
    var f = fixture();
    var key = UUID.randomUUID();
    var first = refund(f, key, "3000");
    assertThat(first.path("status").asText()).isEqualTo("SUCCEEDED");
    assertThat(first.path("operationType").asText()).isEqualTo("REFUND");
    assertThat(first.path("result").path("note").asText()).isEqualTo("Café refund");
    assertThat(balance(f.payer())).isEqualTo(93000);
    assertThat(merchantBalance(f)).isEqualTo(7000);
    assertThat(payment(f).path("refundedAmount").asText()).isEqualTo("3000");
    assertThat(payment(f).path("refundableAmount").asText()).isEqualTo("7000");
    assertThat(payment(f).path("refundStatus").asText()).isEqualTo("PARTIAL");
    UUID journal = UUID.fromString(first.path("result").path("ledgerTransactionId").asText());
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM ledger_entries WHERE transaction_id=?", Long.class, journal))
        .isEqualTo(2);
    assertThat(
            db.queryForObject(
                "SELECT amount FROM ledger_entries WHERE transaction_id=? AND account_id=?",
                Long.class,
                journal,
                merchantAccount(f)))
        .isEqualTo(-3000);
    assertThat(
            db.queryForObject(
                "SELECT amount FROM ledger_entries WHERE transaction_id=? AND account_id=?",
                Long.class,
                journal,
                wallets.reference(f.payer().id()).accountId()))
        .isEqualTo(3000);
    locked(merchantAccount(f), true);
    assertThat(refund(f, key, "3000")).isEqualTo(first);
    locked(merchantAccount(f), false);
    var second = refund(f, UUID.randomUUID(), "7000");
    assertThat(second.path("status").asText()).isEqualTo("SUCCEEDED");
    assertThat(payment(f).path("refundStatus").asText()).isEqualTo("FULL");
    assertThat(payment(f).path("refundableAmount").asText()).isEqualTo("0");
    assertThat(balance(f.payer())).isEqualTo(100000);
    assertThat(merchantBalance(f)).isZero();
    assertThat(
            getNode(
                    f.merchantOwner(),
                    "/merchants/"
                        + f.merchant()
                        + "/payment-requests/"
                        + f.request().path("id").asText(),
                    200)
                .path("status")
                .asText())
        .isEqualTo("PAID");
    var rejected = refund(f, UUID.randomUUID(), "1");
    assertThat(rejected.path("error").path("code").asText()).isEqualTo("REFUND_LIMIT_EXCEEDED");
    var conflict =
        postJson(
            f.merchantOwner(),
            path(f),
            key,
            Map.of("amount", "3001", "currency", "VND", "note", "Café refund"));
    assertThat(conflict.getResponse().getStatus()).isEqualTo(409);
    healthy();
  }

  @Test
  void sameKeyTwentyWayAndConcurrentPartialRefundsCannotOverRefund() throws Exception {
    var f = fixture();
    var key = UUID.randomUUID();
    var pool = Executors.newFixedThreadPool(10);
    try {
      var jobs = new ArrayList<Callable<JsonNode>>();
      for (int i = 0; i < 20; i++) jobs.add(() -> refund(f, key, "2000"));
      var results = pool.invokeAll(jobs);
      var expected = results.getFirst().get();
      for (var r : results) assertThat(r.get()).isEqualTo(expected);
      assertThat(
              db.queryForObject(
                  "SELECT count(*) FROM refunds WHERE payment_id=?", Long.class, f.payment()))
          .isEqualTo(1);
    } finally {
      pool.shutdownNow();
    }
    var g = fixture();
    var p = Executors.newFixedThreadPool(5);
    try {
      var jobs = new ArrayList<Callable<JsonNode>>();
      for (int i = 0; i < 5; i++) jobs.add(() -> refund(g, UUID.randomUUID(), "2500"));
      int successes = 0, failures = 0;
      for (var r : p.invokeAll(jobs)) {
        if (r.get().path("status").asText().equals("SUCCEEDED")) successes++;
        else failures++;
      }
      assertThat(successes).isEqualTo(4);
      assertThat(failures).isEqualTo(1);
    } finally {
      p.shutdownNow();
    }
    assertThat(payment(g).path("refundedAmount").asText()).isEqualTo("10000");
    assertThat(balance(g.payer())).isEqualTo(100000);
    assertThat(merchantBalance(g)).isZero();
    healthy();
  }

  @Test
  void lockedOriginalPayerReceivesButLockedMerchantFailureReplaysAfterUnlock() throws Exception {
    var f = fixture();
    locked(wallets.reference(f.payer().id()).accountId(), true);
    locked(merchantAccount(f), true);
    var key = UUID.randomUUID();
    var failed = refund(f, key, "10000");
    assertThat(failed.path("error").path("code").asText()).isEqualTo("WALLET_LOCKED");
    locked(merchantAccount(f), false);
    assertThat(refund(f, key, "10000")).isEqualTo(failed);
    assertThat(refund(f, UUID.randomUUID(), "10000").path("status").asText())
        .isEqualTo("SUCCEEDED");
    assertThat(balance(f.payer())).isEqualTo(100000);
    healthy();
  }

  @Test
  void insufficientMerchantIsTerminalWithoutDebtAndNewKeyCanSucceedAfterLedgerOutflowIsReversed()
      throws Exception {
    var f = fixture();
    var source = merchantAccount(f);
    var dest = wallets.reference(f.payer().id()).accountId();
    // Controlled test-only future merchant outflow, through balanced posting, never direct balance
    // edits.
    tx().execute(
            s ->
                posting.post(
                    "TEST_MERCHANT_OUTFLOW",
                    UUID.randomUUID(),
                    List.of(
                        new vn.nexapay.ledger.MoneyPostingService.Entry(source, -9000),
                        new vn.nexapay.ledger.MoneyPostingService.Entry(dest, 9000))));
    var key = UUID.randomUUID();
    var rejected = refund(f, key, "3000");
    assertThat(rejected.path("error").path("code").asText()).isEqualTo("INSUFFICIENT_FUNDS");
    assertThat(payment(f).path("refundedAmount").asText()).isEqualTo("0");
    tx().execute(
            s ->
                posting.post(
                    "TEST_MERCHANT_OUTFLOW_REVERSAL",
                    UUID.randomUUID(),
                    List.of(
                        new vn.nexapay.ledger.MoneyPostingService.Entry(source, 9000),
                        new vn.nexapay.ledger.MoneyPostingService.Entry(dest, -9000))));
    assertThat(refund(f, key, "3000")).isEqualTo(rejected);
    assertThat(refund(f, UUID.randomUUID(), "3000").path("status").asText()).isEqualTo("SUCCEEDED");
    healthy();
  }

  @Test
  void auditFaultRollsBackRefundBothLegsProjectionCommandAndAggregate() throws Exception {
    var f = fixture();
    var key = UUID.randomUUID();
    doThrow(new IllegalStateException("refund audit fault"))
        .when(
            org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit))
        .money(eq(f.merchantOwner().id()), eq("REFUND"), any(), any(), any());
    try {
      assertThat(
              postJson(f.merchantOwner(), path(f), key, Map.of("amount", "3000", "currency", "VND"))
                  .getResponse()
                  .getStatus())
          .isEqualTo(500);
    } finally {
      reset(
          org.springframework.test.util.AopTestUtils.<AuditService>getUltimateTargetObject(audit));
    }
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM refunds WHERE payment_id=?", Long.class, f.payment()))
        .isZero();
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM money_commands WHERE command_key=?", Long.class, key))
        .isZero();
    assertThat(merchantBalance(f)).isEqualTo(10000);
    assertThat(balance(f.payer())).isEqualTo(90000);
    assertThat(payment(f).path("refundStatus").asText()).isEqualTo("NONE");
    healthy();
  }

  @Test
  void ownershipAuthCsrfStrictSchemaAndBoundedPagingDoNotLeakOrConsumeKey() throws Exception {
    var f = fixture();
    var other = actor();
    assertThat(
            postJson(other, path(f), UUID.randomUUID(), Map.of("amount", "1", "currency", "VND"))
                .getResponse()
                .getStatus())
        .isEqualTo(404);
    assertThat(postJson(null, path(f), null, Map.of()).getResponse().getStatus()).isIn(401, 403);
    assertThat(
            mvc.perform(
                    post("/api/v1" + path(f))
                        .with(user(f.merchantOwner()))
                        .contentType("application/json")
                        .content("{}"))
                .andReturn()
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    for (Object amount : List.of("0", "01", "1.0", "1e3", "100000001", 1)) {
      var key = UUID.randomUUID();
      assertThat(
              postJson(f.merchantOwner(), path(f), key, Map.of("amount", amount, "currency", "VND"))
                  .getResponse()
                  .getStatus())
          .isEqualTo(400);
      assertThat(
              db.queryForObject(
                  "SELECT count(*) FROM money_commands WHERE command_key=?", Long.class, key))
          .isZero();
    }
    assertThat(
            postJson(
                    f.merchantOwner(),
                    path(f),
                    UUID.randomUUID(),
                    Map.of("amount", "1", "currency", "VND", "note", "bad\ncontrol"))
                .getResponse()
                .getStatus())
        .isEqualTo(400);
    assertThat(
            postJson(
                    f.merchantOwner(),
                    path(f),
                    UUID.randomUUID(),
                    Map.of("amount", "1000", "currency", "USD"))
                .getResponse()
                .getStatus())
        .isEqualTo(400);
    assertThat(
            postJson(
                    f.merchantOwner(),
                    path(f),
                    UUID.randomUUID(),
                    Map.of(
                        "amount",
                        "1000",
                        "currency",
                        "VND",
                        "destinationWalletId",
                        wallets.own(other.id()).id()))
                .getResponse()
                .getStatus())
        .isEqualTo(400);
    UUID missingKey = UUID.randomUUID();
    assertThat(
            postJson(
                    f.merchantOwner(),
                    "/merchants/" + f.merchant() + "/payments/" + UUID.randomUUID() + "/refunds",
                    missingKey,
                    Map.of("amount", "1", "currency", "VND"))
                .getResponse()
                .getStatus())
        .isEqualTo(404);
    assertThat(
            db.queryForObject(
                "SELECT count(*) FROM money_commands WHERE command_key=?", Long.class, missingKey))
        .isZero();
    var saved = refund(f, UUID.randomUUID(), "1000");
    var id = saved.path("resourceId").asText();
    getNode(other, "/merchants/" + f.merchant() + "/refunds/" + id, 404);
    getNode(f.payer(), "/merchants/" + f.merchant() + "/refunds", 404);
    getNode(f.merchantOwner(), "/merchants/" + f.merchant() + "/refunds?limit=101", 400);
    getNode(f.merchantOwner(), "/merchants/" + f.merchant() + "/refunds?status=PENDING", 400);
    var first = getNode(f.merchantOwner(), "/merchants/" + f.merchant() + "/refunds?limit=1", 200);
    assertThat(first.path("items")).hasSize(1);
    assertThat(first.toString()).doesNotContain("@example.test", "commandKey", "fingerprint");
    healthy();
  }

  @Test
  void payerSeesOnlySuccessfulIncomingRefundWhileOwnerSeesFailedAndSuccess() throws Exception {
    var f = fixture();
    var success = refund(f, UUID.randomUUID(), "1000");
    var failed = refund(f, UUID.randomUUID(), "10000");
    var history = getNode(f.payer(), "/transactions?type=INCOMING", 200);
    assertThat(history.path("items")).hasSize(1);
    assertThat(history.path("items").get(0).path("operationType").asText()).isEqualTo("REFUND");
    getNode(f.payer(), "/transactions/REFUND/" + failed.path("resourceId").asText(), 404);
    getNode(actor(), "/transactions/REFUND/" + success.path("resourceId").asText(), 404);
    var detail =
        getNode(f.payer(), "/transactions/REFUND/" + success.path("resourceId").asText(), 200);
    assertThat(detail.path("paymentId").asText()).isEqualTo(f.payment().toString());
    assertThat(detail.toString()).doesNotContain("commandKey", "@example.test");
    var list = getNode(f.merchantOwner(), "/merchants/" + f.merchant() + "/refunds", 200);
    assertThat(list.path("items")).hasSize(2);
    var summary =
        getNode(f.merchantOwner(), "/merchants/" + f.merchant() + "/payments/summary", 200);
    assertThat(summary.path("refundsToday").asLong()).isEqualTo(1);
    assertThat(summary.path("refundedToday").asText()).isEqualTo("1000");
    healthy();
  }

  @Test
  void refundAndNewPaymentUseSharedAccountLockOrderAndKeepOriginalPaymentImmutable()
      throws Exception {
    var f = fixture();
    var another = create(f.merchantOwner(), f.merchant(), "1000");
    var pool = Executors.newFixedThreadPool(2);
    try {
      var jobs =
          List.<Callable<JsonNode>>of(
              () -> refund(f, UUID.randomUUID(), "5000"),
              () -> pay(f.payer(), another, UUID.randomUUID(), "1000"));
      for (var future : pool.invokeAll(jobs))
        assertThat(future.get().path("status").asText()).isEqualTo("SUCCEEDED");
    } finally {
      pool.shutdownNow();
    }
    assertThat(merchantBalance(f)).isEqualTo(6000);
    assertThat(balance(f.payer())).isEqualTo(94000);
    healthy();
  }

  void rawRefund(Fixture f, long amount, long legs) {
    UUID id = UUID.randomUUID(), rawKey = UUID.randomUUID();
    var claim =
        commands.claim(f.merchantOwner().id(), "REFUND", rawKey, "raw-test-fixture", Instant.now());
    var journal =
        posting.post(
            "REFUND",
            id,
            List.of(
                new vn.nexapay.ledger.MoneyPostingService.Entry(merchantAccount(f), -legs),
                new vn.nexapay.ledger.MoneyPostingService.Entry(
                    wallets.reference(f.payer().id()).accountId(), legs)));
    db.update(
        "INSERT INTO refunds(id,command_id,payment_id,merchant_id,actor_id,payer_id,source_account_id,destination_account_id,source_wallet_id,destination_wallet_id,amount,currency,note,merchant_name,payer_name,status,ledger_transaction_id,created_at) SELECT ?,?,p.id,p.merchant_id,?,a.actor_id,p.destination_account_id,p.source_account_id,a.destination_wallet_id,a.source_wallet_id,?,'VND','raw fixture',r.merchant_name,a.payer_name,'SUCCEEDED',?,clock_timestamp() FROM payments p JOIN payment_attempts a ON a.id=p.attempt_id JOIN payment_requests r ON r.id=p.request_id WHERE p.id=?",
        id,
        claim.id(),
        f.merchantOwner().id(),
        amount,
        journal,
        f.payment());
    commands.finish(
        claim.id(),
        new CommandStore.Terminal(
            rawKey, "REFUND", id, "SUCCEEDED", 201, Instant.now(), Map.of(), Map.of()));
  }

  @Test
  void databaseRejectsOverRefundEvenWithBalancedLegsAndEnoughMerchantFunds() throws Exception {
    var f = fixture();
    var other = create(f.merchantOwner(), f.merchant(), "10000");
    pay(f.payer(), other, UUID.randomUUID(), "10000");
    assertThatThrownBy(
            () ->
                tx().execute(
                        s -> {
                          rawRefund(f, 6000, 6000);
                          rawRefund(f, 6000, 6000);
                          return null;
                        }))
        .isInstanceOf(RuntimeException.class);
    assertThat(merchantBalance(f)).isEqualTo(20000);
    assertThat(balance(f.payer())).isEqualTo(80000);
    assertThat(payment(f).path("refundedAmount").asText()).isEqualTo("0");
    healthy();
  }

  @Test
  void databaseRejectsWrongReverseLegsAndOrphanJournalWithoutRepair() throws Exception {
    var f = fixture();
    assertThatThrownBy(
            () ->
                tx().execute(
                        s -> {
                          rawRefund(f, 1000, 999);
                          return null;
                        }))
        .isInstanceOf(RuntimeException.class);
    tx().execute(
            s -> {
              var id =
                  posting.post(
                      "REFUND",
                      UUID.randomUUID(),
                      List.of(
                          new vn.nexapay.ledger.MoneyPostingService.Entry(
                              merchantAccount(f), -1000),
                          new vn.nexapay.ledger.MoneyPostingService.Entry(
                              wallets.reference(f.payer().id()).accountId(), 1000)));
              assertThat(
                      db.queryForList(
                          "SELECT check_name FROM reconciliation_findings() WHERE resource_id=?",
                          String.class,
                          id.toString()))
                  .contains("orphan_refund_posting");
              s.setRollbackOnly();
              return null;
            });
    assertThat(merchantBalance(f)).isEqualTo(10000);
    assertThat(balance(f.payer())).isEqualTo(90000);
    healthy();
  }

  @Test
  void runtimeCannotMutateRefundOrCaptureAndOwnerCannotRewritePostedRefund() throws Exception {
    var f = fixture();
    var r = refund(f, UUID.randomUUID(), "1000");
    UUID id = UUID.fromString(r.path("resourceId").asText());
    assertThatThrownBy(() -> db.update("UPDATE refunds SET amount=2 WHERE id=?", id))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(() -> owner().update("UPDATE refunds SET amount=2 WHERE id=?", id))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(() -> db.update("UPDATE payments SET amount=2 WHERE id=?", f.payment()))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    var second = refund(f, UUID.randomUUID(), "1000");
    var page = getNode(f.merchantOwner(), "/merchants/" + f.merchant() + "/refunds?limit=1", 200);
    assertThat(page.path("items")).hasSize(1);
    assertThat(page.path("nextCursor").isTextual()).isTrue();
    var next =
        getNode(
            f.merchantOwner(),
            "/merchants/"
                + f.merchant()
                + "/refunds?limit=1&cursor="
                + page.path("nextCursor").asText(),
            200);
    assertThat(next.path("items")).hasSize(1);
    assertThat(next.path("items").get(0).path("id"))
        .isNotEqualTo(page.path("items").get(0).path("id"));
    getNode(f.merchantOwner(), "/merchants/" + f.merchant() + "/refunds?cursor=bad", 400);
    getNode(
        f.merchantOwner(),
        "/merchants/" + f.merchant() + "/refunds?status=SUCCEEDED&paymentId=" + f.payment(),
        200);
    healthy();
  }
}
