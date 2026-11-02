package vn.nexapay.funding;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.command.CommandStore;
import vn.nexapay.shared.*;

@RestController
@RequestMapping("/api/v1/demo-fundings")
public class FundingController {
  private final FundingService service;
  private final FundingQuota quota;

  public FundingController(FundingService service, FundingQuota quota) {
    this.service = service;
    this.quota = quota;
  }

  public record Input(
      @NotNull @Pattern(regexp = "100000") String amount,
      @NotNull @Pattern(regexp = "VND") String currency) {}

  @GetMapping("/capabilities")
  FundingQuota.Capabilities capabilities(@AuthenticationPrincipal ActorPrincipal actor) {
    return quota.capabilities(actor.id());
  }

  @PostMapping
  ResponseEntity<CommandStore.Terminal> fund(
      @AuthenticationPrincipal ActorPrincipal actor,
      @RequestHeader("Idempotency-Key") String rawKey,
      @Valid @RequestBody Input input,
      HttpServletRequest request) {
    UUID key;
    try {
      key = UUID.fromString(rawKey);
      if (!key.toString().equalsIgnoreCase(rawKey)) throw new IllegalArgumentException();
    } catch (IllegalArgumentException e) {
      throw new ApiFailure(400, "INVALID_IDEMPOTENCY_KEY", "Mã thao tác cần đúng định dạng UUID.");
    }
    var result = service.fund(actor.id(), key, (String) request.getAttribute("correlationId"));
    return ResponseEntity.status(result.originalHttpStatus()).body(result);
  }
}
