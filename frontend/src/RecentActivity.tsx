import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FetchError, Loading } from "./components";
import {
  directionLabel,
  localTime,
  transferApi,
  type Transaction,
} from "./transfer";
import { formatMoney } from "./validation";
export const recentActivityKey = (actorId: string) =>
  ["history", actorId, "recent", 5] as const;
const filter = { type: "", status: "", from: "", to: "" };
function Activity({ transaction: t }: { transaction: Transaction }) {
  const succeeded = t.status === "SUCCEEDED";
  const party =
    t.direction === "FUNDING"
      ? "Nguồn cấp tiền mô phỏng"
      : t.direction === "INCOMING"
        ? t.senderName
        : t.recipientName;
  const wallet =
    t.direction === "INCOMING"
      ? t.sourceWalletId
      : t.direction === "OUTGOING"
        ? t.destinationWalletId
        : null;
  const amount = `${succeeded ? (t.direction === "OUTGOING" ? "−" : "+") : ""}${formatMoney(t.amount)}`;
  return (
    <li>
      <article className="recent-row">
        <div className="recent-description">
          <h3>{directionLabel(t.direction)}</h3>
          <p className="recent-party">
            {party || "Ví người nhận không tồn tại"}
          </p>
          {wallet && <code>{wallet}</code>}
          <time dateTime={t.createdAt}>{localTime(t.createdAt)}</time>
        </div>
        <div className="recent-result">
          <strong className="recent-amount">{amount}</strong>
          <p className={`transaction-status ${succeeded ? "" : "rejected"}`}>
            {succeeded ? "Thành công" : "Bị từ chối"}
          </p>
          {!succeeded && (
            <p className="recent-rejection">
              {t.direction === "FUNDING"
                ? "Không ghi có tiền"
                : "Không trừ tiền"}
            </p>
          )}
          <Link
            aria-label={`Xem chi tiết giao dịch ${t.id}`}
            to={`/app/transactions/${t.operationType}/${t.id}`}
          >
            Xem chi tiết
          </Link>
        </div>
      </article>
    </li>
  );
}
export function RecentActivity({ actorId }: { actorId: string }) {
  const activity = useQuery({
    queryKey: recentActivityKey(actorId),
    queryFn: ({ signal }) => transferApi.history(filter, undefined, signal, 5),
  });
  return (
    <section className="card recent-activity" aria-labelledby="recent-heading">
      <div className="section-heading">
        <h2 id="recent-heading">Giao dịch gần đây</h2>
        <Link to="/app/transactions">Xem toàn bộ lịch sử</Link>
      </div>
      {activity.isPending ? (
        <Loading text="Đang tải giao dịch gần đây…" />
      ) : activity.isError ? (
        <FetchError
          error={activity.error}
          retry={() => void activity.refetch()}
        />
      ) : activity.data.items.length === 0 ? (
        <div className="recent-empty">
          <p>Bạn chưa có giao dịch.</p>
          <p>
            Khi bạn nhận tiền demo hoặc chuyển tiền, kết quả sẽ xuất hiện tại
            đây.
          </p>
        </div>
      ) : (
        <ul className="recent-list">
          {activity.data.items.map((t) => (
            <Activity key={`${t.operationType}:${t.id}`} transaction={t} />
          ))}
        </ul>
      )}
      <p className="recent-recovery">
        <Link to="/app/commands">Thao tác đã lưu</Link> · Tra cứu kết quả khi
        chưa xác định được giao dịch.
      </p>
    </section>
  );
}
