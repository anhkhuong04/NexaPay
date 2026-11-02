package vn.nexapay.shared;

import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ErrorHandler {
  private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);
  private final ApiErrors errors;

  public ErrorHandler(ApiErrors errors) {
    this.errors = errors;
  }

  @ExceptionHandler(ApiFailure.class)
  ResponseEntity<?> business(ApiFailure e, HttpServletRequest r) {
    var response = errors.response(r, e.status(), e.code(), e.getMessage(), e.fields());
    if (e.status() == 429)
      return ResponseEntity.status(429)
          .header("Retry-After", e.code().equals("COMMAND_THROTTLED") ? "60" : "900")
          .body(response.getBody());
    return response;
  }

  @ExceptionHandler({
    org.springframework.web.bind.MissingRequestHeaderException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<?> arguments(HttpServletRequest r) {
    return errors.response(
        r, 400, "INVALID_REQUEST", "Header hoặc tham số không hợp lệ.", Map.of());
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<?> invalid(MethodArgumentNotValidException e, HttpServletRequest r) {
    Map<String, String> fields = new LinkedHashMap<>();
    e.getBindingResult()
        .getFieldErrors()
        .forEach(f -> fields.putIfAbsent(f.getField(), "Thông tin không hợp lệ"));
    return errors.response(
        r, 400, "VALIDATION_ERROR", "Vui lòng kiểm tra thông tin đã nhập.", fields);
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<?> unreadable(HttpServletRequest r) {
    return errors.response(r, 400, "INVALID_REQUEST", "Nội dung yêu cầu không hợp lệ.", Map.of());
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<?> conflict(HttpServletRequest r) {
    return errors.response(
        r,
        409,
        "ACCOUNT_CONFLICT",
        "Thông tin đăng ký không thể sử dụng. Hãy đăng nhập nếu đã có tài khoản.",
        Map.of());
  }

  @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
  ResponseEntity<?> missing(HttpServletRequest r) {
    return errors.response(r, 404, "NOT_FOUND", "Không tìm thấy tài nguyên.", Map.of());
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<?> unexpected(Exception e, HttpServletRequest r) {
    log.error(
        "request_failed correlationId={} type={}",
        r.getAttribute("correlationId"),
        e.getClass().getSimpleName());
    return errors.response(
        r, 500, "INTERNAL_ERROR", "Chưa thể xử lý yêu cầu. Vui lòng thử lại sau.", Map.of());
  }
}
