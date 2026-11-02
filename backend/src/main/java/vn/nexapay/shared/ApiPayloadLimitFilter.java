package vn.nexapay.shared;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.springframework.web.filter.OncePerRequestFilter;

/** Bound JSON before deserialization, including chunked requests without Content-Length. */
public class ApiPayloadLimitFilter extends OncePerRequestFilter {
  private static final int MAX_BYTES = 16 * 1024;
  private final ApiErrors errors;

  public ApiPayloadLimitFilter(ApiErrors errors) {
    this.errors = errors;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws IOException, ServletException {
    if (!request.getRequestURI().startsWith("/api/")
        || request.getMethod().equals("GET")
        || request.getMethod().equals("HEAD")) {
      chain.doFilter(request, response);
      return;
    }
    if (request.getContentLengthLong() > MAX_BYTES) {
      reject(request, response);
      return;
    }
    byte[] bytes = request.getInputStream().readNBytes(MAX_BYTES + 1);
    if (bytes.length > MAX_BYTES) {
      reject(request, response);
      return;
    }
    chain.doFilter(
        new HttpServletRequestWrapper(request) {
          @Override
          public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(bytes);
            return new ServletInputStream() {
              @Override
              public int read() {
                return input.read();
              }

              @Override
              public boolean isFinished() {
                return input.available() == 0;
              }

              @Override
              public boolean isReady() {
                return true;
              }

              @Override
              public void setReadListener(ReadListener listener) {
                throw new IllegalStateException("Synchronous JSON requests only");
              }
            };
          }

          @Override
          public BufferedReader getReader() {
            return new BufferedReader(
                new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
          }
        },
        response);
  }

  private void reject(HttpServletRequest request, HttpServletResponse response) throws IOException {
    errors.write(request, response, 413, "REQUEST_TOO_LARGE", "Nội dung yêu cầu vượt quá 16 KiB.");
  }
}
