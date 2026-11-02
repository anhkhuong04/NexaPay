package vn.nexapay.payment;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.command.*;
import vn.nexapay.shared.ActorPrincipal;

@RestController
@RequestMapping("/api/v1")
public class PaymentController {
  private final PaymentRequests requests;
  private final PaymentTransaction transaction;
  private final MoneyCommandExecutor executor;

  public PaymentController(
      PaymentRequests requests, PaymentTransaction transaction, MoneyCommandExecutor executor) {
    this.requests = requests;
    this.transaction = transaction;
    this.executor = executor;
  }

  @GetMapping("/payment-requests/capabilities")
  PaymentRequests.Capabilities capabilities() {
    return requests.capabilities();
  }

  @PostMapping("/merchants/{merchant}/payment-requests")
  ResponseEntity<PaymentRequests.Detail> create(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @RequestHeader("Idempotency-Key") String key,
      @Valid @RequestBody PaymentInput.Create body,
      HttpServletRequest req) {
    return ResponseEntity.status(201)
        .body(
            requests.create(
                actor.id(), merchant, PaymentInput.key(key), body.canonical(), correlation(req)));
  }

  @GetMapping("/merchants/{merchant}/payment-requests")
  PaymentRequests.Page<PaymentRequests.Detail> list(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @RequestParam(defaultValue = "20") int limit,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) String status,
      HttpServletRequest req) {
    return requests.list(actor.id(), merchant, limit, cursor, status, correlation(req));
  }

  @GetMapping("/merchants/{merchant}/payment-requests/by-key/{key}")
  PaymentRequests.Detail lookupCreate(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @PathVariable UUID key,
      HttpServletRequest req) {
    return requests.byCreationKey(actor.id(), merchant, key, correlation(req));
  }

  @GetMapping("/merchants/{merchant}/payment-requests/{id}")
  PaymentRequests.Detail detail(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @PathVariable UUID id,
      HttpServletRequest req) {
    return requests.owned(actor.id(), merchant, id, correlation(req));
  }

  @PostMapping("/merchants/{merchant}/payment-requests/{id}/cancel")
  PaymentRequests.Detail cancel(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @PathVariable UUID id,
      HttpServletRequest req) {
    return requests.cancel(actor.id(), merchant, id, correlation(req));
  }

  @GetMapping("/merchants/{merchant}/payments")
  PaymentRequests.Page<PaymentRequests.PaymentView> payments(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID merchant,
      @RequestParam(defaultValue = "20") int limit,
      @RequestParam(required = false) String cursor) {
    return requests.payments(actor.id(), merchant, limit, cursor);
  }

  @GetMapping("/merchants/{merchant}/payments/summary")
  PaymentRequests.Summary summary(
      @AuthenticationPrincipal ActorPrincipal actor, @PathVariable UUID merchant) {
    return requests.summary(actor.id(), merchant);
  }

  @GetMapping("/checkout/{ref}")
  PaymentRequests.Checkout checkout(@PathVariable UUID ref, HttpServletRequest req) {
    return requests.checkout(ref, correlation(req));
  }

  @PostMapping("/checkout/{ref}/pay")
  ResponseEntity<CommandStore.Terminal> pay(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID ref,
      @RequestHeader("Idempotency-Key") String key,
      @Valid @RequestBody PaymentInput.Pay body,
      HttpServletRequest req) {
    UUID parsed = PaymentInput.key(key);
    long amount = body.canonical();
    var result =
        executor.execute(
            actor.id(),
            () -> transaction.execute(actor.id(), parsed, ref, amount, correlation(req)));
    return ResponseEntity.status(result.originalHttpStatus()).body(result);
  }

  private String correlation(HttpServletRequest request) {
    return (String) request.getAttribute("correlationId");
  }
}
