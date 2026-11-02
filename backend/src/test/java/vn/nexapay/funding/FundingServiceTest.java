package vn.nexapay.funding;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.SQLException;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import vn.nexapay.shared.ApiFailure;

class FundingServiceTest {
  @Test
  void throttleExpiresAndDoesNotExecuteThirtyFirstRequest() {
    var tx = mock(FundingTransaction.class);
    var clock = mock(Clock.class);
    var now = new AtomicReference<>(Instant.EPOCH);
    when(clock.instant()).thenAnswer(i -> now.get());
    var service = new FundingService(tx, new vn.nexapay.command.MoneyCommandExecutor(clock));
    var actor = UUID.randomUUID();
    for (int i = 0; i < 30; i++) service.fund(actor, UUID.randomUUID(), "test");
    assertThatThrownBy(() -> service.fund(actor, UUID.randomUUID(), "test"))
        .isInstanceOfSatisfying(ApiFailure.class, e -> assertThat(e.status()).isEqualTo(429));
    verify(tx, times(30)).execute(any(), any(), any());
    now.set(Instant.EPOCH.plusSeconds(60));
    service.fund(actor, UUID.randomUUID(), "test");
    verify(tx, times(31)).execute(any(), any(), any());
  }

  @Test
  void retryOnlyConfirmedRollbackAtMostThreeAttemptsAndNeverConnectionUncertainty() {
    var tx = mock(FundingTransaction.class);
    var service =
        new FundingService(tx, new vn.nexapay.command.MoneyCommandExecutor(Clock.systemUTC()));
    UUID actor = UUID.randomUUID(), key = UUID.randomUUID();
    when(tx.execute(any(), any(), any()))
        .thenThrow(
            new DataAccessResourceFailureException("lock wait", new SQLException("test", "55P03")));
    assertThatThrownBy(() -> service.fund(actor, key, "test"))
        .isInstanceOfSatisfying(
            ApiFailure.class, e -> assertThat(e.code()).isEqualTo("COMMAND_RETRYABLE"));
    verify(tx, times(3)).execute(actor, key, "test");
    reset(tx);
    when(tx.execute(any(), any(), any()))
        .thenThrow(
            new DataAccessResourceFailureException(
                "connection loss", new SQLException("test", "08006")));
    assertThatThrownBy(() -> service.fund(actor, key, "test"))
        .isInstanceOfSatisfying(
            ApiFailure.class, e -> assertThat(e.code()).isEqualTo("COMMAND_UNRESOLVED"));
    verify(tx).execute(actor, key, "test");
  }
}
