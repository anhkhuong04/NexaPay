package vn.nexapay.identity;

import java.time.*;
import java.util.*;
import org.springframework.stereotype.Component;
import vn.nexapay.shared.ApiFailure;

@Component
public class LoginThrottle {
  private static final Duration WINDOW = Duration.ofMinutes(15);
  private final Clock clock;
  private final Map<String, Bucket> buckets = new HashMap<>();

  private static class Bucket {
    final Instant start;
    int failed;
    int inflight;

    Bucket(Instant start) {
      this.start = start;
    }
  }

  public record Permit(String account, String ip) {}

  public LoginThrottle(Clock clock) {
    this.clock = clock;
  }

  public synchronized Permit acquire(String email, String ip) {
    Instant now = clock.instant();
    buckets
        .entrySet()
        .removeIf(
            e -> !now.isBefore(e.getValue().start.plus(WINDOW)) && e.getValue().inflight == 0);
    String a = "a:" + email, i = "i:" + ip;
    if (buckets.size() > 10000) throw limited();
    Bucket ab = buckets.computeIfAbsent(a, k -> new Bucket(now));
    Bucket ib = buckets.computeIfAbsent(i, k -> new Bucket(now));
    if (ab.failed + ab.inflight >= 5 || ib.failed + ib.inflight >= 30) throw limited();
    ab.inflight++;
    ib.inflight++;
    return new Permit(a, i);
  }

  public synchronized void complete(Permit permit, boolean success) {
    for (String k : List.of(permit.account(), permit.ip())) {
      Bucket b = buckets.get(k);
      if (b != null) {
        b.inflight--;
        if (!success) b.failed++;
      }
    }
  }

  private ApiFailure limited() {
    return new ApiFailure(
        429, "LOGIN_THROTTLED", "Bạn đã thử đăng nhập nhiều lần. Vui lòng thử lại sau.");
  }
}
