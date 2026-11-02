package vn.nexapay.merchant;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.shared.ActorPrincipal;
import vn.nexapay.wallet.WalletService;

@RestController
@RequestMapping("/api/v1/merchants")
public class MerchantController {
  private final MerchantService merchants;

  public MerchantController(MerchantService merchants) {
    this.merchants = merchants;
  }

  public record Name(@NotNull String displayName) {}

  @PostMapping
  ResponseEntity<MerchantService.Profile> onboard(
      @AuthenticationPrincipal ActorPrincipal actor,
      @Valid @RequestBody Name body,
      HttpServletRequest request) {
    return ResponseEntity.status(201)
        .body(
            merchants.onboard(
                actor.id(), body.displayName(), (String) request.getAttribute("correlationId")));
  }

  @GetMapping("/me")
  MerchantService.Profile own(@AuthenticationPrincipal ActorPrincipal actor) {
    return merchants.own(actor.id());
  }

  @GetMapping("/{id}")
  MerchantService.Profile profile(
      @AuthenticationPrincipal ActorPrincipal actor, @PathVariable UUID id) {
    return merchants.profile(actor.id(), id);
  }

  @PatchMapping("/{id}")
  MerchantService.Profile rename(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable UUID id,
      @Valid @RequestBody Name body,
      HttpServletRequest request) {
    return merchants.rename(
        actor.id(), id, body.displayName(), (String) request.getAttribute("correlationId"));
  }

  @GetMapping("/{id}/wallet")
  WalletService.Wallet wallet(
      @AuthenticationPrincipal ActorPrincipal actor, @PathVariable UUID id) {
    return merchants.wallet(actor.id(), id);
  }
}
