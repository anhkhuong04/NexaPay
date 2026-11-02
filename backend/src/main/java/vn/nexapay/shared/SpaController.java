package vn.nexapay.shared;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaController {
  @GetMapping({
    "/",
    "/auth/sign-in",
    "/auth/sign-up",
    "/pay/{ref}",
    "/business/payment-requests",
    "/business/payment-requests/new",
    "/business/payment-requests/{id}",
    "/business/transactions",
    "/business/onboarding",
    "/business/overview",
    "/business/settings",
    "/app/overview",
    "/app/profile",
    "/app/add-demo-funds",
    "/app/commands",
    "/app/send",
    "/app/transactions",
    "/app/transactions/{type}/{id}"
  })
  String shell() {
    return "forward:/index.html";
  }
}
