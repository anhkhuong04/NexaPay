import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  Textarea,
  Select,
} from "@fluentui/react-components";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { ApiError, errorMessage, type Session, type Wallet } from "./api";
import { FetchError, Loading, Notice } from "./components";
import { merchantApi, merchantKey, type Merchant } from "./merchant";
import { paymentApi, type Payment, type PaymentCapabilities } from "./payment";
import {
  refundApi,
  refundStatusLabel,
  type Refund,
  type RefundInput,
} from "./refund";
import {
  cacheTerminal,
  refreshMoneyViews,
  fundingApi,
  readRecovery,
  saveRecovery,
  recoveryPath,
  RECOVERY_KEY,
  type Recovery,
} from "./funding";
import {
  rememberIntent,
  readMemoryIntent,
  clearMemoryIntent,
} from "./moneyDrafts";
import { Receipt } from "./FundingPages";
import { parseVndInput, localTime } from "./transfer";
import { formatMoney } from "./validation";

export function RefundReview({
  payment,
  wallet,
  body,
  blocked,
  fee,
  confirm,
  back,
}: {
  payment: Payment;
  wallet: Wallet;
  body: RefundInput;
  blocked: boolean;
  fee: string;
  confirm: () => void;
  back: () => void;
}) {
  return (
    <section className="card" aria-label="Xác nhận hoàn tiền">
      <h2>Xác nhận hoàn tiền</h2>
      <dl className="merchant-metadata">
        <dt>Thanh toán gốc</dt>
        <dd>
          <code>{payment.id}</code>
        </dd>
        <dt>Số tiền gốc</dt>
        <dd>{formatMoney(payment.amount)}</dd>
        <dt>Phần còn được hoàn hiện tại</dt>
        <dd>{formatMoney(payment.refundableAmount)}</dd>
        <dt>Số tiền hoàn / tổng trừ</dt>
        <dd>
          <strong>{formatMoney(body.amount)}</strong>
        </dd>
        <dt>Phí</dt>
        <dd>{formatMoney(fee)}</dd>
        <dt>Người nhận gốc</dt>
        <dd>{payment.payerName}</dd>
        <dt>Ví doanh nghiệp nguồn</dt>
        <dd>
          <code>{wallet.id}</code>
        </dd>
        <dt>Số dư hiện tại</dt>
        <dd>{formatMoney(wallet.availableBalance)}</dd>
        <dt>Lý do</dt>
        <dd>{body.note || "—"}</dd>
      </dl>
      <p>
        VND mô phỏng. Chỉ hoàn về người trả gốc; người nhận bị khóa ví vẫn được
        nhận hoàn tiền. Máy chủ kiểm tra lại hạn mức và số dư khi xác nhận.
      </p>
      {blocked && (
        <Notice error>
          Thông tin hiện tại không cho phép intent này. Quay lại để kiểm tra
          phần còn được hoàn và trạng thái ví.
        </Notice>
      )}
      <div className="funding-actions">
        <Button autoFocus onClick={back}>
          Quay lại
        </Button>
        <Button appearance="primary" disabled={blocked} onClick={confirm}>
          Xác nhận hoàn tiền
        </Button>
      </div>
    </section>
  );
}
function RefundPanel({
  session,
  merchant,
  payment,
  wallet,
  caps,
}: {
  session: Session;
  merchant: Merchant;
  payment: Payment;
  wallet: Wallet;
  caps: PaymentCapabilities;
}) {
  const client = useQueryClient();
  const [intent, setIntent] = useState<Recovery | null>(() =>
    readRecovery(session.userId, caps.environmentEpoch),
  );
  const [review, setReview] = useState<RefundInput | null>(null);
  const [notice, setNotice] = useState("");
  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<{ amount: string; note: string }>({
    defaultValues: { amount: "", note: "" },
  });
  const command = useQuery({
    queryKey: ["command", session.userId, intent?.operationType, intent?.key],
    queryFn: ({ signal }) =>
      fundingApi.lookup(intent!.key, signal, intent!.operationType),
    enabled: Boolean(intent),
  });
  const [posting, setPosting] = useState(false);
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
    if (!intent || posting || command.data) return;
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
  }, [intent, posting, command.data, refetch]);
  async function send(key: string, body: RefundInput) {
    setPosting(true);
    setNotice("");
    try {
      cacheTerminal(client, session.userId, await refundApi.send(key, body));
    } catch (e) {
      if (
        client.getQueryData<Session | null>(["session"])?.userId !==
        session.userId
      )
        return;
      if (e instanceof ApiError && e.status === 401)
        client.setQueryData(["session"], null);
      else
        setNotice(
          "Chưa xác định được kết quả hoàn tiền. Tra cứu mã đã lưu trước khi thử lại. " +
            errorMessage(e),
        );
    } finally {
      setPosting(false);
    }
  }
  const active = merchant.status === "ACTIVE" && wallet.status === "ACTIVE";
  function confirm() {
    if (!review) return;
    const key = crypto.randomUUID();
    const ref: Recovery = {
      actorId: session.userId,
      environmentEpoch: caps.environmentEpoch,
      operationType: "REFUND",
      merchantId: merchant.id,
      paymentId: payment.id,
      key,
    };
    try {
      saveRecovery(ref);
      rememberIntent({ ...ref, operationType: "REFUND", body: review });
    } catch {
      setNotice("Chưa thể lưu mã thao tác. Chưa gửi hoàn tiền.");
      return;
    }
    setIntent(ref);
    setReview(null);
    void send(key, review);
  }
  const submit = handleSubmit((values) => {
    let amount: string;
    try {
      amount = parseVndInput(values.amount, caps.minAmount, caps.maxAmount);
      if (BigInt(amount) > BigInt(payment.refundableAmount))
        throw new Error("Số tiền vượt phần còn được hoàn.");
    } catch (e) {
      setError("amount", {
        message: e instanceof Error ? e.message : "Số tiền không hợp lệ.",
      });
      return;
    }
    const note = values.note.trim().normalize("NFC");
    if (
      [...note].length > 140 ||
      [...values.note].some((c) => {
        const n = c.codePointAt(0)!;
        return n < 32 || (n >= 127 && n <= 159);
      })
    ) {
      setError("note", {
        message: "Lý do tối đa 140 ký tự, không chứa ký tự điều khiển.",
      });
      return;
    }
    setNotice("");
    setReview({
      merchantId: merchant.id,
      paymentId: payment.id,
      amount,
      currency: "VND",
      note,
    });
  });
  if (intent) {
    const memory = readMemoryIntent(intent);
    const draft = memory?.operationType === "REFUND" ? memory.body : null;
    const own =
      intent.operationType === "REFUND" &&
      intent.merchantId === merchant.id &&
      intent.paymentId === payment.id;
    return (
      <section className="card">
        <h2>Tra cứu thao tác đã lưu</h2>
        <p>
          Mã thao tác: <code>{intent.key}</code>
        </p>
        {posting ? (
          <Loading text="Đang xác nhận hoàn tiền…" />
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
                  Bắt đầu hoàn tiền mới
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
                  {own && draft && (
                    <Button
                      disabled={command.isFetching}
                      onClick={() => void send(intent.key, draft)}
                    >
                      Thử lại cùng mã
                    </Button>
                  )}
                  {!own && (
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
  }
  if (review)
    return (
      <RefundReview
        payment={payment}
        wallet={wallet}
        body={review}
        fee={caps.fee}
        blocked={
          !active || BigInt(review.amount) > BigInt(payment.refundableAmount)
        }
        confirm={confirm}
        back={() => setReview(null)}
      />
    );
  return (
    <section className="card">
      <h2>Thông tin hoàn tiền</h2>
      <p>
        {refundStatusLabel(payment.refundStatus)} · Đã hoàn{" "}
        {formatMoney(payment.refundedAmount)} · Còn được hoàn{" "}
        <strong>{formatMoney(payment.refundableAmount)}</strong>
      </p>
      <p>
        Người nhận gốc: {payment.payerName}. Phí: {formatMoney(caps.fee)}.
      </p>
      {(!active || payment.refundableAmount === "0") && (
        <Notice error>
          Doanh nghiệp/ví đang bị khóa hoặc thanh toán đã được hoàn toàn bộ. Bạn
          vẫn có thể tra cứu kết quả đã lưu.
        </Notice>
      )}
      <form className="account-form" noValidate onSubmit={submit}>
        <Field
          label="Số tiền hoàn (VND mô phỏng)"
          required
          validationMessage={errors.amount?.message}
          validationState={errors.amount ? "error" : undefined}
        >
          <Controller
            name="amount"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                inputMode="numeric"
                onChange={(_, d) => field.onChange(d.value)}
              />
            )}
          />
        </Field>
        <Button
          type="button"
          disabled={!active || payment.refundableAmount === "0"}
          onClick={() => setValue("amount", payment.refundableAmount)}
        >
          Hoàn toàn bộ phần còn lại
        </Button>
        <Field
          label="Lý do hoàn tiền (không bắt buộc)"
          validationMessage={errors.note?.message}
          validationState={errors.note ? "error" : undefined}
        >
          <Controller
            name="note"
            control={control}
            render={({ field }) => (
              <Textarea
                {...field}
                onChange={(_, d) => field.onChange(d.value)}
              />
            )}
          />
        </Field>
        {notice && <Notice error>{notice}</Notice>}
        <Button
          appearance="primary"
          type="submit"
          disabled={!active || payment.refundableAmount === "0"}
        >
          Xem lại hoàn tiền
        </Button>
      </form>
    </section>
  );
}
function RefundFormPage({
  session,
  merchant,
}: {
  session: Session;
  merchant: Merchant;
}) {
  const { id = "" } = useParams();
  const payment = useQuery({
    queryKey: [
      "merchant-payments",
      session.userId,
      "business",
      merchant.id,
      "detail",
      id,
    ],
    queryFn: ({ signal }) => refundApi.payment(merchant.id, id, signal),
    refetchInterval: 10000,
  });
  const caps = useQuery({
    queryKey: ["payment-capabilities", session.userId],
    queryFn: ({ signal }) => paymentApi.capabilities(signal),
  });
  const wallet = useQuery({
    queryKey: ["wallet", session.userId, "business", merchant.id],
    queryFn: ({ signal }) => merchantApi.wallet(merchant.id, signal),
  });
  if (payment.isPending || caps.isPending || wallet.isPending)
    return <Loading />;
  if (payment.isError)
    return (
      <FetchError error={payment.error} retry={() => void payment.refetch()} />
    );
  if (caps.isError)
    return <FetchError error={caps.error} retry={() => void caps.refetch()} />;
  if (wallet.isError)
    return (
      <FetchError error={wallet.error} retry={() => void wallet.refetch()} />
    );
  return (
    <>
      <section className="card">
        <h2>Thanh toán gốc</h2>
        <dl className="merchant-metadata">
          <dt>Mã thanh toán</dt>
          <dd>
            <code>{payment.data.id}</code>
          </dd>
          <dt>Số tiền gốc</dt>
          <dd>{formatMoney(payment.data.amount)}</dd>
          <dt>Trạng thái gốc</dt>
          <dd>
            Đã thanh toán · {refundStatusLabel(payment.data.refundStatus)}
          </dd>
        </dl>
        <Link to={`/business/payment-requests/${payment.data.requestId}`}>
          Về yêu cầu đã thanh toán
        </Link>
      </section>
      <RefundPanel
        key={`${session.userId}:${merchant.id}:${id}:${caps.data.environmentEpoch}`}
        session={session}
        merchant={merchant}
        payment={payment.data}
        caps={caps.data}
        wallet={wallet.data}
      />
    </>
  );
}
function RefundRow({ refund }: { refund: Refund }) {
  return (
    <article className="request-row">
      <div>
        <h2>
          {refund.status === "SUCCEEDED"
            ? "Đã hoàn tiền"
            : "Hoàn tiền bị từ chối"}
        </h2>
        <p>
          {refund.status === "SUCCEEDED" ? "−" : ""}
          {formatMoney(refund.amount)}
          {refund.status === "FAILED" ? " · Không trừ tiền" : ""} ·{" "}
          {refund.payerName} · {localTime(refund.createdAt)}
        </p>
        <code>{refund.id}</code>
      </div>
      <Link to={`/business/refunds/${refund.id}`}>Xem hoàn tiền</Link>
    </article>
  );
}
function RefundList({
  session,
  merchant,
}: {
  session: Session;
  merchant: Merchant;
}) {
  const [status, setStatus] = useState("");
  const list = useInfiniteQuery({
    queryKey: [
      "refunds",
      session.userId,
      "business",
      merchant.id,
      "list",
      status,
    ],
    queryFn: ({ pageParam, signal }) =>
      refundApi.list(merchant.id, status, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 15000,
  });
  return (
    <>
      <Field label="Trạng thái hoàn tiền">
        <Select value={status} onChange={(_, d) => setStatus(d.value)}>
          <option value="">Tất cả</option>
          <option value="SUCCEEDED">Thành công</option>
          <option value="FAILED">Bị từ chối</option>
        </Select>
      </Field>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <FetchError error={list.error} retry={() => void list.refetch()} />
      ) : (
        <section className="card">
          {list.data.pages.flatMap((p) => p.items).length ? (
            list.data.pages
              .flatMap((p) => p.items)
              .map((r) => <RefundRow key={r.id} refund={r} />)
          ) : (
            <p>Chưa có hoàn tiền phù hợp.</p>
          )}
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Xem thêm hoàn tiền
            </Button>
          )}
        </section>
      )}
    </>
  );
}
function RefundDetail({
  session,
  merchant,
}: {
  session: Session;
  merchant: Merchant;
}) {
  const { id = "" } = useParams();
  const detail = useQuery({
    queryKey: [
      "refunds",
      session.userId,
      "business",
      merchant.id,
      "detail",
      id,
    ],
    queryFn: ({ signal }) => refundApi.detail(merchant.id, id, signal),
  });
  if (detail.isPending) return <Loading />;
  if (detail.isError)
    return (
      <FetchError error={detail.error} retry={() => void detail.refetch()} />
    );
  const r = detail.data;
  return (
    <section className="card">
      <h2>
        {r.status === "SUCCEEDED" ? "Đã hoàn tiền" : "Hoàn tiền bị từ chối"}
      </h2>
      <dl className="merchant-metadata">
        <dt>Mã hoàn tiền</dt>
        <dd>
          <code>{r.id}</code>
        </dd>
        <dt>Thanh toán gốc</dt>
        <dd>
          <code>{r.paymentId}</code>
        </dd>
        <dt>Số tiền</dt>
        <dd>{formatMoney(r.amount)}</dd>
        <dt>Người nhận gốc</dt>
        <dd>{r.payerName}</dd>
        <dt>Lý do</dt>
        <dd>{r.note || "—"}</dd>
        <dt>Thời gian</dt>
        <dd>{localTime(r.createdAt)}</dd>
        {r.errorCode && (
          <>
            <dt>Mã từ chối</dt>
            <dd>{r.errorCode} · Không trừ tiền</dd>
          </>
        )}
        {r.ledgerTransactionId && (
          <>
            <dt>Mã ledger</dt>
            <dd>
              <code>{r.ledgerTransactionId}</code>
            </dd>
          </>
        )}
      </dl>
      <div className="funding-actions">
        <Link to={`/business/payments/${r.paymentId}/refund`}>
          Xem thanh toán và phần còn được hoàn
        </Link>
        <Link to="/business/refunds">Về lịch sử hoàn tiền</Link>
      </div>
    </section>
  );
}
export function RefundPage({ mode }: { mode: "form" | "list" | "detail" }) {
  const session = useOutletContext<Session>();
  const merchant = useQuery({
    queryKey: merchantKey(session.userId),
    queryFn: ({ signal }) => merchantApi.own(signal),
  });
  return (
    <div className="business-page">
      <div className="page-heading">
        <h1>
          {mode === "form"
            ? "Hoàn tiền thanh toán"
            : mode === "list"
              ? "Lịch sử hoàn tiền"
              : "Chi tiết hoàn tiền"}
        </h1>
      </div>
      <nav className="funding-actions" aria-label="Điều hướng hoàn tiền">
        <Link to="/business/transactions">Thanh toán đã nhận</Link>
        <Link to="/app/commands">Thao tác đã lưu</Link>
      </nav>
      {merchant.isPending ? (
        <Loading />
      ) : merchant.isError ? (
        <FetchError
          error={merchant.error}
          retry={() => void merchant.refetch()}
        />
      ) : !merchant.data ? (
        <Link to="/business/onboarding">Mở doanh nghiệp demo</Link>
      ) : mode === "form" ? (
        <RefundFormPage session={session} merchant={merchant.data} />
      ) : mode === "list" ? (
        <RefundList session={session} merchant={merchant.data} />
      ) : (
        <RefundDetail session={session} merchant={merchant.data} />
      )}
    </div>
  );
}
