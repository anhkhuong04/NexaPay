package vn.nexapay.refund;

import jakarta.validation.constraints.*;
import java.text.Normalizer;
import vn.nexapay.shared.ApiFailure;

public record RefundInput(
    @NotNull @Pattern(regexp = "[1-9][0-9]{0,8}") String amount,
    @NotNull @Pattern(regexp = "VND") String currency,
    @Size(max = 560) String note) {
  public record Intent(long amount, String note) {}

  public Intent canonical() {
    long value = Long.parseLong(amount);
    String text = Normalizer.normalize(note == null ? "" : note.strip(), Normalizer.Form.NFC);
    if (value > 100000000
        || text.codePointCount(0, text.length()) > 140
        || (note != null && note.codePoints().anyMatch(Character::isISOControl)))
      throw new ApiFailure(400, "VALIDATION_ERROR", "Số tiền hoặc lý do hoàn tiền không hợp lệ.");
    return new Intent(value, text);
  }
}
