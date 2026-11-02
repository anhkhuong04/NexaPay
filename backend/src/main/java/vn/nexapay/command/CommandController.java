package vn.nexapay.command;

import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.shared.ActorPrincipal;

@RestController
@RequestMapping("/api/v1/commands")
public class CommandController {
  private final CommandStore commands;

  public CommandController(CommandStore commands) {
    this.commands = commands;
  }

  @GetMapping("/{type}/{key}")
  CommandStore.Terminal lookup(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable String type,
      @PathVariable UUID key) {
    return commands.lookup(actor.id(), type, key);
  }

  @GetMapping
  CommandStore.Page recent(
      @AuthenticationPrincipal ActorPrincipal actor,
      @RequestParam(defaultValue = "20") int limit,
      @RequestParam(required = false) String cursor) {
    return commands.recent(actor.id(), limit, cursor);
  }
}
