package vn.nexapay.history;

import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import vn.nexapay.shared.ActorPrincipal;

@RestController
@RequestMapping("/api/v1")
public class HistoryController {
  private final HistoryService service;

  public HistoryController(HistoryService service) {
    this.service = service;
  }

  @GetMapping("/transactions")
  HistoryService.Page list(
      @AuthenticationPrincipal ActorPrincipal actor,
      @RequestParam(defaultValue = "20") int limit,
      @RequestParam(required = false) String cursor,
      @RequestParam(required = false) String type,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String from,
      @RequestParam(required = false) String to) {
    return service.list(actor.id(), limit, cursor, type, status, from, to);
  }

  @GetMapping("/transactions/{type}/{id}")
  HistoryService.Transaction detail(
      @AuthenticationPrincipal ActorPrincipal actor,
      @PathVariable String type,
      @PathVariable UUID id) {
    return service.detail(actor.id(), type, id);
  }

  @GetMapping("/transfers/{id}")
  HistoryService.Transaction transfer(
      @AuthenticationPrincipal ActorPrincipal actor, @PathVariable UUID id) {
    return service.detail(actor.id(), "TRANSFER", id);
  }
}
