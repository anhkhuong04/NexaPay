package vn.nexapay;

import static org.assertj.core.api.Assertions.*;

import org.junit.jupiter.api.Test;
import vn.nexapay.identity.IdentityService;
import vn.nexapay.profile.ProfileService;

class IdentityPolicyTest {
  @Test
  void passwordCountsCodePointsAndUtf8BytesWithoutTruncation() {
    assertThatCode(() -> IdentityService.validatePassword("é".repeat(36)))
        .doesNotThrowAnyException();
    assertThatThrownBy(() -> IdentityService.validatePassword("é".repeat(37)))
        .hasMessageContaining("72");
    assertThatThrownBy(() -> IdentityService.validatePassword("a".repeat(11)))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> IdentityService.validatePassword("a".repeat(65)))
        .isInstanceOf(RuntimeException.class);
    assertThatCode(() -> IdentityService.validatePassword("a".repeat(64)))
        .doesNotThrowAnyException();
  }

  @Test
  void nameIsPlainTextTrimmedAndBounded() {
    assertThat(ProfileService.validateName("  An  ")).isEqualTo("An");
    assertThatThrownBy(() -> ProfileService.validateName("\n"))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> ProfileService.validateName("a".repeat(81)))
        .isInstanceOf(RuntimeException.class);
    assertThatThrownBy(() -> ProfileService.validateName("a\nb"))
        .isInstanceOf(RuntimeException.class);
  }
}
