package vn.nexapay.identity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "users")
class UserEntity {
  @Id private UUID id;
  private String email;
  private String passwordHash;
  private String status;

  @Column(insertable = false, updatable = false)
  private Instant createdAt;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "user_roles", joinColumns = @JoinColumn(name = "user_id"))
  @Column(name = "role")
  private Set<String> roles = new HashSet<>();

  protected UserEntity() {}

  UserEntity(UUID id, String email, String hash) {
    this.id = id;
    this.email = email;
    this.passwordHash = hash;
    this.status = "ACTIVE";
    roles.add("INDIVIDUAL");
  }

  UUID id() {
    return id;
  }

  String email() {
    return email;
  }

  String hash() {
    return passwordHash;
  }

  boolean active() {
    return "ACTIVE".equals(status);
  }

  List<String> roles() {
    return roles.stream().sorted().toList();
  }
}
