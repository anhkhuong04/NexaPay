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
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError, errorMessage, type Session, type Wallet } from "./api";
import { FetchError, Loading, Notice } from "./components";
import { Receipt } from "./FundingPages";
import {
  cacheTerminal,
  refreshMoneyViews,
  fundingApi,
  readRecovery,
  saveRecovery,
  RECOVERY_KEY,
  type CommandResult,
} from "./funding";
import {
  transactionLabel,
  localTime,
  parseVndInput,
  transferApi,
  type HistoryFilter,
  type Recipient,
  type TransferCapabilities,
  type TransferInput,
} from "./transfer";
import {
  rememberIntent,
  readMemoryIntent,
  clearMemoryIntent,
} from "./moneyDrafts";
import { formatMoney } from "./validation";
const formSchema = z.object({
  recipientId: z
    .string()
    .trim()
    .toLowerCase()
    .uuid("Nhập đầy đủ mã ví UUID người nhận."),
  amount: z.string().min(1, "Vui lòng nhập số tiền."),
  note: z.string().refine(
    (v) =>
      [...v.normalize("NFC").trim()].length <= 140 &&
      [...v].every((c) => {
        const n = c.codePointAt(0)!;
        return n >= 32 && (n < 127 || n > 159);
      }),
    "Lời nhắn tối đa 140 ký tự, không chứa ký tự điều khiển.",
  ),
});
type Form = z.infer<typeof formSchema>;
function SendPanel({
  session,
  caps,
  wallet,
}: {
  session: Session;
  caps: TransferCapabilities;
  wallet: Wallet;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [intent, setIntent] = useState<{
    key: string;
    operationType: CommandResult["operationType"];
    checkoutRef?: string;
    draft?: TransferInput;
  } | null>(() => {
    const ref = readRecovery(session.userId, caps.environmentEpoch);
    if (!ref) return null;
    const memory = readMemoryIntent(ref);
    return {
      key: ref.key,
      checkoutRef: ref.checkoutRef,
      operationType: ref.operationType,
      draft: memory?.operationType === "TRANSFER" ? memory.body : undefined,
    };
  });
  const [review, setReview] = useState<{
    body: TransferInput;
    recipient: Recipient;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Form>({
    resolver: zodResolver(formSchema),
    defaultValues: { recipientId: "", amount: "", note: "" },
  });
  const enteredId = useWatch({ control, name: "recipientId" })
    .trim()
    .toLowerCase();
  const recipient = useQuery({
    queryKey: ["recipient", session.userId, enteredId],
    queryFn: ({ signal }) => transferApi.recipient(enteredId, signal),
    enabled: false,
  });
  const selected =
    recipient.data?.walletId === enteredId ? recipient.data : undefined;
  const command = useQuery({
    queryKey: ["command", session.userId, intent?.operationType, intent?.key],
    queryFn: ({ signal }) =>
      fundingApi.lookup(intent!.key, signal, intent!.operationType),
    enabled: Boolean(intent),
  });
  const mutation = useMutation({
    mutationFn: ({ key, body }: { key: string; body: TransferInput }) =>
      transferApi.send(key, body),
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
  const refetchCommand = command.refetch;
  // Bounded observation only: never POST from an effect or translate 404 to FAILED.
  useEffect(() => {
    if (!intent || mutation.isPending || command.data) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const delays = [2000, 3000, 5000, 8000, 13000, 20000];
    function schedule(index: number) {
      if (index >= delays.length || stopped) return;
      timer = setTimeout(() => {
        void refetchCommand().then((r) => {
          if (
            !stopped &&
            !r.data &&
            !(r.error instanceof ApiError && r.error.status === 401)
          )
            schedule(index + 1);
        });
      }, delays[index]);
    }
    schedule(0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intent, mutation.isPending, command.data, refetchCommand]);
  async function send(key: string, body: TransferInput) {
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
        "Chưa xác định được kết quả. Giữ nguyên mã thao tác và kiểm tra trạng thái trước khi thử lại.",
      );
      if (error instanceof ApiError && error.status === 401) {
        await client.cancelQueries();
        client.setQueryData(["session"], null);
        navigate("/auth/sign-in", {
          replace: true,
          state: { from: "/app/send" },
        });
      }
    }
  }
  const continueToReview = handleSubmit((values) => {
    if (!selected) {
      setError("recipientId", {
        message: "Hãy tra cứu và xác nhận đúng ví người nhận.",
      });
      return;
    }
    if (selected.walletId === wallet.id) {
      setError("recipientId", {
        message: "Không thể chuyển cho chính ví của bạn.",
      });
      return;
    }
    let amount: string;
    try {
      amount = parseVndInput(values.amount, caps.minAmount, caps.maxAmount);
    } catch (error) {
      setError("amount", {
        message:
          error instanceof Error ? error.message : "Số tiền không hợp lệ.",
      });
      return;
    }
    if (BigInt(amount) > BigInt(wallet.availableBalance)) {
      setError("amount", { message: "Số dư hiện tại không đủ." });
      return;
    }
    setNotice("");
    setReview({
      recipient: selected,
      body: {
        destinationWalletId: selected.walletId,
        amount,
        currency: "VND",
        note: values.note.normalize("NFC").trim(),
      },
    });
  });
  function confirm() {
    if (!review || intent) return;
    const key = crypto.randomUUID();
    try {
      saveRecovery({
        actorId: session.userId,
        environmentEpoch: caps.environmentEpoch,
        operationType: "TRANSFER",
        key,
      });
    } catch {
      setNotice(
        "Không thể lưu mã khôi phục. Hãy cho phép sessionStorage rồi thử lại.",
      );
      return;
    }
    const body = review.body;
    rememberIntent({
      actorId: session.userId,
      environmentEpoch: caps.environmentEpoch,
      operationType: "TRANSFER",
      key,
      body,
    });
    setIntent({ key, operationType: "TRANSFER", draft: body });
    setReview(null);
    void send(key, body);
  }
  return (
    <>
      <div className="send-layout">
        <section className="card send-form">
          {wallet.status === "LOCKED" && (
            <Notice error>
              Ví đang bị khóa. Bạn vẫn có thể tra cứu kết quả cũ.
            </Notice>
          )}
          {!intent && !review && (
            <form
              onSubmit={(e) => void continueToReview(e)}
              noValidate
              className="account-form"
            >
              <h2>Người nhận và số tiền</h2>
              <Controller
                name="recipientId"
                control={control}
                render={({ field }) => (
                  <Field
                    label="Mã ví người nhận"
                    required
                    validationState={errors.recipientId ? "error" : "none"}
                    validationMessage={errors.recipientId?.message}
                    hint="Dùng mã ví UUID do người nhận chia sẻ."
                  >
                    <Input {...field} autoComplete="off" />
                  </Field>
                )}
              />
              <Button
                type="button"
                disabled={
                  !z.uuid().safeParse(enteredId).success || recipient.isFetching
                }
                onClick={() => void recipient.refetch()}
              >
                Tra cứu người nhận
              </Button>
              {recipient.isFetching && (
                <Loading text="Đang tra cứu người nhận…" />
              )}
              {recipient.isError && (
                <Notice error>{errorMessage(recipient.error)}</Notice>
              )}
              {selected && (
                <Notice>
                  <strong>{selected.displayName}</strong>
                  <br />
                  <code>{selected.walletId}</code>
                </Notice>
              )}
              <Controller
                name="amount"
                control={control}
                render={({ field }) => (
                  <Field
                    label="Số tiền (VND)"
                    required
                    validationState={errors.amount ? "error" : "none"}
                    validationMessage={errors.amount?.message}
                    hint={`Từ ${formatMoney(caps.minAmount)} đến ${formatMoney(caps.maxAmount)}; phí ${formatMoney(caps.fee)}.`}
                  >
                    <Input
                      {...field}
                      inputMode="numeric"
                      autoComplete="off"
                      className="money-input"
                    />
                  </Field>
                )}
              />
              <Controller
                name="note"
                control={control}
                render={({ field }) => (
                  <Field
                    label="Lời nhắn (không bắt buộc)"
                    validationState={errors.note ? "error" : "none"}
                    validationMessage={errors.note?.message}
                    hint={`Tối đa ${caps.noteMaxLength} ký tự.`}
                  >
                    <Textarea {...field} resize="vertical" />
                  </Field>
                )}
              />
              <Button
                type="submit"
                appearance="primary"
                disabled={wallet.status !== "ACTIVE"}
              >
                Tiếp tục
              </Button>
            </form>
          )}
          {review && (
            <section
              aria-label="Xác nhận chuyển tiền"
              className="transfer-review"
            >
              <h2>Xác nhận chuyển tiền</h2>
              <dl>
                <dt>Người nhận</dt>
                <dd>
                  {review.recipient.displayName}
                  <br />
                  {review.recipient.walletId}
                </dd>
                <dt>Ví gửi cá nhân</dt>
                <dd>{wallet.id}</dd>
                <dt>Số tiền</dt>
                <dd>{formatMoney(review.body.amount)}</dd>
                <dt>Phí</dt>
                <dd>{formatMoney(caps.fee)}</dd>
                <dt>Tổng trừ</dt>
                <dd>
                  <strong>{formatMoney(review.body.amount)}</strong>
                </dd>
                <dt>Lời nhắn</dt>
                <dd>{review.body.note || "—"}</dd>
              </dl>
              <div className="funding-actions">
                <Button autoFocus onClick={() => setReview(null)}>
                  Quay lại
                </Button>
                <Button appearance="primary" onClick={confirm}>
                  Xác nhận chuyển
                </Button>
              </div>
            </section>
          )}
          {intent && (
            <div className="funding-recovery">
              <h2>
                {intent.operationType === "TRANSFER"
                  ? "Kết quả chuyển tiền"
                  : intent.operationType === "PAYMENT"
                    ? "Khôi phục thanh toán"
                    : "Khôi phục thao tác cấp tiền"}
              </h2>
              <p>
                Mã thao tác: <code>{intent.key}</code>
              </p>
              {mutation.isPending ? (
                <Loading text="Đang xác nhận giao dịch…" />
              ) : (
                <>
                  {command.isFetching && (
                    <Loading text="Đang kiểm tra kết quả…" />
                  )}
                  {command.isError && (
                    <Notice>
                      {command.error instanceof ApiError &&
                      command.error.status === 404
                        ? "Chưa quan sát được kết quả đã lưu; đây chưa phải kết luận thất bại."
                        : errorMessage(command.error)}
                    </Notice>
                  )}
                  {!command.data && (
                    <div className="funding-actions">
                      <Button
                        disabled={command.isFetching}
                        onClick={() => void command.refetch()}
                      >
                        Kiểm tra trạng thái
                      </Button>
                      {intent.operationType === "PAYMENT" &&
                        intent.checkoutRef && (
                          <Link to={`/pay/${intent.checkoutRef}`}>
                            Tiếp tục thanh toán
                          </Link>
                        )}
                      {intent.operationType === "DEMO_FUNDING" && (
                        <Link to="/app/add-demo-funds">
                          Tiếp tục thao tác cấp tiền
                        </Link>
                      )}
                      {intent.draft && (
                        <Button
                          disabled={command.isFetching}
                          onClick={() => void send(intent.key, intent.draft!)}
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
                      Bắt đầu chuyển mới
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
          {notice && !command.data && <Notice>{notice}</Notice>}
        </section>
        <aside className="card send-summary" aria-label="Ví gửi">
          <h2>Ví cá nhân</h2>
          <p>Số dư hiện tại</p>
          <strong className="summary-amount">
            {formatMoney(wallet.availableBalance)}
          </strong>
          <code>{wallet.id}</code>
          <p>
            Chuyển VND mô phỏng. Phí {formatMoney(caps.fee)}. Số dư và trạng
            thái được kiểm tra lại khi xác nhận.
          </p>
        </aside>
      </div>
      {command.data && <Receipt result={command.data} />}
      <p>
        <Link to="/app/commands">Thao tác đã lưu</Link> ·{" "}
        <Link to="/app/transactions">Lịch sử giao dịch</Link>
      </p>
    </>
  );
}
export function SendPage() {
  const session = useOutletContext<Session>();
  const caps = useQuery({
    queryKey: ["transfer-capabilities", session.userId],
    queryFn: ({ signal }) => transferApi.capabilities(signal),
  });
  const wallet = useQuery({
    queryKey: ["wallet", session.userId, "personal"],
    queryFn: ({ signal }) => api.wallet(signal),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Chuyển tiền</h1>
          <p>Xác nhận đúng người nhận trước khi chuyển VND mô phỏng.</p>
        </div>
      </div>
      {caps.isPending || wallet.isPending ? (
        <Loading />
      ) : caps.isError || wallet.isError ? (
        <FetchError
          error={caps.error ?? wallet.error}
          retry={() => {
            void caps.refetch();
            void wallet.refetch();
          }}
        />
      ) : (
        <SendPanel
          key={`${session.userId}:${caps.data.environmentEpoch}`}
          session={session}
          caps={caps.data}
          wallet={wallet.data}
        />
      )}
    </>
  );
}
const emptyFilter: HistoryFilter = { type: "", status: "", from: "", to: "" };
export function HistoryPage() {
  const session = useOutletContext<Session>();
  const [draft, setDraft] = useState({
    type: "",
    status: "",
    from: "",
    to: "",
  });
  const [filter, setFilter] = useState(emptyFilter);
  const [error, setError] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["history", session.userId, filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      transferApi.history(filter, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setError("Ngày kết thúc cần từ ngày bắt đầu trở đi.");
      return;
    }
    setError("");
    setFilter({
      ...draft,
      from: draft.from ? new Date(`${draft.from}T00:00:00Z`).toISOString() : "",
      to: draft.to
        ? new Date(
            new Date(`${draft.to}T00:00:00Z`).getTime() + 86400000,
          ).toISOString()
        : "",
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Lịch sử giao dịch</h1>
          <p>
            Bộ lọc ngày theo UTC; thời gian giao dịch hiển thị kèm múi giờ địa
            phương.
          </p>
        </div>
        <Button onClick={() => void list.refetch()}>Tải lại</Button>
      </div>
      <form className="card history-filters" onSubmit={apply}>
        <Field label="Từ ngày (UTC)">
          <Input
            type="date"
            value={draft.from}
            onChange={(_, d) => setDraft({ ...draft, from: d.value })}
          />
        </Field>
        <Field label="Đến ngày (UTC)">
          <Input
            type="date"
            value={draft.to}
            onChange={(_, d) => setDraft({ ...draft, to: d.value })}
          />
        </Field>
        <Field label="Loại giao dịch">
          <Select
            value={draft.type}
            onChange={(_, d) => setDraft({ ...draft, type: d.value })}
          >
            <option value="">Tất cả</option>
            <option value="INCOMING">Nhận tiền</option>
            <option value="OUTGOING">Chuyển tiền</option>
            <option value="FUNDING">Nhận tiền demo</option>
          </Select>
        </Field>
        <Field label="Trạng thái">
          <Select
            value={draft.status}
            onChange={(_, d) => setDraft({ ...draft, status: d.value })}
          >
            <option value="">Tất cả</option>
            <option value="SUCCEEDED">Thành công</option>
            <option value="FAILED">Bị từ chối</option>
          </Select>
        </Field>
        <Button type="submit" appearance="primary">
          Lọc giao dịch
        </Button>
      </form>
      {error && <Notice error>{error}</Notice>}
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <FetchError error={list.error} retry={() => void list.refetch()} />
      ) : (
        <section className="card history-list" aria-label="Danh sách giao dịch">
          {list.data.pages.every((p) => p.items.length === 0) && (
            <p>Chưa có giao dịch phù hợp bộ lọc.</p>
          )}
          {list.data.pages
            .flatMap((p) => p.items)
            .map((t) => (
              <article
                className="history-row"
                key={`${t.operationType}:${t.id}`}
              >
                <div>
                  <h2>{transactionLabel(t)}</h2>
                  <p>
                    {t.direction === "INCOMING"
                      ? t.senderName
                      : t.recipientName}
                  </p>
                  <p>{localTime(t.createdAt)}</p>
                  <code>{t.id}</code>
                </div>
                <div>
                  <strong className="history-amount">
                    {formatMoney(t.amount)}
                  </strong>
                  <p
                    className={`transaction-status ${t.status === "FAILED" ? "rejected" : ""}`}
                  >
                    {t.status === "SUCCEEDED" ? "Thành công" : "Bị từ chối"}
                  </p>
                  <Link to={`/app/transactions/${t.operationType}/${t.id}`}>
                    Xem chi tiết
                  </Link>
                </div>
              </article>
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
    </>
  );
}
export function TransactionPage() {
  const session = useOutletContext<Session>();
  const { type = "", id = "" } = useParams();
  const detail = useQuery({
    queryKey: ["transaction", session.userId, type, id],
    queryFn: ({ signal }) => transferApi.detail(type, id, signal),
  });
  const t = detail.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Chi tiết giao dịch</h1>
          <p>
            <Link to="/app/transactions">Về lịch sử giao dịch</Link>
          </p>
        </div>
      </div>
      {detail.isPending ? (
        <Loading />
      ) : detail.isError ? (
        <FetchError error={detail.error} retry={() => void detail.refetch()} />
      ) : (
        t && (
          <section className="card funding-receipt">
            <h2>{transactionLabel(t)}</h2>
            <Notice error={t.status === "FAILED"}>
              {t.status === "SUCCEEDED"
                ? "Giao dịch thành công"
                : "Giao dịch bị từ chối"}
            </Notice>
            <dl>
              <dt>Mã giao dịch</dt>
              <dd>{t.id}</dd>
              <dt>Số tiền</dt>
              <dd>{formatMoney(t.amount)}</dd>
              <dt>Phí</dt>
              <dd>{formatMoney(t.fee)}</dd>
              <dt>Người gửi / ví gửi</dt>
              <dd>
                {t.sourceWalletId
                  ? `${t.senderName} · ${t.sourceWalletId}`
                  : "Nguồn cấp tiền mô phỏng"}
              </dd>
              <dt>Người nhận / ví nhận</dt>
              <dd>
                {t.recipientName} · {t.destinationWalletId}
              </dd>
              <dt>Lời nhắn</dt>
              <dd>{t.note || "—"}</dd>
              <dt>Thời gian</dt>
              <dd>{localTime(t.createdAt)}</dd>
              <dt>Tham chiếu ledger</dt>
              <dd>{t.ledgerTransactionId || "Không ghi tiền"}</dd>
              {t.errorCode && (
                <>
                  <dt>Lý do từ chối</dt>
                  <dd>{t.errorCode}</dd>
                </>
              )}
            </dl>
            <Link to="/app/overview">Về ví</Link>
          </section>
        )
      )}
    </>
  );
}
