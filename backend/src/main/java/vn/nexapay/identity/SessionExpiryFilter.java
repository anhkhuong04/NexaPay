package vn.nexapay.identity;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.time.*;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class SessionExpiryFilter extends OncePerRequestFilter {
  public static final String AUTHENTICATED_AT = "nexapay.authenticatedAt",
      LAST_SEEN = "nexapay.lastSeen";
  private final Clock clock;

  public SessionExpiryFilter(Clock clock) {
    this.clock = clock;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws IOException, ServletException {
    HttpSession session = request.getSession(false);
    if (session != null && session.getAttribute(AUTHENTICATED_AT) instanceof Instant start) {
      Instant now = clock.instant();
      Instant last = (Instant) session.getAttribute(LAST_SEEN);
      if (!now.isBefore(start.plus(Duration.ofHours(8)))
          || (last != null && !now.isBefore(last.plus(Duration.ofMinutes(30))))) {
        session.invalidate();
        SecurityContextHolder.clearContext();
      } else session.setAttribute(LAST_SEEN, now);
    }
    chain.doFilter(request, response);
  }
}
