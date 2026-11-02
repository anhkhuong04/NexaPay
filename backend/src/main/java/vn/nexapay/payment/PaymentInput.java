package vn.nexapay.payment;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.*;
import java.text.Normalizer;
import java.util.UUID;
import vn.nexapay.shared.ApiFailure;

public final class PaymentInput {
  private PaymentInput() {}

  public record Create(
      @NotNull @Pattern(regexp = "[1-9][0-9]{0,8}") String amount,
      @NotNull @Pattern(regexp = "VND") String currency,
      @NotNull @Size(max = 560) String description,
      JsonNode expiryMinutes) {
    public Intent canonical() {
      long value = money(amount);
      String text = Normalizer.normalize(description.strip(), Normalizer.Form.NFC);
      int minutes = 30;
      if (expiryMinutes != null && !expiryMinutes.isNull()) {
        if (!expiryMinutes.isIntegralNumber() || !expiryMinutes.canConvertToInt()) throw invalid();
        minutes = expiryMinutes.intValue();
      }
      if (minutes < 5
          || minutes > 1440
          || text.isEmpty()
          || text.codePointCount(0, text.length()) > 140
          || description.codePoints().anyMatch(Character::isISOControl)) throw invalid();
      return new Intent(value, text, minutes);
    }
  }

  public record Pay(
      @NotNull @Pattern(regexp = "[1-9][0-9]{0,8}") String amount,
      @NotNull @Pattern(regexp = "VND") String currency) {
    public long canonical() {
      return money(amount);
    }
  }

  public record Intent(long amount, String description, int minutes) {}

  static long money(String text) {
    long value = Long.parseLong(text);
    if (value > 100000000) throw invalid();
    return value;
  }

  public static UUID key(String raw) {
    try {
      UUID key = UUID.fromString(raw);
      if (!key.toString().equalsIgnoreCase(raw)) throw new IllegalArgumentException();
      return key;
    } catch (IllegalArgumentException e) {
      throw new ApiFailure(400, "INVALID_IDEMPOTENCY_KEY", "Mã thao tác cần đúng định dạng UUID.");
    }
  }

  static ApiFailure invalid() {
    return new ApiFailure(400, "VALIDATION_ERROR", "Số tiền, mô tả hoặc thời hạn không hợp lệ.");
  }
}
