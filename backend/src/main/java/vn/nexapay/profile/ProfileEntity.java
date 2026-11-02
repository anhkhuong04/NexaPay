package vn.nexapay.profile;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "profiles")
class ProfileEntity {
  @Id private UUID userId;
  private String displayName;
  private Instant updatedAt;

  protected ProfileEntity() {}

  ProfileEntity(UUID user, String name, Instant now) {
    userId = user;
    displayName = name;
    updatedAt = now;
  }

  String name() {
    return displayName;
  }

  void rename(String name, Instant now) {
    displayName = name;
    updatedAt = now;
  }
}
