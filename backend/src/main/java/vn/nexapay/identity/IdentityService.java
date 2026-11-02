package vn.nexapay.identity;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vn.nexapay.profile.ProfileService;
import vn.nexapay.shared.ActorPrincipal;
import vn.nexapay.shared.ApiFailure;

@Service
public class IdentityService implements UserDetailsService {
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final RegistrationTransaction registration;

  public IdentityService(
      UserRepository users, PasswordEncoder encoder, RegistrationTransaction registration) {
    this.users = users;
    this.encoder = encoder;
    this.registration = registration;
  }

  public static String normalize(String email) {
    return email.strip().toLowerCase(Locale.ROOT);
  }

  public RegistrationTransaction.Created register(
      String email, String password, String name, String correlation) {
    validatePassword(password);
    String validated = ProfileService.validateName(name);
    String hash = encoder.encode(password);
    return registration.create(normalize(email), hash, validated, correlation);
  }

  public static void validatePassword(String password) {
    int points = password.codePointCount(0, password.length());
    if (points < 12 || points > 64 || password.getBytes(StandardCharsets.UTF_8).length > 72)
      throw new ApiFailure(
          400,
          "VALIDATION_ERROR",
          "Mật khẩu cần 12–64 ký tự và tối đa 72 byte UTF-8.",
          Map.of("password", "Mật khẩu không hợp lệ"));
  }

  @Override
  @Transactional(readOnly = true)
  public UserDetails loadUserByUsername(String email) {
    UserEntity user =
        users
            .findByEmail(normalize(email))
            .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    return new ActorPrincipal(user.id(), user.email(), user.hash(), user.roles(), user.active());
  }
}
