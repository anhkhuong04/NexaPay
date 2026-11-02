import { useEffect, useState } from "react";
import { Button, Field, Input } from "@fluentui/react-components";
import {
  ArrowRight24Regular,
  ArrowClockwise24Regular,
  CheckmarkCircle24Regular,
  Copy24Regular,
  Eye24Regular,
  EyeOff24Regular,
  Home24Regular,
  Person24Regular,
  ShieldCheckmark24Regular,
  Wallet24Regular,
} from "@fluentui/react-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router-dom";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError, errorMessage, type Profile, type Session } from "./api";
import { Brand, FetchError, Loading, Notice, WalletPanel } from "./components";
import { replaceActor, safeReturnTo, sessionOptions } from "./session";
import { displayName, loginSchema, registerSchema } from "./validation";
import { FundingPage, CommandsPage } from "./FundingPages";
import { SendPage, HistoryPage, TransactionPage } from "./TransferPages";

function RouteFocus() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.getElementById("main-content")?.focus();
  }, [pathname]);
  return null;
}

function Landing() {
  return (
    <div className="landing">
      <header className="public-header">
        <Link to="/" aria-label="NexaPay — trang chủ">
          <Brand />
        </Link>
        <nav aria-label="Điều hướng chính">
          <Link to="/auth/sign-in" className="text-link">
            Đăng nhập
          </Link>
          <Link to="/auth/sign-up" className="button-link">
            Bắt đầu <ArrowRight24Regular aria-hidden />
          </Link>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="status-dot" />
              TRẢI NGHIỆM VÍ MÔ PHỎNG
            </span>
            <h1>
              Ví của bạn.
              <br />
              <span>Mọi thứ rõ ràng.</span>
            </h1>
            <p>
              Một không gian riêng để bắt đầu. Tạo tài khoản, khám phá ví cá
              nhân và theo dõi thông tin của bạn thật đơn giản.
            </p>
            <div className="hero-actions">
              <Link to="/auth/sign-up" className="button-link large">
                Tạo ví demo <ArrowRight24Regular aria-hidden />
              </Link>
              <Link to="/auth/sign-in" className="text-link">
                Tôi đã có tài khoản
              </Link>
            </div>
            <p className="hero-footnote">
              <ShieldCheckmark24Regular aria-hidden />
              Không sử dụng tiền thật. Không cần thông tin ngân hàng.
            </p>
          </div>
          <div className="hero-visual" aria-label="Minh họa ví mô phỏng">
            <div className="visual-orbit" />
            <div className="preview-card">
              <div className="preview-top">
                <Wallet24Regular aria-hidden />
                <span>Ví cá nhân</span>
                <span className="preview-chip">Minh họa</span>
              </div>
              <p>Số dư mô phỏng</p>
              <div className="preview-amount">0 ₫</div>
              <div className="preview-rule" />
              <div className="preview-bottom">
                <span>Khởi đầu mới, thật rõ ràng.</span>
                <ShieldCheckmark24Regular aria-hidden />
              </div>
            </div>
            <div className="floating-note">
              <span className="check-circle">
                <CheckmarkCircle24Regular aria-hidden />
              </span>
              <div>
                <strong>Sẵn sàng cho bạn</strong>
                <span>Tạo tài khoản để mở ví demo</span>
              </div>
            </div>
          </div>
        </section>
        <section className="principles" aria-label="Trải nghiệm NexaPay">
          <div>
            <span className="step-number">01</span>
            <h2>Bắt đầu dễ dàng</h2>
            <p>Một tài khoản cá nhân, một chiếc ví dành riêng cho bạn.</p>
          </div>
          <div>
            <span className="step-number">02</span>
            <h2>Thông tin minh bạch</h2>
            <p>Số dư và trạng thái ví được trình bày rõ ràng, dễ hiểu.</p>
          </div>
          <div>
            <span className="step-number">03</span>
            <h2>Thoải mái khám phá</h2>
            <p>Dữ liệu mô phỏng để trải nghiệm, không có giá trị quy đổi.</p>
          </div>
        </section>
      </main>
      <footer className="public-footer">
        <span>© NexaPay</span>
        <span>Tiền mô phỏng — không phải dịch vụ thanh toán thật.</span>
      </footer>
    </div>
  );
}

