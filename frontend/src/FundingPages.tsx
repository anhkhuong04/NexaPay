import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { api, ApiError, errorMessage, type Session, type Wallet } from "./api";
import { FetchError, Loading, Notice } from "./components";
import {
  fundingApi,
  cacheTerminal,
  refreshMoneyViews,
  readRecovery,
  saveRecovery,
  RECOVERY_KEY,
  type CommandResult,
  type FundingCapabilities,
  type FundingInput,
} from "./funding";
import {
  rememberIntent,
  readMemoryIntent,
  clearMemoryIntent,
} from "./moneyDrafts";
import { formatMoney } from "./validation";

export function Receipt({ result }: { result: CommandResult }) {
  return (
    <section className="card funding-receipt" aria-label="Kết quả thao tác">
      <h2>
        {result.status === "SUCCEEDED"
          ? result.operationType === "TRANSFER"
            ? "Đã chuyển tiền"
            : result.operationType === "PAYMENT"
              ? "Đã thanh toán"
              : result.operationType === "REFUND"
                ? "Đã hoàn tiền"
                : "Đã nhận tiền demo"
          : "Thao tác bị từ chối"}
      </h2>
      <Notice error={result.status === "FAILED"}>
        {result.status === "SUCCEEDED"
          ? result.operationType === "TRANSFER"
            ? `Đã chuyển ${formatMoney(result.result.amount!)} đến ${result.result.recipientName}.`
            : result.operationType === "PAYMENT"
              ? `Đã thanh toán ${formatMoney(result.result.amount!)} cho ${result.result.recipientName}.`
              : result.operationType === "REFUND"
                ? `Đã hoàn ${formatMoney(result.result.amount!)} về ${result.result.recipientName}.`
                : `${formatMoney(result.result.amount!)} đã được ghi có vào ví của bạn.`
          : result.error.message}
      </Notice>
      <dl>
        {(result.operationType === "TRANSFER" ||
          result.operationType === "PAYMENT" ||
          result.operationType === "REFUND") && (
          <>
            <dt>Ví gửi</dt>
            <dd>{result.result.sourceWalletId}</dd>
            <dt>Người nhận</dt>
            <dd>
              {result.result.recipientName} ·{" "}
              {result.result.destinationWalletId}
            </dd>
            <dt>Số tiền</dt>
            <dd>{formatMoney(result.result.amount!)}</dd>
            <dt>Phí</dt>
            <dd>{formatMoney(result.result.fee ?? "0")}</dd>
            <dt>Lời nhắn</dt>
            <dd>{result.result.note || "—"}</dd>
          </>
        )}
        {(result.operationType === "PAYMENT" ||
          result.operationType === "REFUND") &&
          result.result.paymentId && (
            <>
              <dt>Mã thanh toán</dt>
              <dd>{result.result.paymentId}</dd>
            </>
          )}
        <dt>Mã giao dịch</dt>
        <dd>{result.resourceId}</dd>
        <dt>Thời gian</dt>
        <dd>
          {new Date(result.createdAt).toLocaleString("vi-VN", {
            timeZoneName: "short",
          })}
        </dd>
        <dt>Trạng thái</dt>
        <dd>{result.status === "SUCCEEDED" ? "Thành công" : "Bị từ chối"}</dd>
      </dl>
      <p>
        <Link
          to={
            result.operationType === "REFUND"
              ? `/business/refunds/${result.resourceId}`
              : `/app/transactions/${result.operationType}/${result.resourceId}`
          }
        >
          Xem chi tiết
        </Link>{" "}
        · <Link to="/app/overview">Về ví</Link>
      </p>
      <p>
        Kết quả này thuộc thao tác đã lưu. Số dư hiện tại được đọc riêng từ ví.
      </p>
    </section>
  );
}

