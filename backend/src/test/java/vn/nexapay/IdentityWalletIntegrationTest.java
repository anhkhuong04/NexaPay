package vn.nexapay;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.*;
import org.springframework.test.web.servlet.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.identity.RegistrationTransaction;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("local")
@Testcontainers
class IdentityWalletIntegrationTest {
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
  @Autowired JdbcTemplate app;
  @Autowired RegistrationTransaction registration;
  @MockitoBean Clock clock;
  @MockitoSpyBean AuditService audit;
  final AtomicReference<Instant> now = new AtomicReference<>();
  JdbcTemplate owner;
  static final String PASSWORD = "Demo-wallet-2026!";

  @BeforeEach
  void prepare() {
    now.set(Instant.parse("2026-01-01T00:00:00Z"));
    when(clock.instant()).thenAnswer(i -> now.get());
    owner =
        new JdbcTemplate(
            new DriverManagerDataSource(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword()));
  }

  @AfterEach
  void clear() {
    reset(auditTarget());
  }

  AuditService auditTarget() {
    return org.springframework.test.util.AopTestUtils.getUltimateTargetObject(audit);
  }

  String email() {
    return "u" + UUID.randomUUID() + "@example.test";
  }

  long count(String table) {
    return app.queryForObject("select count(*) from " + table, Long.class);
  }

  class Browser {
    MockHttpSession session;
    String token;

    Browser() throws Exception {
      csrf();
    }

    MvcResult request(
        org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder builder)
        throws Exception {
      if (session != null) builder.session(session);
      MvcResult r = mvc.perform(builder).andReturn();
      session = (MockHttpSession) r.getRequest().getSession(false);
      return r;
    }

    void csrf() throws Exception {
      var r = request(get("/api/v1/auth/csrf"));
      assertThat(r.getResponse().getStatus()).isEqualTo(200);
      token = json.readTree(r.getResponse().getContentAsString()).get("token").asText();
    }

    MvcResult postJson(String path, Object body) throws Exception {
      return request(
          post(path)
              .contentType("application/json")
              .header("X-CSRF-TOKEN", token)
              .content(json.writeValueAsBytes(body)));
    }

    MvcResult register(String email) throws Exception {
      return postJson(
          "/api/v1/auth/register",
          Map.of("email", email, "password", PASSWORD, "displayName", "Người dùng demo"));
    }

    MvcResult login(String email) throws Exception {
      var r = postJson("/api/v1/auth/login", Map.of("email", email, "password", PASSWORD));
      if (r.getResponse().getStatus() == 200) csrf();
      return r;
    }

    JsonNode body(MvcResult r) throws Exception {
      return json.readTree(r.getResponse().getContentAsString());
    }
  }

  @Test
  void signupProvisionsZeroGraphAndDoesNotLogin() throws Exception {
    Browser b = new Browser();
    String email = email();
    long users = count("users"),
        wallets = count("wallets"),
        accounts = count("ledger_accounts"),
        events = count("audit_events");
    var r = b.register("  " + email.toUpperCase(Locale.ROOT) + "  ");
    assertThat(r.getResponse().getStatus()).isEqualTo(201);
    UUID id = UUID.fromString(b.body(r).get("userId").asText());
    assertThat(count("users")).isEqualTo(users + 1);
    assertThat(count("wallets")).isEqualTo(wallets + 1);
    assertThat(count("ledger_accounts")).isEqualTo(accounts + 1);
    assertThat(count("audit_events")).isEqualTo(events + 1);
    assertThat(app.queryForObject("select email from users where id=?", String.class, id))
        .isEqualTo(email);
    assertThat(app.queryForObject("select password_hash from users where id=?", String.class, id))
        .startsWith("{bcrypt}")
        .doesNotContain(PASSWORD);
    assertThat(app.queryForList("select role from user_roles where user_id=?", String.class, id))
        .containsExactly("INDIVIDUAL");
    assertThat(b.request(get("/api/v1/wallets/me")).getResponse().getStatus()).isEqualTo(401);
    assertThat(b.login(email).getResponse().getStatus()).isEqualTo(200);
    var wallet = b.body(b.request(get("/api/v1/wallets/me")));
    assertThat(wallet.get("availableBalance").isTextual()).isTrue();
    assertThat(wallet.get("availableBalance").asText()).isEqualTo("0");
    assertThat(wallet.get("heldBalance").asText()).isEqualTo("0");
    assertThat(wallet.get("totalBalance").asText()).isEqualTo("0");
    assertThat(wallet.get("status").asText()).isEqualTo("ACTIVE");
    assertThat(r.getResponse().getContentAsString()).doesNotContain("hash", PASSWORD);
  }