function AuthLayout() {
  const session = useQuery(sessionOptions);
  if (session.isPending) return <Loading text="Đang kiểm tra phiên…" />;
  if (session.isError)
    return (
      <FetchError error={session.error} retry={() => void session.refetch()} />
    );
  if (session.data) return <Navigate to="/app/overview" replace />;
  return (
    <div className="auth-page">
      <header className="public-header">
        <Link to="/" aria-label="NexaPay — trang chủ">
          <Brand />
        </Link>
        <Link to="/" className="text-link">
          Về trang chủ
        </Link>
      </header>
      <main id="main-content" tabIndex={-1} className="auth-layout">
        <aside className="auth-story">
          <span className="eyebrow">ĐƠN GIẢN. RÕ RÀNG. CỦA BẠN.</span>
          <p className="story-title">
            Một khởi đầu mới
            <br />
            cho chiếc ví của bạn.
          </p>
          <p>
            Khám phá trải nghiệm ví cá nhân trong một môi trường mô phỏng, với
            thông tin luôn rõ ràng.
          </p>
          <div className="story-feature">
            <Wallet24Regular aria-hidden />
            <span>Ví cá nhân dành riêng cho bạn</span>
          </div>
          <div className="story-feature">
            <ShieldCheckmark24Regular aria-hidden />
            <span>Không sử dụng tiền hay tài khoản ngân hàng thật</span>
          </div>
          <div className="story-bottom">Pay simply. Track confidently.</div>
        </aside>
        <section className="auth-form-panel">
          <Outlet />
        </section>
      </main>
      <footer className="auth-footer">
        NexaPay là sản phẩm mô phỏng. Hãy dùng dữ liệu giả, ví dụ
        alice@example.test.
      </footer>
    </div>
  );
}

function PasswordToggle({
  visible,
  toggle,
}: {
  visible: boolean;
  toggle: () => void;
}) {
  return (
    <Button
      type="button"
      appearance="transparent"
      size="small"
      aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
      onClick={toggle}
      icon={visible ? <EyeOff24Regular /> : <Eye24Regular />}
    />
  );
}

function SignIn() {
  const [visible, setVisible] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const state = location.state as {
    email?: string;
    registered?: boolean;
    from?: string;
  } | null;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: state?.email ?? "", password: "" },
  });
  const submit = handleSubmit(async (body) => {
    try {
      const session = await api.login(body);
      await replaceActor(client, session);
      navigate(safeReturnTo(state?.from), { replace: true });
    } catch (error) {
      setError("root", { message: errorMessage(error) });
    }
  });
  return (
    <>
      <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
      <h1>Đăng nhập</h1>
      <p className="form-intro">Chiếc ví của bạn đang chờ.</p>
      {state?.registered && (
        <Notice>Đã tạo ví demo. Đăng nhập để bắt đầu.</Notice>
      )}
      <form onSubmit={submit} noValidate className="account-form">
        <Field
          label="Email"
          required
          validationMessage={errors.email?.message}
          validationState={errors.email ? "error" : undefined}
        >
          <Input type="email" autoComplete="username" {...register("email")} />
        </Field>
        <Field
          label="Mật khẩu"
          required
          validationMessage={errors.password?.message}
          validationState={errors.password ? "error" : undefined}
        >
          <Input
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            {...register("password")}
            contentAfter={
              <PasswordToggle
                visible={visible}
                toggle={() => setVisible(!visible)}
              />
            }
          />
        </Field>
        {errors.root?.message && <Notice error>{errors.root.message}</Notice>}
        <Button
          type="submit"
          appearance="primary"
          size="large"
          disabled={isSubmitting}
          icon={isSubmitting ? undefined : <ArrowRight24Regular />}
          iconPosition="after"
        >
          {isSubmitting ? "Đang đăng nhập…" : "Đăng nhập"}
        </Button>
      </form>
      <p className="form-switch">
        Chưa có tài khoản? <Link to="/auth/sign-up">Tạo ví demo</Link>
      </p>
    </>
  );
}