function FundingPanel({
  session,
  capabilities,
  wallet,
}: {
  session: Session;
  capabilities: FundingCapabilities;
  wallet: Wallet;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [review, setReview] = useState(false);
  const [intent, setIntent] = useState<{
    key: string;
    operationType: CommandResult["operationType"];
    checkoutRef?: string;
    paymentId?: string;
    draft?: FundingInput;
  } | null>(() => {
    const saved = readRecovery(session.userId, capabilities.environmentEpoch);
    if (!saved) return null;
    const memory = readMemoryIntent(saved);
    return {
      key: saved.key,
      checkoutRef: saved.checkoutRef,
      paymentId: saved.paymentId,
      operationType: saved.operationType,
      draft: memory?.operationType === "DEMO_FUNDING" ? memory.body : undefined,
    };
  });
  const [notice, setNotice] = useState("");
  const command = useQuery({
    queryKey: ["command", session.userId, intent?.operationType, intent?.key],
    queryFn: ({ signal }) =>
      fundingApi.lookup(intent!.key, signal, intent!.operationType),
    enabled: Boolean(intent),
  });
  const mutation = useMutation({
    mutationFn: ({ key, body }: { key: string; body: FundingInput }) =>
      fundingApi.fund(key, body),
  });
  useEffect(() => {
    if (command.data) {
      clearMemoryIntent(
        session.userId,
        command.data.operationType,
        command.data.key,
      );
      refreshMoneyViews(client, session.userId);
    }
  }, [command.data, client, session.userId]);
  async function send(key: string, body: FundingInput) {
    setNotice("");
    try {
      const result = await mutation.mutateAsync({ key, body });
      cacheTerminal(client, session.userId, result);
    } catch (error) {
      if (
        client.getQueryData<Session | null>(["session"])?.userId !==
        session.userId
      )
        return;
      setNotice(
        "Chưa xác định được kết quả. Giữ nguyên mã thao tác và kiểm tra kết quả trước khi thử lại.",
      );
      if (error instanceof ApiError && error.status === 401) {
        await client.cancelQueries();
        client.setQueryData(["session"], null);
        navigate("/auth/sign-in", {
          replace: true,
          state: { from: "/app/add-demo-funds" },
        });
      }
    }
  }
  function confirm() {
    const key = crypto.randomUUID();
    const body: FundingInput = {
      amount: capabilities.presetAmount,
      currency: "VND",
    };
    try {
      saveRecovery({
        actorId: session.userId,
        environmentEpoch: capabilities.environmentEpoch,
        operationType: "DEMO_FUNDING",
        key,
      });
    } catch {
      setNotice(
        "Không thể lưu mã khôi phục trong tab này. Hãy cho phép sessionStorage rồi thử lại.",
      );
      setReview(false);
      return;
    }
    rememberIntent({
      actorId: session.userId,
      environmentEpoch: capabilities.environmentEpoch,
      operationType: "DEMO_FUNDING",
      key,
      body,
    });
    setIntent({ key, operationType: "DEMO_FUNDING", draft: body });
    setReview(false);
    void send(key, body);
  }
  const blocked =
    !capabilities.enabled ||
    wallet.status === "LOCKED" ||
    BigInt(capabilities.userRemaining) < BigInt(capabilities.presetAmount) ||
    BigInt(capabilities.environmentRemaining) <
      BigInt(capabilities.presetAmount);
  return (
    <>
      <section className="card funding-card">
        <h2>Tiền mô phỏng dành cho trải nghiệm</h2>
        <p>Không có giá trị thanh toán hoặc quy đổi thành tiền thật.</p>
        <div className="funding-amount">
          {formatMoney(capabilities.presetAmount)}
        </div>
        <dl>
          <dt>Còn lại hôm nay của bạn</dt>
          <dd>{formatMoney(capabilities.userRemaining)}</dd>
          <dt>Còn lại của môi trường</dt>
          <dd>{formatMoney(capabilities.environmentRemaining)}</dd>
          <dt>Đặt lại hạn mức</dt>
          <dd>
            {new Date(capabilities.nextResetAt).toLocaleString("vi-VN", {
              timeZoneName: "short",
            })}{" "}
            (giờ địa phương)
          </dd>
        </dl>
        {!capabilities.enabled && (
          <Notice>Tính năng cấp tiền demo đang tắt.</Notice>
        )}
        {wallet.status === "LOCKED" && (
          <Notice error>
            Ví đang bị khóa; bạn vẫn có thể kiểm tra kết quả cũ.
          </Notice>
        )}
        {capabilities.enabled &&
          (BigInt(capabilities.userRemaining) <
            BigInt(capabilities.presetAmount) ||
            BigInt(capabilities.environmentRemaining) <
              BigInt(capabilities.presetAmount)) && (
            <Notice>
              Đã hết hạn mức hôm nay. Vui lòng đợi thời điểm đặt lại.
            </Notice>
          )}
        {!intent && !review && (
          <Button
            appearance="primary"
            onClick={() => setReview(true)}
            disabled={blocked}
          >
            Nhận tiền demo
          </Button>
        )}
        {notice && <Notice>{notice}</Notice>}
        {intent && (
          <div className="funding-recovery">
            <p>
              Mã thao tác: <code>{intent.key}</code>
            </p>
            {mutation.isPending ? (
              <Loading text="Đang xử lý cấp tiền demo…" />
            ) : (
              <>
                {command.isFetching && (
                  <Loading text="Đang kiểm tra kết quả…" />
                )}
                {command.isError && (
                  <Notice>
                    {command.error instanceof ApiError &&
                    command.error.status === 404
                      ? "Chưa quan sát được kết quả đã lưu. Thao tác có thể còn đang chạy; đây chưa phải kết luận thất bại."
                      : errorMessage(command.error)}
                  </Notice>
                )}
                {!command.data && (
                  <div className="funding-actions">
                    <Button
                      onClick={() => void command.refetch()}
                      disabled={command.isFetching}
                    >
                      Kiểm tra kết quả
                    </Button>
                    {intent.operationType === "PAYMENT" &&
                      intent.checkoutRef && (
                        <Link to={`/pay/${intent.checkoutRef}`}>
                          Tiếp tục thanh toán
                        </Link>
                      )}
                    {intent.operationType === "REFUND" && (
                      <Link
                        to={`/business/payments/${intent.paymentId}/refund`}
                      >
                        Tiếp tục hoàn tiền
                      </Link>
                    )}
                    {intent.operationType === "TRANSFER" && (
                      <Link to="/app/send">Tiếp tục chuyển tiền</Link>
                    )}
                    {intent.draft && (
                      <Button
                        onClick={() => void send(intent.key, intent.draft!)}
                        disabled={command.isFetching}
                      >
                        Thử lại cùng mã
                      </Button>
                    )}
                  </div>
                )}
                {command.data && (
                  <Button
                    onClick={() => {
                      sessionStorage.removeItem(RECOVERY_KEY);
                      setIntent(null);
                      setNotice("");
                    }}
                  >
                    Bắt đầu thao tác mới
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </section>
      {command.data && <Receipt result={command.data} />}
      <p>
        <Link to="/app/commands">Xem các thao tác đã lưu</Link>
      </p>
      {review && (
        <section
          className="card funding-review"
          aria-label="Xác nhận nhận tiền demo"
        >
          <h2>Xác nhận nhận tiền demo</h2>
          <p>
            Nhận <strong>{formatMoney(capabilities.presetAmount)}</strong> vào
            ví cá nhân {wallet.id}.
          </p>
          <p>Đây là tiền mô phỏng, không có giá trị thực.</p>
          <div className="funding-actions">
            <Button autoFocus onClick={() => setReview(false)}>
              Quay lại
            </Button>
            <Button appearance="primary" onClick={confirm}>
              Xác nhận cấp tiền
            </Button>
          </div>
        </section>
      )}
    </>
  );
}

export function FundingPage() {
  const session = useOutletContext<Session>();
  const capabilities = useQuery({
    queryKey: ["funding", session.userId, "personal"],
    queryFn: ({ signal }) => fundingApi.capabilities(signal),
  });
  const wallet = useQuery({
    queryKey: ["wallet", session.userId, "personal"],
    queryFn: ({ signal }) => api.wallet(signal),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Nhận tiền demo</h1>
          <p>Một khoản cấp mô phỏng, có hạn mức và có thể tra cứu.</p>
        </div>
      </div>
      {capabilities.isPending || wallet.isPending ? (
        <Loading />
      ) : capabilities.isError || wallet.isError ? (
        <FetchError
          error={capabilities.error ?? wallet.error}
          retry={() => {
            void capabilities.refetch();
            void wallet.refetch();
          }}
        />
      ) : (
        <FundingPanel
          key={`${session.userId}:${capabilities.data.environmentEpoch}`}
          session={session}
          capabilities={capabilities.data}
          wallet={wallet.data}
        />
      )}
    </>
  );
}

export function CommandsPage() {
  const session = useOutletContext<Session>();
  const [selected, setSelected] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["commands", session.userId, "personal"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fundingApi.recent(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const selectedResult = list.data?.pages
    .flatMap((page) => page.items)
    .find((result) => `${result.operationType}:${result.key}` === selected);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Thao tác đã lưu</h1>
          <p>
            Những thao tác đã có kết quả được lưu cho tài khoản của bạn. Một
            thao tác chưa xuất hiện ở đây vẫn có thể đang xử lý.
          </p>
        </div>
        <Button onClick={() => void list.refetch()}>Tải lại</Button>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <FetchError error={list.error} retry={() => void list.refetch()} />
      ) : (
        <section className="card command-list">
          {list.data.pages.flatMap((p) => p.items).length === 0 && (
            <p>Bạn chưa có thao tác đã lưu.</p>
          )}
          {list.data.pages
            .flatMap((p) => p.items)
            .map((result) => (
              <div
                className="command-row"
                key={`${result.operationType}:${result.key}`}
              >
                <div>
                  <strong>
                    {result.status === "SUCCEEDED"
                      ? result.operationType === "TRANSFER"
                        ? "Đã chuyển tiền"
                        : result.operationType === "PAYMENT"
                          ? "Đã thanh toán"
                          : result.operationType === "REFUND"
                            ? "Đã hoàn tiền"
                            : "Đã nhận tiền demo"
                      : result.operationType === "TRANSFER"
                        ? "Chuyển tiền bị từ chối"
                        : result.operationType === "PAYMENT"
                          ? "Thanh toán bị từ chối"
                          : result.operationType === "REFUND"
                            ? "Hoàn tiền bị từ chối"
                            : "Cấp tiền bị từ chối"}
                  </strong>
                  <p>
                    {new Date(result.createdAt).toLocaleString("vi-VN", {
                      timeZoneName: "short",
                    })}
                  </p>
                  <code>{result.resourceId}</code>
                </div>
                <Button
                  onClick={() =>
                    setSelected(`${result.operationType}:${result.key}`)
                  }
                >
                  Xem kết quả
                </Button>
              </div>
            ))}
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Xem thêm
            </Button>
          )}
        </section>
      )}
      {selectedResult && <Receipt result={selectedResult} />}
    </>
  );
}
