package vn.nexapay.profile;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.shared.ActorPrincipal;

@RestController
@RequestMapping("/api/v1/me")
public class ProfileController {
  private final ProfileService profiles;

  public ProfileController(ProfileService profiles) {
    this.profiles = profiles;
  }

  public record Profile(UUID id, String email, String displayName) {}

  public record Patch(@NotBlank String displayName) {}

  @GetMapping
  Profile get(@AuthenticationPrincipal ActorPrincipal actor) {
    return new Profile(actor.id(), actor.email(), profiles.name(actor.id()));
  }

  @PatchMapping
  Profile patch(
      @AuthenticationPrincipal ActorPrincipal actor,
      @Valid @RequestBody Patch body,
      HttpServletRequest request) {
    return new Profile(
        actor.id(),
        actor.email(),
        profiles.rename(
            actor.id(), body.displayName(), (String) request.getAttribute("correlationId")));
  }
}