function SignUp() {
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      displayName: "",
      password: "",
      confirmPassword: "",
    },
  });
  const submit = handleSubmit(async (v) => {
    try {
      await api.register({
        email: v.email,
        password: v.password,
        displayName: v.displayName,
      });
      navigate("/auth/sign-in", {
        replace: true,
        state: { registered: true, email: v.email },
      });
    } catch (error) {
      setError("root", { message: errorMessage(error) });
    }
  });
  return (
    <>
      <span className="eyebrow">BẮT ĐẦU VỚI NEXAPAY</span>
      <h1>Tạo ví của bạn</h1>
      <p className="form-intro">Chỉ vài thông tin để bắt đầu trải nghiệm.</p>
      <form onSubmit={submit} noValidate className="account-form">
        <Field
          label="Tên hiển thị"
          required
          validationMessage={errors.displayName?.message}
          validationState={errors.displayName ? "error" : undefined}
        >
          <Input autoComplete="nickname" {...register("displayName")} />
        </Field>
        <Field
          label="Email"
          required
          hint="Dùng địa chỉ giả, ví dụ alice@example.test."
          validationMessage={errors.email?.message}
          validationState={errors.email ? "error" : undefined}
        >
          <Input type="email" autoComplete="username" {...register("email")} />
        </Field>
        <Field
          label="Mật khẩu"
          required
          hint="12–64 ký tự, tối đa 72 byte UTF-8."
          validationMessage={errors.password?.message}
          validationState={errors.password ? "error" : undefined}
        >
          <Input
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            {...register("password")}
            contentAfter={
              <PasswordToggle
                visible={visible}
                toggle={() => setVisible(!visible)}
              />
            }
          />
        </Field>
        <Field
          label="Xác nhận mật khẩu"
          required
          validationMessage={errors.confirmPassword?.message}
          validationState={errors.confirmPassword ? "error" : undefined}
        >
          <Input
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
        </Field>
        {errors.root?.message && <Notice error>{errors.root.message}</Notice>}
        <Button
          type="submit"
          appearance="primary"
          size="large"
          disabled={isSubmitting}
          icon={isSubmitting ? undefined : <ArrowRight24Regular />}
          iconPosition="after"
        >
          {isSubmitting ? "Đang tạo ví…" : "Tạo tài khoản demo"}
        </Button>
      </form>
      <p className="form-switch">
        Đã có tài khoản? <Link to="/auth/sign-in">Đăng nhập</Link>
      </p>
    </>
  );
}

function Protected() {
  const session = useQuery(sessionOptions);
  const location = useLocation();
  if (session.isPending) return <Loading text="Đang kiểm tra phiên…" />;
  if (session.isError)
    return (
      <FetchError error={session.error} retry={() => void session.refetch()} />
    );
  if (!session.data)
    return (
      <Navigate
        to="/auth/sign-in"
        replace
        state={{ from: location.pathname }}
      />
    );
  return <AppShell session={session.data} />;
}

function AppShell({ session }: { session: Session }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const profile = useQuery({
    queryKey: ["profile", session.userId, "personal"],
    queryFn: ({ signal }) => api.profile(signal),
  });
  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      await api.logout();
      await replaceActor(client, null);
      navigate("/auth/sign-in", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setLoggingOut(false);
    }
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/app/overview" aria-label="NexaPay — tổng quan">
          <Brand />
        </Link>
        <div className="workspace-label">VÍ CÁ NHÂN</div>
        <nav aria-label="Ví cá nhân">
          <NavLink to="/app/overview">
            <Home24Regular aria-hidden />
            Tổng quan
          </NavLink>
          <NavLink to="/app/send">
            <ArrowRight24Regular aria-hidden />
            Chuyển tiền
          </NavLink>
          <NavLink to="/app/transactions">
            <ArrowClockwise24Regular aria-hidden />
            Lịch sử giao dịch
          </NavLink>
          <NavLink to="/app/profile">
            <Person24Regular aria-hidden />
            Hồ sơ của tôi
          </NavLink>
          <NavLink to="/app/add-demo-funds">
            <Wallet24Regular aria-hidden />
            Nhận tiền demo
          </NavLink>
          <NavLink to="/app/commands">
            <ArrowClockwise24Regular aria-hidden />
            Thao tác đã lưu
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheckmark24Regular aria-hidden />
          <strong>Không gian mô phỏng</strong>
          <p>
            Khám phá thoải mái.
            <br />
            Không sử dụng tiền thật.
          </p>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-header">
          <span className="app-section">
            Ví cá nhân <span className="header-demo">Demo</span>
          </span>
          <div className="header-account">
            <span className="avatar" aria-hidden>
              {profile.data?.displayName.charAt(0).toUpperCase() ?? "N"}
            </span>
            <span className="header-name">
              {profile.data?.displayName ?? "Tài khoản của bạn"}
            </span>
            <Button
              appearance="subtle"
              onClick={() => void logout()}
              disabled={loggingOut}
            >
              {loggingOut ? "Đang thoát…" : "Đăng xuất"}
            </Button>
          </div>
        </header>
        <main className="app-main" id="main-content" tabIndex={-1}>
          {error && <Notice error>{error}</Notice>}
          <Outlet context={session} />
        </main>
        <footer className="app-footer">
          Tiền mô phỏng, không có giá trị thanh toán hoặc quy đổi.
        </footer>
      </div>
    </div>
  );
}

