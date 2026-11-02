import { Button } from "@fluentui/react-components";
import { Link, useNavigate } from "react-router-dom";
import type { Wallet } from "./api";
import { Notice } from "./components";
export function OverviewActions({
  wallet,
  loading,
  error,
}: {
  wallet?: Wallet;
  loading: boolean;
  error?: unknown;
}) {
  const navigate = useNavigate();
  const available = !loading && !error && wallet?.status === "ACTIVE";
  const locked = !loading && !error && wallet?.status === "LOCKED";
  return (
    <section className="overview-actions" aria-label="Thao tác ví">
      {locked ? (
        <Notice error>
          Ví đang bị khóa. Bạn vẫn có thể xem lịch sử và tra cứu thao tác đã
          lưu.
        </Notice>
      ) : (
        !available && (
          <p className="helper">
            Cần tải thành công trạng thái ví để bắt đầu thao tác tiền.
          </p>
        )
      )}
      <div className="overview-action-links">
        <Button
          appearance="primary"
          disabled={!available}
          onClick={() => navigate("/app/send")}
        >
          Chuyển tiền
        </Button>
        <Button
          disabled={!available}
          onClick={() => navigate("/app/add-demo-funds")}
        >
          Nhận tiền demo
        </Button>
        <Link to="/app/transactions">Lịch sử giao dịch</Link>
        <Link to="/app/commands">Thao tác đã lưu</Link>
      </div>
    </section>
  );
}
