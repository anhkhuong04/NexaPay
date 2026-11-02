package vn.nexapay;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import vn.nexapay.shared.*;

class ApiPayloadLimitTest {
  @Test
  void boundsBodyWithoutContentLength() throws Exception {
    var request =
        new MockHttpServletRequest("POST", "/api/v1/auth/register") {
          @Override
          public long getContentLengthLong() {
            return -1;
          }
        };
    request.setAttribute("correlationId", "test");
    request.setContent(new byte[17000]);
    var response = new MockHttpServletResponse();
    var chain = new MockFilterChain();
    new ApiPayloadLimitFilter(new ApiErrors(new ObjectMapper())).doFilter(request, response, chain);
    assertThat(response.getStatus()).isEqualTo(413);
    assertThat(chain.getRequest()).isNull();
  }

  @Test
  void preservesAllowedBodyForJsonReader() throws Exception {
    var request = new MockHttpServletRequest("PATCH", "/api/v1/me");
    request.setContent(
        "{\"displayName\":\"Demo\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    var chain = new MockFilterChain();
    new ApiPayloadLimitFilter(new ApiErrors(new ObjectMapper()))
        .doFilter(request, new MockHttpServletResponse(), chain);
    assertThat(
            new String(
                chain.getRequest().getInputStream().readAllBytes(),
                java.nio.charset.StandardCharsets.UTF_8))
        .isEqualTo("{\"displayName\":\"Demo\"}");
  }
}
