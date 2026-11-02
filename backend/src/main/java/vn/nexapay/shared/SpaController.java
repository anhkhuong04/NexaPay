package vn.nexapay.shared;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaController {
  @GetMapping({"/", "/auth/sign-in", "/auth/sign-up", "/app/overview", "/app/profile"})
  String shell() {
    return "forward:/index.html";
  }
}
