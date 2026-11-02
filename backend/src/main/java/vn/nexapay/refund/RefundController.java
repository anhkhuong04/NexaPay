package vn.nexapay.refund;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.command.*;
import vn.nexapay.payment.PaymentInput;
import vn.nexapay.shared.ActorPrincipal;

@RestController
@RequestMapping("/api/v1/merchants/{merchant}")
public class RefundController {
  private final RefundTransaction transaction;
  private final RefundQueries queries;
  private final MoneyCommandExecutor executor;

  public RefundController(
      RefundTransaction transaction, RefundQueries queries, MoneyCommandExecutor executor) {
    this.transaction = transaction;
    this.queries = queries;
    this.executor = executor;
  }

  @PostMapping("/payments/{payment}/refunds")
  ResponseEntity<CommandStore.Terminal> refund(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @PathVariable UUID payment,
      @RequestHeader("Idempotency-Key") String raw,
      @Valid @RequestBody RefundInput body,
      HttpServletRequest request) {
    UUID key = PaymentInput.key(raw);
    var intent = body.canonical();
    String correlation = (String) request.getAttribute("correlationId");
    var result =
        executor.execute(
            actor.id(),
            () -> transaction.execute(actor.id(), merchant, payment, key, intent, correlation));
    return ResponseEntity.status(result.originalHttpStatus()).body(result);
  }

  @GetMapping("/refunds")
  RefundQueries.Page list(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @RequestParam(defaultValue = "20") int limit,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) UUID paymentId) {
    return queries.list(actor.id(), merchant, limit, cursor, status, paymentId);
  }

  @GetMapping("/refunds/{id}")
  RefundQueries.View detail(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @PathVariable UUID id) {
    return queries.detail(actor.id(), merchant, id);
  }
}
