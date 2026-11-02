import { useEffect, useState } from "react";
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from "@fluentui/react-components";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { ApiError, errorMessage, type Session } from "./api";
import { FetchError, Loading, Notice } from "./components";
import { merchantApi, merchantKey } from "./merchant";
import {
  paymentApi,
  paymentKey,
  statusLabel,
  checkoutUrl,
  readCreate,
  readCreateDraft,
  saveCreate,
  clearCreate,
  type CreateRequest,
  type PaymentRequest,
  type PaymentCapabilities,
  type Payment,
} from "./payment";
import { parseVndInput, localTime } from "./transfer";
import { refundStatusLabel } from "./refund";
import { formatMoney } from "./validation";

function Heading({ title }: { title: string }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">DOANH NGHIỆP · MÔ PHỎNG</span>
        <h1>{title}</h1>
      </div>
    </div>
  );
}
export function RequestShare({ reference }: { reference: string }) {
  const url = checkoutUrl(reference);
  const [notice, setNotice] = useState("");
  const qr = useQuery({
    queryKey: ["qr", url],
    queryFn: async () => {
      const module = await import("qrcode");
      return module.toDataURL(url, {
        width: 240,
        margin: 4,
        errorCorrectionLevel: "M",
      });
    },
    staleTime: Infinity,
  });
  return (
    <section className="card request-share">
      <h2>Chia sẻ yêu cầu</h2>
      <div className="share-grid">
        {qr.isPending ? (
          <Loading text="Đang tạo QR…" />
        ) : qr.isError ? (
          <FetchError error={qr.error} retry={() => void qr.refetch()} />
        ) : (
          <img
            src={qr.data}
            alt="Mã QR mở trang thanh toán"
            width={240}
            height={240}
          />
        )}
        <div>
          <Field label="Liên kết thanh toán">
            <Input readOnly value={url} />
          </Field>
          <div className="funding-actions">
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(url).then(
                  () => setNotice("Đã sao chép liên kết."),
                  () =>
                    setNotice(
                      "Chưa thể sao chép. Bạn có thể chọn liên kết ở trên.",
                    ),
                );
              }}
            >
              Sao chép liên kết
            </Button>
            <Link to={`/pay/${reference}`}>Mở trang thanh toán</Link>
          </div>
          <p>
            QR chỉ chứa liên kết NexaPay này. Không có thông tin ngân hàng, thẻ
            hoặc mã đăng nhập.
          </p>
          {notice && <Notice>{notice}</Notice>}
        </div>
      </div>
    </section>
  );
}
function CreateForm({
  session,
  merchant,
  caps,
}: {
  session: Session;
  merchant: string;
  caps: PaymentCapabilities;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [initial] = useState(() =>
    readCreate(session.userId, merchant, caps.environmentEpoch),
  );
  const [intent, setIntent] = useState(initial);
  const [posting, setPosting] = useState(false);
  const [notice, setNotice] = useState("");
  const current = () =>
    client.getQueryData<Session | null>(["session"])?.userId === session.userId;
  const lookup = useQuery({
    queryKey: [...paymentKey(session.userId, merchant), "create", intent?.key],
    queryFn: ({ signal }) =>
      paymentApi.lookupCreate(merchant, intent!.key, signal),
    enabled: Boolean(intent && initial?.key === intent.key),
  });
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<{ amount: string; description: string; expiry: string }>({
    defaultValues: {
      amount: "",
      description: "",
      expiry: String(caps.defaultExpiryMinutes),
    },
  });
  function accept(result: PaymentRequest) {
    if (!current()) return;
    clearCreate();
    void client.invalidateQueries({
      queryKey: paymentKey(session.userId, merchant),
    });
    void client.invalidateQueries({
      queryKey: ["merchant-payments", session.userId, "business", merchant],
    });
    navigate(`/business/payment-requests/${result.id}`);
  }
  useEffect(() => {
    if (
      lookup.data &&
      client.getQueryData<Session | null>(["session"])?.userId ===
        session.userId
    ) {
      clearCreate();
      navigate(`/business/payment-requests/${lookup.data.id}`, {
        replace: true,
      });
    }
  }, [lookup.data, client, session.userId, navigate]);
  async function create(key: string, body: CreateRequest) {
    setPosting(true);
    setNotice("");
    try {
      accept(await paymentApi.create(merchant, key, body));
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status === 401) {
        client.setQueryData(["session"], null);
        return;
      }
      if (e instanceof ApiError && e.status === 400) {
        clearCreate();
        setIntent(null);
        setNotice(errorMessage(e));
      } else
        setNotice(
          "Chưa xác định được kết quả tạo yêu cầu. Tra cứu hoặc thử lại đúng mã đã lưu. " +
            errorMessage(e),
        );
    } finally {
      setPosting(false);
    }
  }
  const submit = handleSubmit((values) => {
    let amount: string;
    try {
      amount = parseVndInput(values.amount, caps.minAmount, caps.maxAmount);
    } catch (e) {
      setError("amount", {
        message: e instanceof Error ? e.message : "Số tiền không hợp lệ.",
      });
      return;
    }
    const description = values.description.trim().normalize("NFC");
    if (
      !description ||
      [...description].length > caps.descriptionMaxLength ||
      [...values.description].some((c) => {
        const n = c.codePointAt(0)!;
        return n < 32 || (n >= 127 && n <= 159);
      })
    ) {
      setError("description", {
        message: `Mô tả cần 1–${caps.descriptionMaxLength} ký tự, không chứa ký tự điều khiển.`,
      });
      return;
    }
    const key = crypto.randomUUID();
    const ref = {
      actor: session.userId,
      merchant,
      epoch: caps.environmentEpoch,
      key,
    };
    const body: CreateRequest = {
      amount,
      currency: "VND",
      description,
      expiryMinutes: Number(values.expiry),
    };
    try {
      saveCreate(ref, body);
    } catch {
      setNotice("Chưa thể lưu mã yêu cầu. Chưa gửi dữ liệu.");
      return;
    }
    setIntent(ref);
    void create(key, body);
  });
  if (intent) {
    const draft = readCreateDraft(intent);
    return (
      <section className="card">
        <h2>Tra cứu yêu cầu đã gửi</h2>
        <p>
          Mã tạo: <code>{intent.key}</code>
        </p>
        {posting ? (
          <Loading text="Đang tạo yêu cầu…" />
        ) : (
          <>
            {notice && <Notice>{notice}</Notice>}
            {lookup.isError && <Notice>{errorMessage(lookup.error)}</Notice>}
            <div className="funding-actions">
              <Button
                disabled={lookup.isFetching}
                onClick={() => void lookup.refetch()}
              >
                Kiểm tra yêu cầu đã tạo
              </Button>
              {draft && (
                <Button
                  disabled={lookup.isFetching}
                  onClick={() => void create(intent.key, draft)}
                >
                  Thử lại cùng mã tạo
                </Button>
              )}
              <Link to="/business/payment-requests">Xem danh sách yêu cầu</Link>
            </div>
            <p>
              Chưa quan sát được kết quả không đồng nghĩa yêu cầu chưa được tạo.
              Reload chỉ tra cứu, không tự gửi lại.
            </p>
          </>
        )}
      </section>
    );
  }
  return (
    <section className="card payment-create">
      <h2>Thông tin yêu cầu</h2>
      <form className="account-form" noValidate onSubmit={submit}>
        <Field
          label="Số tiền (VND mô phỏng)"
          required
          validationMessage={errors.amount?.message}
          validationState={errors.amount ? "error" : undefined}
        >
          <Controller
            name="amount"
            control={control}
            rules={{ required: "Nhập số tiền." }}
            render={({ field }) => (
              <Input
                {...field}
                inputMode="numeric"
                onChange={(_, d) => field.onChange(d.value)}
              />
            )}
          />
        </Field>
        <Field
          label="Mô tả thanh toán"
          required
          validationMessage={errors.description?.message}
          validationState={errors.description ? "error" : undefined}
        >
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <Textarea
                {...field}
                onChange={(_, d) => field.onChange(d.value)}
              />
            )}
          />
        </Field>
        <Field label="Thời hạn hiệu lực">
          <Controller
            name="expiry"
            control={control}
            render={({ field }) => (
              <Select {...field} onChange={(_, d) => field.onChange(d.value)}>
                {[5, 15, 30, 60, 1440]
                  .filter(
                    (n) =>
                      n >= caps.minExpiryMinutes && n <= caps.maxExpiryMinutes,
                  )
                  .map((n) => (
                    <option key={n} value={n}>
                      {n === 1440 ? "24 giờ" : `${n} phút`}
                    </option>
                  ))}
              </Select>
            )}
          />
        </Field>
        <p>
          Số tiền, mô tả và thời hạn được giữ nguyên sau khi tạo. Hãy kiểm tra
          trước khi chia sẻ.
        </p>
        {notice && <Notice error>{notice}</Notice>}
        <Button appearance="primary" type="submit">
          Tạo yêu cầu thanh toán
        </Button>
      </form>
    </section>
  );
}
function CreateRequestPage({
  session,
  merchant,
}: {
  session: Session;
  merchant: string;
}) {
  const caps = useQuery({
    queryKey: ["payment-capabilities", session.userId],
    queryFn: ({ signal }) => paymentApi.capabilities(signal),
  });
  return (
    <>
      <Heading title="Tạo yêu cầu thanh toán" />
      {caps.isPending ? (
        <Loading />
      ) : caps.isError ? (
        <FetchError error={caps.error} retry={() => void caps.refetch()} />
      ) : (
        <CreateForm
          key={`${session.userId}:${merchant}:${caps.data.environmentEpoch}`}
          session={session}
          merchant={merchant}
          caps={caps.data}
        />
      )}
    </>
  );
}
function RequestList({
  session,
  merchant,
}: {
  session: Session;
  merchant: string;
}) {
  const [status, setStatus] = useState("");
  const list = useInfiniteQuery({
    queryKey: [...paymentKey(session.userId, merchant), "list", status],
    queryFn: ({ pageParam, signal }) =>
      paymentApi.list(merchant, status, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 15000,
  });
  return (
    <>
      <Heading title="Yêu cầu thanh toán" />
      <div className="funding-actions">
        <Link className="button-link" to="/business/payment-requests/new">
          Tạo yêu cầu thanh toán
        </Link>
        <Button disabled={list.isFetching} onClick={() => void list.refetch()}>
          Tải lại yêu cầu
        </Button>
      </div>
      <Field label="Trạng thái yêu cầu">
        <Select value={status} onChange={(_, d) => setStatus(d.value)}>
          <option value="">Tất cả</option>
          {(["PENDING", "PAID", "EXPIRED", "CANCELLED"] as const).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </Field>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <FetchError error={list.error} retry={() => void list.refetch()} />
      ) : (
        <section className="card">
          {list.data.pages.flatMap((p) => p.items).length === 0 ? (
            <p>Chưa có yêu cầu phù hợp.</p>
          ) : (
            list.data.pages
              .flatMap((p) => p.items)
              .map((r) => (
                <article className="request-row" key={r.id}>
                  <div>
                    <h2>{r.description}</h2>
                    <p>
                      {statusLabel(r.status)} · {formatMoney(r.amount)}
                    </p>
                    <p>
                      Tạo lúc {localTime(r.createdAt)} · Hết hạn{" "}
                      {localTime(r.expiresAt)}
                    </p>
                    <code>{r.id}</code>
                  </div>
                  <Link
                    className="request-detail-link"
                    to={`/business/payment-requests/${r.id}`}
                  >
                    Xem yêu cầu
                  </Link>
                </article>
              ))
          )}
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Xem thêm yêu cầu
            </Button>
          )}
        </section>
      )}
    </>
  );
}
function RequestDetail({
  session,
  merchant,
}: {
  session: Session;
  merchant: string;
}) {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const detail = useQuery({
    queryKey: [...paymentKey(session.userId, merchant), "detail", id],
    queryFn: ({ signal }) => paymentApi.detail(merchant, id, signal),
    refetchInterval: 15000,
  });
  async function cancel() {
    setPending(true);
    setNotice("");
    try {
      await paymentApi.cancel(merchant, id);
      if (
        client.getQueryData<Session | null>(["session"])?.userId !==
        session.userId
      )
        return;
      void client.invalidateQueries({
        queryKey: paymentKey(session.userId, merchant),
      });
      void client.invalidateQueries({
        queryKey: ["merchant-payments", session.userId, "business", merchant],
      });
      setConfirm(false);
      setNotice(
        "Đã kiểm tra trạng thái yêu cầu. Chỉ yêu cầu còn hiệu lực mới được hủy.",
      );
    } catch (e) {
      if (
        client.getQueryData<Session | null>(["session"])?.userId !==
        session.userId
      )
        return;
      if (e instanceof ApiError && e.status === 401)
        client.setQueryData(["session"], null);
      else setNotice(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Heading title="Chi tiết yêu cầu thanh toán" />
      <Link to="/business/payment-requests">Về danh sách yêu cầu</Link>
      {detail.isPending ? (
        <Loading />
      ) : detail.isError ? (
        <FetchError error={detail.error} retry={() => void detail.refetch()} />
      ) : (
        <>
          <section className="card">
            <h2>{statusLabel(detail.data.status)}</h2>
            <dl className="merchant-metadata">
              <dt>Mã yêu cầu</dt>
              <dd>
                <code>{detail.data.id}</code>
              </dd>
              <dt>Số tiền</dt>
              <dd>{formatMoney(detail.data.amount)}</dd>
              <dt>Mô tả</dt>
              <dd>{detail.data.description}</dd>
              <dt>Doanh nghiệp</dt>
              <dd>{detail.data.merchantName}</dd>
              <dt>Hết hạn</dt>
              <dd>{localTime(detail.data.expiresAt)}</dd>
            </dl>
            {detail.data.payment && (
              <>
                <h3>Thanh toán đã nhận</h3>
                <PaymentRow payment={detail.data.payment} />
              </>
            )}
            {notice && <Notice>{notice}</Notice>}
            {detail.data.status === "PENDING" &&
              (confirm ? (
                <section aria-label="Xác nhận hủy yêu cầu">
                  <h3>Hủy yêu cầu này?</h3>
                  <p>Người trả sẽ không thể thực hiện thanh toán mới.</p>
                  <div className="funding-actions">
                    <Button
                      disabled={pending}
                      onClick={() => setConfirm(false)}
                    >
                      Giữ yêu cầu
                    </Button>
                    <Button disabled={pending} onClick={() => void cancel()}>
                      {pending ? "Đang hủy…" : "Xác nhận hủy yêu cầu"}
                    </Button>
                  </div>
                </section>
              ) : (
                <Button onClick={() => setConfirm(true)}>Hủy yêu cầu</Button>
              ))}
          </section>
          <RequestShare reference={detail.data.publicRef} />
        </>
      )}
    </>
  );
}
function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <article className="request-row">
      <div>
        <h3>+{formatMoney(payment.amount)}</h3>
        <p>
          {payment.payerName} · {localTime(payment.paidAt)}
        </p>
        <code>{payment.id}</code>
        <p>
          {refundStatusLabel(payment.refundStatus)} · Đã hoàn{" "}
          {formatMoney(payment.refundedAmount)} · Còn được hoàn{" "}
          {formatMoney(payment.refundableAmount)}
        </p>
        <Link to={`/business/payments/${payment.id}/refund`}>
          {payment.refundableAmount === "0" ? "Xem hoàn tiền" : "Hoàn tiền"}
        </Link>
      </div>
      <Link
        className="request-detail-link"
        to={`/business/payment-requests/${payment.requestId}`}
      >
        Xem yêu cầu đã thanh toán
      </Link>
    </article>
  );
}
export function BusinessPaymentSummary({
  actor,
  merchant,
}: {
  actor: string;
  merchant: string;
}) {
  const summary = useQuery({
    queryKey: ["merchant-payments", actor, "business", merchant, "summary"],
    queryFn: ({ signal }) => paymentApi.summary(merchant, signal),
    refetchInterval: 10000,
  });
  if (summary.isPending)
    return <Loading text="Đang tải hoạt động thanh toán…" />;
  if (summary.isError)
    return (
      <FetchError error={summary.error} retry={() => void summary.refetch()} />
    );
  return (
    <section className="card">
      <h2>Thanh toán doanh nghiệp</h2>
      <dl className="merchant-metadata">
        <dt>Thanh toán thành công hôm nay (UTC)</dt>
        <dd>{summary.data.paidToday}</dd>
        <dt>Tiền đã nhận hôm nay (UTC)</dt>
        <dd>{formatMoney(summary.data.receivedToday)}</dd>
        <dt>Hoàn tiền thành công hôm nay (UTC)</dt>
        <dd>{summary.data.refundsToday}</dd>
        <dt>Tiền đã hoàn hôm nay (UTC)</dt>
        <dd>{formatMoney(summary.data.refundedToday)}</dd>
        <dt>Yêu cầu còn chờ và chưa hết hạn</dt>
        <dd>{summary.data.pendingRequests}</dd>
      </dl>
      <div className="funding-actions">
        <Link className="button-link" to="/business/payment-requests/new">
          Tạo yêu cầu thanh toán
        </Link>
        <Link to="/business/payment-requests">Xem các yêu cầu</Link>
      </div>
      <h3>Thanh toán mới nhất</h3>
      {summary.data.recentPayments.length ? (
        summary.data.recentPayments.map((p) => (
          <PaymentRow key={p.id} payment={p} />
        ))
      ) : (
        <p>Chưa có thanh toán thành công.</p>
      )}
    </section>
  );
}
function PaymentList({
  session,
  merchant,
}: {
  session: Session;
  merchant: string;
}) {
  const list = useInfiniteQuery({
    queryKey: [
      "merchant-payments",
      session.userId,
      "business",
      merchant,
      "list",
    ],
    queryFn: ({ pageParam, signal }) =>
      paymentApi.payments(merchant, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 10000,
  });
  return (
    <>
      <Heading title="Thanh toán đã nhận" />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <FetchError error={list.error} retry={() => void list.refetch()} />
      ) : (
        <section className="card">
          {list.data.pages.flatMap((p) => p.items).length ? (
            list.data.pages
              .flatMap((p) => p.items)
              .map((p) => <PaymentRow key={p.id} payment={p} />)
          ) : (
            <p>Chưa có thanh toán thành công.</p>
          )}
          {list.hasNextPage && (
            <Button
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Xem thêm thanh toán
            </Button>
          )}
        </section>
      )}
    </>
  );
}
export function PaymentBusinessPage({
  mode,
}: {
  mode: "list" | "new" | "detail" | "payments";
}) {
  const session = useOutletContext<Session>();
  const merchant = useQuery({
    queryKey: merchantKey(session.userId),
    queryFn: ({ signal }) => merchantApi.own(signal),
  });
  if (merchant.isPending) return <Loading />;
  if (merchant.isError)
    return (
      <FetchError
        error={merchant.error}
        retry={() => void merchant.refetch()}
      />
    );
  if (!merchant.data)
    return (
      <section className="card">
        <h1>Bạn chưa có doanh nghiệp</h1>
        <Link to="/business/onboarding">Mở doanh nghiệp demo</Link>
      </section>
    );
  const props = { session, merchant: merchant.data.id };
  return (
    <div className="business-page">
      {mode === "new" ? (
        <CreateRequestPage {...props} />
      ) : mode === "detail" ? (
        <RequestDetail key={session.userId + merchant.data.id} {...props} />
      ) : mode === "payments" ? (
        <PaymentList {...props} />
      ) : (
        <RequestList {...props} />
      )}
    </div>
  );
}
