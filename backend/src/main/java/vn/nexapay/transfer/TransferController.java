package vn.nexapay.transfer;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.command.CommandStore;
import vn.nexapay.shared.*;

@RestController
@RequestMapping("/api/v1")
public class TransferController {
  private final TransferService service;

  public TransferController(TransferService service) {
    this.service = service;
  }

  @GetMapping("/recipients/{walletId}")
  TransferService.Recipient recipient(
      @AuthenticationPrincipal ActorPrincipal actor, @PathVariable UUID walletId) {
    return service.recipient(actor.id(), walletId);
  }

  @GetMapping("/transfers/capabilities")
  TransferService.Capabilities capabilities() {
    return service.capabilities();
  }

  @PostMapping("/transfers")
  ResponseEntity<CommandStore.Terminal> send(
      @AuthenticationPrincipal ActorPrincipal actor,
      @RequestHeader("Idempotency-Key") String raw,
      @Valid @RequestBody TransferInput input,
      HttpServletRequest request) {
    UUID key;
    try {
      key = UUID.fromString(raw);
      if (!key.toString().equalsIgnoreCase(raw)) throw new IllegalArgumentException();
    } catch (IllegalArgumentException e) {
      throw new ApiFailure(400, "INVALID_IDEMPOTENCY_KEY", "Mã thao tác cần đúng định dạng UUID.");
    }
    var intent = input.canonical();
    var result =
        service.send(actor.id(), key, intent, (String) request.getAttribute("correlationId"));
    return ResponseEntity.status(result.originalHttpStatus()).body(result);
  }
}
