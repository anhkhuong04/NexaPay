import { Button, Spinner } from "@fluentui/react-components";
import {
  ArrowClockwise24Regular,
  ShieldCheckmark24Regular,
  Wallet24Regular,
} from "@fluentui/react-icons";
import { errorMessage, type Wallet } from "./api";
import { formatMoney } from "./validation";

export function Brand() {
  return (
    <img
      className="brand"
      src="/logo.png"
      alt="NexaPay"
      width="172"
      height="58"
    />
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "notice-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Loading({ text = "Đang tải…" }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <Spinner size="small" label={text} />
    </div>
  );
}
export function FetchError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <div className="fetch-error">
      <Notice error>{errorMessage(error)}</Notice>
      <Button onClick={retry} icon={<ArrowClockwise24Regular />}>
        Thử lại
      </Button>
    </div>
  );
}

export function WalletPanel({
  wallet,
  loading,
  error,
  retry,
}: {
  wallet?: Wallet;
  loading: boolean;
  error?: unknown;
  retry: () => void;
}) {
  if (loading)
    return (
      <section className="card balance-placeholder" aria-label="Số dư ví">
        <Loading text="Đang tải số dư ví…" />
      </section>
    );
  if (error || !wallet)
    return (
      <section className="card">
        <FetchError error={error} retry={retry} />
      </section>
    );
  return (
    <section className="balance-card" aria-label="Số dư ví">
      <div className="balance-top">
        <span className="balance-label">
          <Wallet24Regular aria-hidden />
          Ví cá nhân
        </span>
        <span
          className={`wallet-status ${wallet.status === "LOCKED" ? "locked" : ""}`}
        >
          {wallet.status === "LOCKED" ? "Ví bị khóa" : "Đang hoạt động"}
        </span>
      </div>
      <p>Số dư khả dụng</p>
      <div className="balance-amount" data-testid="wallet-balance">
        {formatMoney(wallet.availableBalance)}
      </div>
      <div className="balance-bottom">
        <span>
          VND <span aria-hidden>·</span> TIỀN MÔ PHỎNG
        </span>
        <ShieldCheckmark24Regular aria-hidden />
      </div>
      {wallet.status === "LOCKED" && (
        <p className="locked-copy">
          Ví đang bị khóa. Bạn vẫn có thể xem thông tin ví và hồ sơ.
        </p>
      )}
    </section>
  );
}