function Overview() {
  const session = useOutletContext<Session>();
  const [copyMessage, setCopyMessage] = useState("");
  const profile = useQuery({
    queryKey: ["profile", session.userId, "personal"],
    queryFn: ({ signal }) => api.profile(signal),
  });
  const wallet = useQuery({
    queryKey: ["wallet", session.userId, "personal"],
    queryFn: ({ signal }) => api.wallet(signal),
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet.data!.id);
      setCopyMessage("Đã sao chép mã ví.");
    } catch {
      setCopyMessage("Chưa thể sao chép. Bạn có thể chọn mã ví bên dưới.");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TỔNG QUAN</span>
          <h1>
            Chào {profile.data?.displayName ?? "bạn"}
            <span className="heading-dot">.</span>
          </h1>
          <p>Mọi thông tin về chiếc ví của bạn, tại một nơi.</p>
        </div>
        <Button
          appearance="outline"
          icon={<ArrowClockwise24Regular />}
          disabled={wallet.isFetching}
          onClick={() => void wallet.refetch()}
        >
          Tải lại
        </Button>
      </div>
      <div className="dashboard-grid">
        <WalletPanel
          wallet={wallet.data}
          loading={wallet.isPending}
          error={wallet.error}
          retry={() => void wallet.refetch()}
        />
        <section className="card welcome-card">
          <span className="card-icon">
            <CheckmarkCircle24Regular aria-hidden />
          </span>
          <h2>Một khởi đầu rõ ràng</h2>
          <p>
            Ví cá nhân đã được tạo riêng cho bạn. Bạn có thể xem thông tin ví và
            cập nhật hồ sơ bất cứ lúc nào.
          </p>
          <Link to="/app/profile" className="inline-action">
            Xem hồ sơ của tôi <ArrowRight24Regular aria-hidden />
          </Link>
        </section>
      </div>
      <section className="card wallet-details">
        <div className="section-heading">
          <div>
            <span className="eyebrow">DÀNH RIÊNG CHO BẠN</span>
            <h2>Thông tin ví</h2>
          </div>
          <Wallet24Regular aria-hidden />
        </div>
        <div className="detail-row">
          <span>Mã ví cá nhân</span>
          <div className="wallet-id">
            {wallet.data ? (
              <>
                <code>{wallet.data.id}</code>
                <Button
                  appearance="subtle"
                  icon={<Copy24Regular />}
                  aria-label="Sao chép mã ví"
                  onClick={() => void copy()}
                />
              </>
            ) : (
              <span>Chưa tải được thông tin ví</span>
            )}
          </div>
        </div>
        <div className="detail-row">
          <span>Loại tiền</span>
          <strong>VND mô phỏng</strong>
        </div>
        <div className="detail-row">
          <span>Chủ sở hữu</span>
          <strong>{profile.data?.displayName ?? "Chưa tải được hồ sơ"}</strong>
        </div>
        {copyMessage && (
          <p className="helper" role="status">
            {copyMessage}
          </p>
        )}
        {profile.isError && (
          <FetchError
            error={profile.error}
            retry={() => void profile.refetch()}
          />
        )}
      </section>
      <p>
        <Link to="/app/send" className="button-link">
          Chuyển tiền
        </Link>{" "}
        <Link to="/app/add-demo-funds" className="button-link">
          Nhận tiền demo
        </Link>
      </p>
      <div className="simulation-note">
        <ShieldCheckmark24Regular aria-hidden />
        <div>
          <strong>Trải nghiệm an tâm trong môi trường mô phỏng</strong>
          <p>
            Số dư này không phải tiền thật. Mọi khoản cấp demo đều có hạn mức,
            có bút toán đối ứng và có thể tra cứu kết quả.
          </p>
        </div>
      </div>
    </>
  );
}