  @Test
  void concurrentNormalizedSignupHasOneCompleteGraph() throws Exception {
    String email = email();
    long users = count("users"),
        wallets = count("wallets"),
        accounts = count("ledger_accounts"),
        profiles = count("profiles");
    List<Browser> browsers = List.of(new Browser(), new Browser(), new Browser(), new Browser());
    var ready = new CountDownLatch(4);
    var start = new CountDownLatch(1);
    try (var executor = Executors.newFixedThreadPool(4)) {
      List<Future<Integer>> jobs = new ArrayList<>();
      for (Browser b : browsers)
        jobs.add(
            executor.submit(
                () -> {
                  ready.countDown();
                  start.await();
                  return b.register(email).getResponse().getStatus();
                }));
      assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
      start.countDown();
      List<Integer> results = new ArrayList<>();
      for (var job : jobs) results.add(job.get(30, TimeUnit.SECONDS));
      assertThat(results).containsExactlyInAnyOrder(201, 409, 409, 409);
    }
    assertThat(count("users")).isEqualTo(users + 1);
    assertThat(count("wallets")).isEqualTo(wallets + 1);
    assertThat(count("ledger_accounts")).isEqualTo(accounts + 1);
    assertThat(count("profiles")).isEqualTo(profiles + 1);
  }

  @Test
  void provisioningFailureRollsBackEntireGraphIncludingAudit() throws Exception {
    long[] before = {
      count("users"),
      count("profiles"),
      count("wallets"),
      count("ledger_accounts"),
      count("audit_events")
    };
    doAnswer(
            invocation -> {
              invocation.callRealMethod();
              throw new IllegalStateException("injected after audit");
            })
        .when(auditTarget())
        .record(any(), eq("USER_REGISTERED"), any(), anyString());
    var result = new Browser().register(email());
    assertThat(result.getResponse().getStatus()).isEqualTo(500);
    assertThat(result.getResponse().getContentAsString()).doesNotContain("injected", "Exception");
    assertThat(
            new long[] {
              count("users"),
              count("profiles"),
              count("wallets"),
              count("ledger_accounts"),
              count("audit_events")
            })
        .isEqualTo(before);
  }

  @Test
  void overpostingAndPasswordBoundsCannotCreatePrivilegedAccount() throws Exception {
    Browser b = new Browser();
    long before = count("users");
    var payload =
        new HashMap<String, Object>(
            Map.of("email", email(), "password", PASSWORD, "displayName", "Demo"));
    payload.put("roles", List.of("ADMIN"));
    assertThat(b.postJson("/api/v1/auth/register", payload).getResponse().getStatus())
        .isEqualTo(400);
    payload.remove("roles");
    payload.put("password", "é".repeat(37));
    assertThat(b.postJson("/api/v1/auth/register", payload).getResponse().getStatus())
        .isEqualTo(400);
    payload.put("password", "short");
    assertThat(b.postJson("/api/v1/auth/register", payload).getResponse().getStatus())
        .isEqualTo(400);
    assertThat(count("users")).isEqualTo(before);
  }

