package vn.nexapay.transfer;

import jakarta.validation.constraints.*;
import java.text.Normalizer;
import java.util.UUID;
import vn.nexapay.shared.ApiFailure;

public record TransferInput(
    @NotNull
        @Pattern(
            regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        String destinationWalletId,
    @NotNull @Pattern(regexp = "[1-9][0-9]{0,8}") String amount,
    @NotNull @Pattern(regexp = "VND") String currency,
    @Size(max = 560) String note) {
  public record Intent(UUID destination, long amount, String note) {}

  public Intent canonical() {
    long value = Long.parseLong(amount);
    String text = Normalizer.normalize(note == null ? "" : note.strip(), Normalizer.Form.NFC);
    if (value > 100000000
        || text.codePointCount(0, text.length()) > 140
        || (note != null && note.codePoints().anyMatch(Character::isISOControl)))
      throw new ApiFailure(400, "VALIDATION_ERROR", "Số tiền hoặc lời nhắn không hợp lệ.");
    return new Intent(UUID.fromString(destinationWalletId), value, text);
  }
}
