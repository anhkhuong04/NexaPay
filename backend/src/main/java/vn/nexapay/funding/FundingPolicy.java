package vn.nexapay.funding;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public record FundingPolicy(@Value("${nexapay.funding.enabled:false}") boolean enabled) {
  public static final long PRESET = 100000, USER_LIMIT = 500000, ENVIRONMENT_LIMIT = 50000000;
}
