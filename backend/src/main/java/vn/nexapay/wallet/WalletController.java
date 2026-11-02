package vn.nexapay.wallet;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.shared.ActorPrincipal;

@RestController
@RequestMapping("/api/v1/wallets/me")
public class WalletController {
  private final WalletService wallets;

  public WalletController(WalletService wallets) {
    this.wallets = wallets;
  }

  @GetMapping
  WalletService.Wallet get(@AuthenticationPrincipal ActorPrincipal actor) {
    return wallets.own(actor.id());
  }
}
