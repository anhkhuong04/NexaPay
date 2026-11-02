package vn.nexapay.profile;

import java.time.Clock;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import vn.nexapay.audit.AuditService;
import vn.nexapay.shared.ApiFailure;

@Service
public class ProfileService {
  private final ProfileRepository repository;
  private final AuditService audit;
  private final Clock clock;

  public ProfileService(ProfileRepository repository, AuditService audit, Clock clock) {
    this.repository = repository;
    this.audit = audit;
    this.clock = clock;
  }

  @Transactional(propagation = Propagation.MANDATORY)
  public void create(UUID user, String name) {
    repository.save(new ProfileEntity(user, validateName(name), clock.instant()));
  }

  @Transactional(readOnly = true)
  public String name(UUID user) {
    return find(user).name();
  }

  @Transactional
  public String rename(UUID user, String name, String correlation) {
    String validated = validateName(name);
    find(user).rename(validated, clock.instant());
    audit.record(user, "PROFILE_RENAMED", user, correlation);
    return validated;
  }

  private ProfileEntity find(UUID user) {
    return repository
        .findById(user)
        .orElseThrow(() -> new ApiFailure(404, "PROFILE_NOT_FOUND", "Không tìm thấy hồ sơ."));
  }

  public static String validateName(String name) {
    String n = name == null ? "" : name.strip();
    if (n.isEmpty()
        || n.codePointCount(0, n.length()) > 80
        || n.codePoints().anyMatch(Character::isISOControl))
      throw new ApiFailure(
          400,
          "VALIDATION_ERROR",
          "Tên hiển thị phải có từ 1 đến 80 ký tự.",
          java.util.Map.of("displayName", "Tên hiển thị không hợp lệ"));
    return n;
  }
}
