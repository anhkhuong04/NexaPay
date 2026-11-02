package vn.nexapay.audit;

import java.time.Clock;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
public class AuditService {
  private final AuditRepository repository;
  private final Clock clock;

  public AuditService(AuditRepository repository, Clock clock) {
    this.repository = repository;
    this.clock = clock;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void record(UUID actor, String action, UUID resource, String correlation) {
    repository.save(new AuditEvent(actor, action, resource, correlation, clock.instant()));
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void money(UUID actor, UUID resource, String status, String correlation) {
    repository.save(
        new AuditEvent(actor, "DEMO_FUNDING", resource, correlation, clock.instant(), status));
  }
}