const profileSchema = z.object({ displayName });
function ProfileEditor({
  profile,
  session,
}: {
  profile: Profile;
  session: Session;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const {
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: profile.displayName },
  });
  const submit = handleSubmit(async (body) => {
    setSaved(false);
    try {
      const updated = await api.rename(body.displayName);
      client.setQueryData(["profile", session.userId, "personal"], updated);
      reset({ displayName: updated.displayName });
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await replaceActor(client, null);
        navigate("/auth/sign-in", {
          replace: true,
          state: { from: "/app/profile" },
        });
        return;
      }
      setError("root", { message: errorMessage(error) });
    }
  });
  return (
    <section className="card profile-card">
      <div className="section-heading">
        <h2>Thông tin cá nhân</h2>
        <Person24Regular aria-hidden />
      </div>
      <form onSubmit={submit} noValidate className="account-form">
        <Field
          label="Email"
          hint="Email chỉ dùng để đăng nhập và không thể thay đổi."
        >
          <Input type="email" value={profile.email} readOnly />
        </Field>
        <Field
          label="Tên hiển thị"
          required
          validationMessage={errors.displayName?.message}
          validationState={errors.displayName ? "error" : undefined}
        >
          <Controller
            name="displayName"
            control={control}
            render={({ field }) => (
              <Input
                autoComplete="nickname"
                {...field}
                onChange={(_, data) => field.onChange(data.value)}
              />
            )}
          />
        </Field>
        {errors.root?.message && <Notice error>{errors.root.message}</Notice>}
        {saved && <Notice>Đã lưu thông tin hồ sơ.</Notice>}
        <Button type="submit" appearance="primary" disabled={isSubmitting}>
          {isSubmitting ? "Đang lưu…" : "Lưu thay đổi"}
        </Button>
      </form>
    </section>
  );
}
function ProfilePage() {
  const session = useOutletContext<Session>();
  const profile = useQuery({
    queryKey: ["profile", session.userId, "personal"],
    queryFn: ({ signal }) => api.profile(signal),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TÀI KHOẢN CỦA BẠN</span>
          <h1>Hồ sơ của tôi</h1>
          <p>Giữ thông tin của bạn luôn rõ ràng.</p>
        </div>
      </div>
      {profile.isPending ? (
        <Loading />
      ) : profile.isError ? (
        <FetchError
          error={profile.error}
          retry={() => void profile.refetch()}
        />
      ) : (
        <ProfileEditor
          key={session.userId}
          profile={profile.data}
          session={session}
        />
      )}
      <div className="simulation-note">
        <ShieldCheckmark24Regular aria-hidden />
        <div>
          <strong>Tài khoản dành cho trải nghiệm demo</strong>
          <p>
            Hãy sử dụng dữ liệu giả. NexaPay không yêu cầu thông tin ngân hàng
            hay giấy tờ cá nhân.
          </p>
        </div>
      </div>
    </>
  );
}

export function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Đến nội dung chính
      </a>
      <RouteFocus />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={<AuthLayout />}>
          <Route path="sign-in" element={<SignIn />} />
          <Route path="sign-up" element={<SignUp />} />
        </Route>
        <Route path="/app" element={<Protected />}>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="add-demo-funds" element={<FundingPage />} />
          <Route path="commands" element={<CommandsPage />} />
          <Route path="send" element={<SendPage />} />
          <Route path="transactions" element={<HistoryPage />} />
          <Route path="transactions/:type/:id" element={<TransactionPage />} />
        </Route>
        <Route
          path="*"
          element={
            <main id="main-content" tabIndex={-1} className="not-found">
              <Brand />
              <h1>Không tìm thấy trang</h1>
              <Link to="/">Về trang chủ</Link>
            </main>
          }
        />
      </Routes>
    </>
  );
}
