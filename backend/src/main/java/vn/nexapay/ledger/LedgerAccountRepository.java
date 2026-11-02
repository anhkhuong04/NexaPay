package vn.nexapay.ledger;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

interface LedgerAccountRepository extends JpaRepository<LedgerAccount, UUID> {}
