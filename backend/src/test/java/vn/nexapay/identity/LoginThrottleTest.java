package vn.nexapay.identity;

import static org.assertj.core.api.Assertions.*;

import java.time.*;
import org.junit.jupiter.api.Test;

class LoginThrottleTest {
  static class MutableClock extends Clock {
    Instant time = Instant.parse("2026-01-01T00:00:00Z");

    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    public Clock withZone(ZoneId zone) {
      return this;
    }

    public Instant instant() {
      return time;
    }
  }

  @Test
  void failedAccountsAndIpAreBoundedAndExpire() {
    MutableClock clock = new MutableClock();
    LoginThrottle throttle = new LoginThrottle(clock);
    for (int i = 0; i < 5; i++) throttle.complete(throttle.acquire("alice", "127.0.0.1"), false);
    assertThatThrownBy(() -> throttle.acquire("alice", "127.0.0.2"))
        .hasMessageContaining("nhiều lần");
    clock.time = clock.time.plus(Duration.ofMinutes(15));
    assertThatCode(() -> throttle.complete(throttle.acquire("alice", "127.0.0.1"), true))
        .doesNotThrowAnyException();
    for (int i = 0; i < 30; i++) throttle.complete(throttle.acquire("user" + i, "10.0.0.1"), false);
    assertThatThrownBy(() -> throttle.acquire("different", "10.0.0.1"))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void inflightAttemptsReserveCapacity() {
    LoginThrottle throttle = new LoginThrottle(new MutableClock());
    var permits = new java.util.ArrayList<LoginThrottle.Permit>();
    for (int i = 0; i < 5; i++) permits.add(throttle.acquire("alice", "127.0.0.1"));
    assertThatThrownBy(() -> throttle.acquire("alice", "127.0.0.1"))
        .isInstanceOf(RuntimeException.class);
    permits.forEach(p -> throttle.complete(p, true));
    assertThatCode(() -> throttle.acquire("alice", "127.0.0.1")).doesNotThrowAnyException();
  }
}
