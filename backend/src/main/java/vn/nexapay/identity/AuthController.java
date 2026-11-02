package vn.nexapay.identity;

import jakarta.servlet.http.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.slf4j.*;
import org.springframework.http.*;
import org.springframework.security.authentication.*;
import org.springframework.security.core.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.*;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.*;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.shared.ActorPrincipal;
import vn.nexapay.shared.ApiFailure;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
  private static final Logger log = LoggerFactory.getLogger(AuthController.class);
  private final IdentityService identity;
  private final AuthenticationManager manager;
  private final HttpSessionSecurityContextRepository contexts;
  private final HttpSessionCsrfTokenRepository csrf;
  private final LoginThrottle throttle;
  private final Clock clock;
  private final vn.nexapay.merchant.MerchantService merchants;

  public AuthController(
      IdentityService identity,
      AuthenticationManager manager,
      HttpSessionSecurityContextRepository contexts,
      HttpSessionCsrfTokenRepository csrf,
      LoginThrottle throttle,
      Clock clock,
      vn.nexapay.merchant.MerchantService merchants) {
    this.identity = identity;
    this.manager = manager;
    this.contexts = contexts;
    this.csrf = csrf;
    this.throttle = throttle;
    this.clock = clock;
    this.merchants = merchants;
  }

  public record Register(
      @NotBlank @Email @Size(max = 254) String email,
      @NotBlank String password,
      @NotBlank String displayName) {
    public Register {
      if (email != null) email = IdentityService.normalize(email);
    }

    @Override
    public String toString() {
      return "Register[redacted]";
    }
  }

  public record Login(
      @NotBlank @Email @Size(max = 254) String email, @NotBlank @Size(max = 128) String password) {
    public Login {
      if (email != null) email = IdentityService.normalize(email);
    }

    @Override
    public String toString() {
      return "Login[redacted]";
    }
  }

  public record Csrf(String token, String headerName) {
    @Override
    public String toString() {
      return "Csrf[redacted]";
    }
  }

  public record Session(
      UUID userId,
      List<String> roles,
      Instant authenticatedAt,
      Instant absoluteExpiresAt,
      UUID merchantId) {}

  @GetMapping("/csrf")
  Csrf csrf(CsrfToken token) {
    return new Csrf(token.getToken(), token.getHeaderName());
  }

  @PostMapping("/register")
  ResponseEntity<RegistrationTransaction.Created> register(
      @Valid @RequestBody Register body, HttpServletRequest request) {
    return ResponseEntity.status(201)
        .body(
            identity.register(
                body.email(),
                body.password(),
                body.displayName(),
                (String) request.getAttribute("correlationId")));
  }

  @PostMapping("/login")
  Session login(
      @Valid @RequestBody Login body, HttpServletRequest request, HttpServletResponse response) {
    LoginThrottle.Permit permit = throttle.acquire(body.email(), request.getRemoteAddr());
    Authentication authentication;
    try {
      authentication =
          manager.authenticate(
              UsernamePasswordAuthenticationToken.unauthenticated(body.email(), body.password()));
    } catch (AuthenticationException | IllegalArgumentException e) {
      throttle.complete(permit, false);
      log.info("authentication_rejected correlationId={}", request.getAttribute("correlationId"));
      throw new ApiFailure(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
    } catch (RuntimeException e) {
      throttle.complete(permit, true);
      throw e;
    }
    throttle.complete(permit, true);
    new ChangeSessionIdAuthenticationStrategy().onAuthentication(authentication, request, response);
    new CsrfAuthenticationStrategy(csrf).onAuthentication(authentication, request, response);
    SecurityContext context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(authentication);
    SecurityContextHolder.setContext(context);
    contexts.saveContext(context, request, response);
    HttpSession session = request.getSession();
    Instant now = clock.instant();
    session.setAttribute(SessionExpiryFilter.AUTHENTICATED_AT, now);
    session.setAttribute(SessionExpiryFilter.LAST_SEEN, now);
    session.setMaxInactiveInterval(1800);
    return summary((ActorPrincipal) authentication.getPrincipal(), session);
  }

  @GetMapping("/session")
  Session session(@AuthenticationPrincipal ActorPrincipal actor, HttpServletRequest request) {
    return summary(actor, request.getSession(false));
  }

  private Session summary(ActorPrincipal actor, HttpSession session) {
    Instant start = (Instant) session.getAttribute(SessionExpiryFilter.AUTHENTICATED_AT);
    UUID merchantId = merchants.membership(actor.id()).orElse(null);
    List<String> roles = new ArrayList<>(actor.roles());
    if (merchantId != null && !roles.contains("MERCHANT")) roles.add("MERCHANT");
    return new Session(
        actor.id(), List.copyOf(roles), start, start.plus(Duration.ofHours(8)), merchantId);
  }
}
