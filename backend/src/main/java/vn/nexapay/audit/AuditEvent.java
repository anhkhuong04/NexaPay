package vn.nexapay.audit;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "audit_events")
class AuditEvent {
  @Id private UUID id;
  private UUID actorId;
  private String action;
  private UUID resourceId;
  private String outcome;
  private Instant occurredAt;
  private String correlationId;

  protected AuditEvent() {}

  AuditEvent(UUID actor, String action, UUID resource, String correlation, Instant now) {
    this.id = UUID.randomUUID();
    this.actorId = actor;
    this.action = action;
    this.resourceId = resource;
    this.outcome = "SUCCEEDED";
    this.occurredAt = now;
    this.correlationId = correlation;
  }
}
