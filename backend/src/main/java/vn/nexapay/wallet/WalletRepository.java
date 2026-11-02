package vn.nexapay.wallet;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface WalletRepository extends JpaRepository<WalletEntity, UUID> {
  Optional<WalletEntity> findByUserId(UUID user);
}
