import { BusinessPaymentSummary } from "./PaymentBusinessPages";
import { useState } from "react";
import { Button, Field, Input } from "@fluentui/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  useNavigate,
  useOutletContext,
} from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, ApiError, errorMessage, type Session } from "./api";
import { FetchError, Loading, Notice } from "./components";
import { formatMoney } from "./validation";
import {
  merchantApi,
  merchantKey,
  merchantWalletKey,
  merchantSchema,
  type Merchant,
} from "./merchant";

function useMerchant(actorId: string) {
  return useQuery({
    queryKey: merchantKey(actorId),
    queryFn: ({ signal }) => merchantApi.own(signal),
  });
}
function Heading({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">DOANH NGHIỆP · MÔ PHỎNG</span>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}
export function MerchantNameForm({
  actorId,
  merchant,
}: {
  actorId: string;
  merchant?: Merchant;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [unknown, setUnknown] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<{ displayName: string }>({
    resolver: zodResolver(merchantSchema),
    defaultValues: { displayName: merchant?.displayName ?? "" },
  });
  const current = () =>
    client.getQueryData<Session | null>(["session"])?.userId === actorId;
  async function refreshSession() {
    const session = await api.session();
    if (current() && session.userId === actorId)
      client.setQueryData(["session"], session);
  }
  async function checkExisting() {
    setChecking(true);
    setMessage("");
    try {
      const found = await merchantApi.own();
      if (!current()) return;
      client.setQueryData(merchantKey(actorId), found);
      if (found) {
        await refreshSession();
        if (current()) navigate("/business/overview");
      } else {
        setUnknown(false);
        setMessage(
          "Chưa tìm thấy doanh nghiệp. Bạn có thể gửi lại yêu cầu tạo.",
        );
      }
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status === 401)
        client.setQueryData(["session"], null);
      else setMessage(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }
  const submit = handleSubmit(async (body) => {
    setMessage("");
    try {
      const result = merchant
        ? await merchantApi.rename(merchant.id, body.displayName)
        : await merchantApi.onboard(body.displayName);
      if (!current()) return;
      client.setQueryData(merchantKey(actorId), result);
      if (merchant) setMessage("Đã lưu tên doanh nghiệp.");
      else {
        await refreshSession();
        if (current()) navigate("/business/overview");
      }
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && e.status === 401) {
        client.setQueryData(["session"], null);
        return;
      }
      if (
        !merchant &&
        (!(e instanceof ApiError) ||
          e.status === 0 ||
          e.status >= 500 ||
          e.status === 409)
      ) {
        setUnknown(true);
        setMessage(
          "Chưa xác định được kết quả tạo doanh nghiệp. Kiểm tra thông tin đã lưu trước khi gửi lại.",
        );
      } else setError("root", { message: errorMessage(e) });
    }
  });
  return (
    <section className="card merchant-form-card">
      <h2>
        {merchant ? "Thông tin doanh nghiệp" : "Tạo doanh nghiệp mô phỏng"}
      </h2>
      <p>
        Mỗi tài khoản có một doanh nghiệp và ví riêng. Chỉ dùng tên giả; không
        yêu cầu giấy tờ hoặc thông tin ngân hàng.
      </p>
      <form className="account-form" noValidate onSubmit={submit}>
        <Field
          label="Tên doanh nghiệp"
          required
          hint="1–80 ký tự. Dùng tên giả để trải nghiệm doanh nghiệp demo."
          validationMessage={errors.displayName?.message}
          validationState={errors.displayName ? "error" : undefined}
        >
          <Controller
            name="displayName"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                disabled={isSubmitting || unknown || checking}
                autoComplete="organization"
                onChange={(_, data) => field.onChange(data.value)}
              />
            )}
          />
        </Field>
        {errors.root?.message && <Notice error>{errors.root.message}</Notice>}
        {message && <Notice error={unknown}>{message}</Notice>}
        {unknown ? (
          <Button disabled={checking} onClick={() => void checkExisting()}>
            {checking ? "Đang kiểm tra…" : "Kiểm tra doanh nghiệp đã tạo"}
          </Button>
        ) : (
          <Button
            appearance="primary"
            type="submit"
            disabled={isSubmitting || checking}
          >
            {isSubmitting
              ? "Đang lưu…"
              : merchant
                ? "Lưu tên doanh nghiệp"
                : "Tạo doanh nghiệp"}
          </Button>
        )}
      </form>
    </section>
  );
}
export function MerchantOnboarding() {
  const session = useOutletContext<Session>();
  const merchant = useMerchant(session.userId);
  if (merchant.isPending) return <Loading text="Đang kiểm tra doanh nghiệp…" />;
  if (merchant.isError)
    return (
      <FetchError
        error={merchant.error}
        retry={() => void merchant.refetch()}
      />
    );
  if (merchant.data) return <Navigate to="/business/overview" replace />;
  return (
    <>
      <Heading title="Mở không gian doanh nghiệp">
        Ví cá nhân của bạn được giữ riêng. Ví doanh nghiệp bắt đầu từ 0 VND mô
        phỏng.
      </Heading>
      <MerchantNameForm key={session.userId} actorId={session.userId} />
    </>
  );
}
function BusinessWallet({
  actorId,
  merchant,
}: {
  actorId: string;
  merchant: Merchant;
}) {
  const wallet = useQuery({
    queryKey: merchantWalletKey(actorId, merchant.id),
    queryFn: ({ signal }) => merchantApi.wallet(merchant.id, signal),
  });
  return (
    <section
      className="card business-wallet"
      aria-labelledby="business-wallet-heading"
    >
      <div className="section-heading">
        <h2 id="business-wallet-heading">Ví doanh nghiệp</h2>
        <Button
          disabled={wallet.isFetching}
          onClick={() => void wallet.refetch()}
        >
          Tải lại ví doanh nghiệp
        </Button>
      </div>
      {wallet.isPending ? (
        <Loading text="Đang tải ví doanh nghiệp…" />
      ) : wallet.isError ? (
        <FetchError error={wallet.error} retry={() => void wallet.refetch()} />
      ) : (
        <>
          <p>Số dư khả dụng · VND mô phỏng</p>
          <strong className="business-balance" data-testid="merchant-balance">
            {formatMoney(wallet.data.availableBalance)}
          </strong>
          <p>
            {wallet.data.status === "LOCKED"
              ? "Ví doanh nghiệp bị khóa. Bạn vẫn có thể xem thông tin."
              : "Ví doanh nghiệp đang hoạt động"}
          </p>
          <dl className="merchant-metadata">
            <dt>Mã ví doanh nghiệp</dt>
            <dd>
              <code>{wallet.data.id}</code>
            </dd>
            <dt>Loại tiền</dt>
            <dd>VND mô phỏng</dd>
          </dl>
        </>
      )}
    </section>
  );
}
export function BusinessPage({ settings = false }: { settings?: boolean }) {
  const session = useOutletContext<Session>();
  const merchant = useMerchant(session.userId);
  if (merchant.isPending) return <Loading text="Đang tải doanh nghiệp…" />;
  if (merchant.isError)
    return (
      <FetchError
        error={merchant.error}
        retry={() => void merchant.refetch()}
      />
    );
  if (!merchant.data)
    return (
      <>
        <Heading title="Bạn chưa có doanh nghiệp">
          Tạo merchant để mở ví doanh nghiệp riêng.
        </Heading>
        <Link className="button-link" to="/business/onboarding">
          Mở doanh nghiệp demo
        </Link>
      </>
    );
  const data = merchant.data;
  return (
    <div className="business-page">
      <Heading title={settings ? "Cài đặt doanh nghiệp" : data.displayName}>
        Không gian OWNER · tách biệt hoàn toàn với ví cá nhân.
      </Heading>
      {settings ? (
        <MerchantNameForm
          key={`${session.userId}:${data.id}`}
          actorId={session.userId}
          merchant={data}
        />
      ) : (
        <>
          <BusinessWallet actorId={session.userId} merchant={data} />
          <BusinessPaymentSummary actor={session.userId} merchant={data.id} />
        </>
      )}
      <section className="card">
        <h2>Hồ sơ merchant</h2>
        <dl className="merchant-metadata">
          <dt>Mã doanh nghiệp</dt>
          <dd>
            <code>{data.id}</code>
          </dd>
          <dt>Trạng thái</dt>
          <dd>{data.status === "ACTIVE" ? "Đang hoạt động" : "Bị khóa"}</dd>
          <dt>Quyền của bạn</dt>
          <dd>OWNER</dd>
        </dl>
        {!settings && (
          <Link className="button-link" to="/business/settings">
            Chỉnh sửa tên doanh nghiệp
          </Link>
        )}
      </section>
      <p className="helper">
        Ví doanh nghiệp được quản lý riêng với ví cá nhân. Không dùng ví này để
        nhận tiền demo hoặc chuyển tiền cá nhân.
      </p>
    </div>
  );
}
