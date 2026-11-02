package vn.nexapay.shared;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

@Component
public class ApiErrors {
  private final ObjectMapper mapper;

  public ApiErrors(ObjectMapper mapper) {
    this.mapper = mapper;
  }

  public Map<String, Object> body(
      HttpServletRequest request, String code, String message, Map<String, String> fields) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("code", code);
    body.put("message", message);
    body.put("correlationId", request.getAttribute("correlationId"));
    body.put("fieldErrors", fields);
    return body;
  }

  public ResponseEntity<Map<String, Object>> response(
      HttpServletRequest request,
      int status,
      String code,
      String message,
      Map<String, String> fields) {
    return ResponseEntity.status(status).body(body(request, code, message, fields));
  }

  public void write(
      HttpServletRequest request,
      HttpServletResponse response,
      int status,
      String code,
      String message)
      throws IOException {
    response.setStatus(status);
    response.setContentType("application/json;charset=UTF-8");
    mapper.writeValue(response.getOutputStream(), body(request, code, message, Map.of()));
  }
}