  @Test
  void loginRotatesSessionAndCsrfAndPersistsContext() throws Exception {
    Browser b = new Browser();
    String email = email();
    b.register(email);
    String oldSession = b.session.getId(), oldToken = b.token;
    assertThat(b.login(email).getResponse().getStatus()).isEqualTo(200);
    assertThat(b.session.getId()).isNotEqualTo(oldSession);
    assertThat(b.request(get("/api/v1/auth/session")).getResponse().getStatus()).isEqualTo(200);
    var stale =
        b.request(
            patch("/api/v1/me")
                .contentType("application/json")
                .header("X-CSRF-TOKEN", oldToken)
                .content("{\"displayName\":\"Wrong\"}"));
    assertThat(stale.getResponse().getStatus()).isEqualTo(403);
    assertThat(
            b.request(
                    patch("/api/v1/me")
                        .contentType("application/json")
                        .header("X-CSRF-TOKEN", b.token)
                        .content("{\"displayName\":\"Đã cập nhật\"}"))
                .getResponse()
                .getStatus())
        .isEqualTo(200);
  }

  @Test
  void missingCsrfCannotRegisterLoginPatchOrLogout() throws Exception {
    Browser b = new Browser();
    assertThat(
            b.request(post("/api/v1/auth/register").contentType("application/json").content("{}"))
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    String email = email();
    b.register(email);
    assertThat(
            b.request(post("/api/v1/auth/login").contentType("application/json").content("{}"))
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    b.login(email);
    assertThat(
            b.request(
                    patch("/api/v1/me")
                        .contentType("application/json")
                        .content("{\"displayName\":\"No\"}"))
                .getResponse()
                .getStatus())
        .isEqualTo(403);
    assertThat(b.request(post("/api/v1/auth/logout")).getResponse().getStatus()).isEqualTo(403);
  }

  @Test
  void ownResourcesAndProfileAuditStayIsolatedAndLockedWalletIsReadable() throws Exception {
    Browser a = new Browser(), b = new Browser();
    String ae = email(), be = email();
    UUID aid = UUID.fromString(a.body(a.register(ae)).get("userId").asText());
    b.register(be);
    a.login(ae);
    b.login(be);
    assertThat(a.body(a.request(get("/api/v1/me").param("userId", be))).get("email").asText())
        .isEqualTo(ae);
    assertThat(
            a.request(
                    patch("/api/v1/me")
                        .contentType("application/json")
                        .header("X-CSRF-TOKEN", a.token)
                        .content("{\"displayName\":\"Only A\"}"))
                .getResponse()
                .getStatus())
        .isEqualTo(200);
    assertThat(b.body(b.request(get("/api/v1/me"))).get("displayName").asText())
        .isEqualTo("Người dùng demo");
    assertThat(
            a.request(
                    patch("/api/v1/me")
                        .contentType("application/json")
                        .header("X-CSRF-TOKEN", a.token)
                        .content("{\"displayName\":\"No\",\"email\":\"other@example.test\"}"))
                .getResponse()
                .getStatus())
        .isEqualTo(400);
    owner.update(
        "update ledger_accounts set status='LOCKED' where id=(select ledger_account_id from wallets where user_id=?)",
        aid);
    assertThat(a.body(a.request(get("/api/v1/wallets/me"))).get("status").asText())
        .isEqualTo("LOCKED");
    assertThat(
            app.queryForObject(
                "select count(*) from audit_events where actor_id=? and action='PROFILE_RENAMED'",
                Long.class,
                aid))
        .isEqualTo(1);
  }

  @Test
  void profileAuditFailureRollsBackRename() throws Exception {
    Browser b = new Browser();
    String email = email();
    b.register(email);
    b.login(email);
    doThrow(new IllegalStateException("audit down"))
        .when(auditTarget())
        .record(any(), eq("PROFILE_RENAMED"), any(), anyString());
    assertThat(
            b.request(
                    patch("/api/v1/me")
                        .contentType("application/json")
                        .header("X-CSRF-TOKEN", b.token)
                        .content("{\"displayName\":\"Should roll back\"}"))
                .getResponse()
                .getStatus())
        .isEqualTo(500);
    assertThat(b.body(b.request(get("/api/v1/me"))).get("displayName").asText())
        .isEqualTo("Người dùng demo");
  }

  @Test
  void idleSessionExpiresAtThirtyMinutes() throws Exception {
    Browser b = new Browser();
    String email = email();
    b.register(email);
    b.login(email);
    now.set(now.get().plus(Duration.ofMinutes(30)));
    assertThat(b.request(get("/api/v1/me")).getResponse().getStatus()).isEqualTo(401);
  }

  @Test
  void absoluteSessionExpiresDespiteContinuedActivity() throws Exception {
    Browser b = new Browser();
    String email = email();
    b.register(email);
    b.login(email);
    for (int i = 0; i < 47; i++) {
      now.set(now.get().plus(Duration.ofMinutes(10)));
      assertThat(b.request(get("/api/v1/me")).getResponse().getStatus()).isEqualTo(200);
    }
    now.set(now.get().plus(Duration.ofMinutes(10)));
    assertThat(b.request(get("/api/v1/me")).getResponse().getStatus()).isEqualTo(401);
  }

  @Test
  void logoutInvalidatesContextAndAnonymousRepeatNeedsFreshCsrf() throws Exception {
    Browser b = new Browser();
    String email = email();
    b.register(email);
    b.login(email);
    assertThat(b.postJson("/api/v1/auth/logout", Map.of()).getResponse().getStatus())
        .isEqualTo(204);
    b.session = null;
    assertThat(b.request(get("/api/v1/me")).getResponse().getStatus()).isEqualTo(401);
    b.csrf();
    assertThat(b.postJson("/api/v1/auth/logout", Map.of()).getResponse().getStatus())
        .isEqualTo(204);
  }

  @Test
  void invalidCredentialsAreGenericAndAccountFailuresThrottle() throws Exception {
    Browser b = new Browser();
    String email = email();
    b.register(email);
    var wrong =
        b.postJson("/api/v1/auth/login", Map.of("email", email, "password", "bad-password"));
    var unknown =
        b.postJson("/api/v1/auth/login", Map.of("email", email(), "password", "bad-password"));
    assertThat(b.body(wrong).get("code")).isEqualTo(b.body(unknown).get("code"));
    for (int i = 0; i < 4; i++)
      assertThat(
              b.postJson("/api/v1/auth/login", Map.of("email", email, "password", "bad-password"))
                  .getResponse()
                  .getStatus())
          .isEqualTo(401);
    var limited = b.login(email);
    assertThat(limited.getResponse().getStatus()).isEqualTo(429);
    assertThat(limited.getResponse().getHeader("Retry-After")).isNotBlank();
  }

  @Test
  void runtimeRoleCannotEditMoneyOrAuditAndConstraintsProtectData() {
    assertThatThrownBy(() -> app.update("update ledger_accounts set posted_balance=1"))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(() -> app.update("delete from audit_events"))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(
            () ->
                app.update(
                    "insert into ledger_accounts(id,account_type,currency,status,posted_balance) values(?,'PERSONAL','VND','ACTIVE',1)",
                    UUID.randomUUID()))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
    assertThatThrownBy(
            () ->
                owner.update(
                    "insert into ledger_accounts(id,account_type,currency,status,posted_balance) values(?,'PERSONAL','VND','ACTIVE',-1)",
                    UUID.randomUUID()))
        .isInstanceOf(org.springframework.dao.DataAccessException.class);
  }

  @Test
  void errorsAreJsonCorrelatedNoStoreAndUnknownApiDoesNotBecomeSpa() throws Exception {
    Browser b = new Browser();
    var anonymous = b.request(get("/api/v1/me"));
    assertThat(anonymous.getResponse().getStatus()).isEqualTo(401);
    assertThat(b.body(anonymous).get("correlationId").asText()).isNotBlank();
    assertThat(anonymous.getResponse().getHeader("Cache-Control")).contains("no-store");
    String email = email();
    b.register(email);
    b.login(email);
    var missing = b.request(get("/api/v1/not-a-route"));
    assertThat(missing.getResponse().getStatus()).isEqualTo(404);
    assertThat(missing.getResponse().getContentType()).contains("application/json");
  }
}
