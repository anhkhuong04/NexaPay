import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, ApiError, errorMessage, type Session, type Wallet } from "./api";
import { Brand, FetchError, Loading, Notice } from "./components";
import { Receipt } from "./FundingPages";
import {
  recoveryPath,
  cacheTerminal,
  refreshMoneyViews,
  fundingApi,
  readRecovery,
  saveRecovery,
  RECOVERY_KEY,
  type Recovery,
} from "./funding";
import {
  rememberIntent,
  readMemoryIntent,
  clearMemoryIntent,
} from "./moneyDrafts";
import {
  paymentApi,
  statusLabel,
  checkoutPath,
  type Checkout,
  type PaymentCapabilities,
  type PayInput,
} from "./payment";
import { sessionOptions } from "./session";
import { formatMoney } from "./validation";

export function PaymentReview({
  checkout,
  wallet,
  confirm,
  back,
  fee,
}: {
  checkout: Checkout;
  wallet: Wallet;
  confirm: () => void;
  back: () => void;
  fee: string;
}) {
  return (
    <section className="card payment-review" aria-label="Xác nhận thanh toán">
      <h2>Xác nhận thanh toán</h2>
      <dl className="merchant-metadata">
        <dt>Doanh nghiệp</dt>
        <dd>{checkout.merchantName}</dd>
        <dt>Số tiền / tổng trừ</dt>
        <dd>
          <strong>{formatMoney(checkout.amount)}</strong>
        </dd>
        <dt>Phí</dt>
        <dd>{formatMoney(fee)}</dd>
        <dt>Mô tả</dt>
        <dd>{checkout.description}</dd>
        <dt>Ví cá nhân trả tiền</dt>
        <dd>
          <code>{wallet.id}</code>
        </dd>
        <dt>Số dư khả dụng hiện tại</dt>
        <dd>{formatMoney(wallet.availableBalance)}</dd>
      </dl>
      <p>
        VND mô phỏng, không có giá trị thanh toán thật. Số dư và hiệu lực yêu
        cầu được kiểm tra lại khi xác nhận.
      </p>
      {(checkout.status !== "PENDING" || wallet.status !== "ACTIVE") && (
        <Notice error>
          Yêu cầu hoặc ví hiện không thể thanh toán mới. Bạn vẫn có thể quay lại
          và tra cứu thao tác đã lưu.
        </Notice>
      )}
      <div className="funding-actions">
        <Button autoFocus onClick={back}>
          Quay lại
        </Button>
        <Button
          appearance="primary"
          disabled={checkout.status !== "PENDING" || wallet.status !== "ACTIVE"}
          onClick={confirm}
        >
          Xác nhận thanh toán
        </Button>
      </div>
    </section>
  );
}
function PayPanel({
  session,
  checkout,
  caps,
  wallet,
}: {
  session: Session;
  checkout: Checkout;
  caps: PaymentCapabilities;
  wallet: Wallet;
}) {
  const client = useQueryClient();
  const [intent, setIntent] = useState<Recovery | null>(() =>
    readRecovery(session.userId, caps.environmentEpoch),
  );
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState("");
  const command = useQuery({
    queryKey: ["command", session.userId, intent?.operationType, intent?.key],
    queryFn: ({ signal }) =>
      fundingApi.lookup(intent!.key, signal, intent!.operationType),
    enabled: Boolean(intent),
  });
  const mutation = useMutation({
    mutationFn: ({ key, body }: { key: string; body: PayInput }) =>
      paymentApi.pay(key, body),
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
  const refetch = command.refetch;
  useEffect(() => {
    if (!intent || mutation.isPending || command.data) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const delays = [2000, 3000, 5000, 8000, 13000, 20000];
    function schedule(i: number) {
      if (stopped || i >= delays.length) return;
      timer = setTimeout(() => {
        void refetch().then((r) => {
          if (
            !stopped &&
            !r.data &&
            !(r.error instanceof ApiError && r.error.status === 401)
          )
            schedule(i + 1);
        });
      }, delays[i]);
    }
    schedule(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intent, mutation.isPending, command.data, refetch]);
  const memory = intent ? readMemoryIntent(intent) : null;
  const draft = memory?.operationType === "PAYMENT" ? memory.body : undefined;
  async function send(key: string, body: PayInput) {
    setNotice("");
    try {
      const result = await mutation.mutateAsync({ key, body });
      cacheTerminal(client, session.userId, result);
    } catch (e) {
      if (
        client.getQueryData<Session | null>(["session"])?.userId !==
        session.userId
      )
        return;
      if (e instanceof ApiError && e.status === 401) {
        client.setQueryData(["session"], null);
        // Checkout is public: return to its login prompt, whose link preserves this route.
        // A concurrent lookup 401 can clear the same session first; neither path re-POSTs.
        return;
      }
      setNotice(
        "Chưa xác định được kết quả. Giữ mã thao tác và kiểm tra trạng thái trước khi thử lại. " +
          errorMessage(e),
      );
    }
  }
  function confirm() {
    const key = crypto.randomUUID();
    const body: PayInput = {
      reference: checkout.publicRef,
      amount: checkout.amount,
      currency: "VND",
    };
    const ref: Recovery = {
      actorId: session.userId,
      environmentEpoch: caps.environmentEpoch,
      operationType: "PAYMENT",
      checkoutRef: checkout.publicRef,
      key,
    };
    try {
      saveRecovery(ref);
      rememberIntent({ ...ref, operationType: "PAYMENT", body });
    } catch {
      setNotice(
        "Chưa thể lưu mã thao tác trên trình duyệt. Chưa gửi thanh toán.",
      );
      return;
    }
    setIntent(ref);
    setReview(false);
    void send(key, body);
  }
  if (intent)
    return (
      <section className="payment-result">
        <h2>Tra cứu thao tác đã lưu</h2>
        <p>
          Mã thao tác: <code>{intent.key}</code>
        </p>
        {mutation.isPending ? (
          <Loading text="Đang xác nhận thanh toán…" />
        ) : (
          <>
            {notice && <Notice>{notice}</Notice>}
            {command.isFetching && <Loading text="Đang kiểm tra kết quả…" />}
            {command.data ? (
              <>
                <Receipt result={command.data} />
                <Button
                  onClick={() => {
                    sessionStorage.removeItem(RECOVERY_KEY);
                    setIntent(null);
                    setNotice("");
                  }}
                >
                  Bắt đầu thanh toán mới
                </Button>
              </>
            ) : (
              <>
                {command.isError && (
                  <Notice>
                    {command.error instanceof ApiError &&
                    command.error.status === 404
                      ? "Chưa quan sát được kết quả đã lưu; đây chưa phải kết luận thất bại."
                      : errorMessage(command.error)}
                  </Notice>
                )}
                <div className="funding-actions">
                  <Button
                    disabled={command.isFetching}
                    onClick={() => void command.refetch()}
                  >
                    Kiểm tra trạng thái
                  </Button>
                  {draft &&
                    intent.operationType === "PAYMENT" &&
                    intent.checkoutRef === checkout.publicRef && (
                      <Button
                        disabled={command.isFetching}
                        onClick={() => void send(intent.key, draft)}
                      >
                        Thử lại cùng mã
                      </Button>
                    )}
                  {intent.operationType === "PAYMENT" &&
                    intent.checkoutRef !== checkout.publicRef && (
                      <Link to={checkoutPath(intent.checkoutRef!)}>
                        Mở thanh toán đang xử lý
                      </Link>
                    )}
                  {intent.operationType !== "PAYMENT" && (
                    <Link to={recoveryPath(intent)}>
                      Tiếp tục thao tác đang lưu
                    </Link>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>
    );
  if (review)
    return (
      <PaymentReview
        checkout={checkout}
        wallet={wallet}
        fee={caps.fee}
        back={() => setReview(false)}
        confirm={confirm}
      />
    );
  return (
    <section className="card">
      <h2>Ví cá nhân trả tiền</h2>
      <p>
        Số dư khả dụng hiện tại:{" "}
        <strong data-testid="checkout-balance">
          {formatMoney(wallet.availableBalance)}
        </strong>
      </p>
      {wallet.status === "LOCKED" && (
        <Notice error>
          Ví cá nhân đang bị khóa. Bạn vẫn có thể tra cứu kết quả đã lưu.
        </Notice>
      )}
      {notice && <Notice>{notice}</Notice>}
      <Button
        appearance="primary"
        disabled={wallet.status !== "ACTIVE" || checkout.status !== "PENDING"}
        onClick={() => setReview(true)}
      >
        Xem lại thanh toán
      </Button>
    </section>
  );
}
function AuthenticatedCheckout({
  session,
  checkout,
}: {
  session: Session;
  checkout: Checkout;
}) {
  const caps = useQuery({
    queryKey: ["payment-capabilities", session.userId],
    queryFn: ({ signal }) => paymentApi.capabilities(signal),
  });
  const wallet = useQuery({
    queryKey: ["wallet", session.userId, "personal"],
    queryFn: ({ signal }) => api.wallet(signal),
  });
  if (caps.isPending || wallet.isPending)
    return <Loading text="Đang tải thông tin trả tiền…" />;
  if (caps.isError)
    return <FetchError error={caps.error} retry={() => void caps.refetch()} />;
  if (wallet.isError)
    return (
      <FetchError error={wallet.error} retry={() => void wallet.refetch()} />
    );
  return (
    <PayPanel
      key={`${session.userId}:${checkout.publicRef}:${caps.data.environmentEpoch}`}
      session={session}
      checkout={checkout}
      caps={caps.data}
      wallet={wallet.data}
    />
  );
}
export function CheckoutPage() {
  const { ref = "" } = useParams();
  const session = useQuery(sessionOptions);
  const checkout = useQuery({
    queryKey: ["checkout", session.data?.userId ?? "public", ref],
    queryFn: ({ signal }) => paymentApi.checkout(ref, signal),
    refetchInterval: (query) =>
      query.state.data?.status === "PENDING" ? 15000 : false,
  });
  return (
    <main id="main-content" tabIndex={-1} className="checkout-page">
      <header className="checkout-header">
        <Link to="/" aria-label="NexaPay — trang chủ">
          <Brand />
        </Link>
        <span className="header-demo">Thanh toán mô phỏng</span>
      </header>
      <h1>Thanh toán doanh nghiệp</h1>
      {checkout.isPending ? (
        <Loading text="Đang tải yêu cầu thanh toán…" />
      ) : checkout.isError ? (
        <FetchError
          error={checkout.error}
          retry={() => void checkout.refetch()}
        />
      ) : (
        <>
          <section
            className="card checkout-summary"
            aria-label="Yêu cầu thanh toán"
          >
            <h2>{checkout.data.merchantName}</h2>
            <strong className="business-balance">
              {formatMoney(checkout.data.amount)}
            </strong>
            <p>{checkout.data.description}</p>
            <p>
              Trạng thái: <strong>{statusLabel(checkout.data.status)}</strong>
            </p>
            <p>
              Hết hạn:{" "}
              <time dateTime={checkout.data.expiresAt}>
                {new Date(checkout.data.expiresAt).toLocaleString("vi-VN", {
                  timeZoneName: "short",
                })}
              </time>
            </p>
            <p className="helper">
              Thời hạn do máy chủ xác định khi xử lý. Không nhập thông tin thẻ
              hoặc ngân hàng.
            </p>
          </section>
          {session.isPending ? (
            <Loading text="Đang kiểm tra phiên…" />
          ) : session.isError ? (
            <FetchError
              error={session.error}
              retry={() => void session.refetch()}
            />
          ) : session.data ? (
            <AuthenticatedCheckout
              session={session.data}
              checkout={checkout.data}
            />
          ) : (
            <section className="card">
              <h2>Đăng nhập để xác nhận</h2>
              <p>
                Kiểm tra doanh nghiệp và số tiền, sau đó đăng nhập vào ví cá
                nhân của bạn.
              </p>
              <Link
                className="button-link"
                to="/auth/sign-in"
                state={{ from: checkoutPath(ref) }}
              >
                Đăng nhập để thanh toán
              </Link>
            </section>
          )}
        </>
      )}
      {session.data && (
        <nav className="funding-actions" aria-label="Điều hướng thanh toán">
          <Link to="/app/overview">Về ví cá nhân</Link>
          <Link to="/app/commands">Thao tác đã lưu</Link>
        </nav>
      )}
    </main>
  );
}
