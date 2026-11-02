package vn.nexapay.identity;

import java.time.Clock;
import java.util.Map;
import org.springframework.context.annotation.*;
import org.springframework.security.authentication.*;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.*;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.*;
import org.springframework.security.web.csrf.*;
import org.springframework.security.web.savedrequest.NullRequestCache;
import vn.nexapay.shared.ApiErrors;
import vn.nexapay.shared.ApiPayloadLimitFilter;

@Configuration
public class SecurityConfiguration {
  @Bean
  PasswordEncoder passwordEncoder() {
    return new DelegatingPasswordEncoder("bcrypt", Map.of("bcrypt", new BCryptPasswordEncoder(12)));
  }

  @Bean
  AuthenticationManager authenticationManager(UserDetailsService users, PasswordEncoder encoder) {
    DaoAuthenticationProvider provider = new DaoAuthenticationProvider(users);
    provider.setPasswordEncoder(encoder);
    return new ProviderManager(provider);
  }

  @Bean
  HttpSessionSecurityContextRepository securityContextRepository() {
    return new HttpSessionSecurityContextRepository();
  }

  @Bean
  HttpSessionCsrfTokenRepository csrfTokenRepository() {
    return new HttpSessionCsrfTokenRepository();
  }

  @Bean
  SecurityFilterChain security(
      HttpSecurity http,
      ApiErrors errors,
      Clock clock,
      HttpSessionSecurityContextRepository context,
      HttpSessionCsrfTokenRepository csrf)
      throws Exception {
    http.securityContext(c -> c.securityContextRepository(context))
        .requestCache(c -> c.requestCache(new NullRequestCache()))
        .csrf(c -> c.csrfTokenRepository(csrf))
        .authorizeHttpRequests(
            a ->
                a.requestMatchers(
                        "/api/v1/auth/csrf",
                        "/api/v1/auth/login",
                        "/api/v1/auth/register",
                        "/error")
                    .permitAll()
                    .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/v1/checkout/*")
                    .permitAll()
                    .requestMatchers("/api/**")
                    .authenticated()
                    .anyRequest()
                    .permitAll())
        .exceptionHandling(
            e ->
                e.authenticationEntryPoint(
                        (r, s, x) ->
                            errors.write(
                                r, s, 401, "UNAUTHENTICATED", "Vui lòng đăng nhập để tiếp tục."))
                    .accessDeniedHandler(
                        (r, s, x) ->
                            errors.write(
                                r,
                                s,
                                403,
                                x instanceof CsrfException ? "CSRF_INVALID" : "ACCESS_DENIED",
                                "Yêu cầu không được phép. Hãy làm mới phiên rồi thử lại.")))
        .logout(
            l ->
                l.logoutUrl("/api/v1/auth/logout")
                    .invalidateHttpSession(true)
                    .clearAuthentication(true)
                    .deleteCookies("JSESSIONID")
                    .logoutSuccessHandler((r, s, a) -> s.setStatus(204)))
        .headers(
            h ->
                h.contentSecurityPolicy(
                    c ->
                        c.policyDirectives(
                            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")))
        .addFilterAfter(new SessionExpiryFilter(clock), SecurityContextHolderFilter.class)
        .addFilterAfter(new ApiPayloadLimitFilter(errors), CsrfFilter.class);
    return http.build();
  }
}
