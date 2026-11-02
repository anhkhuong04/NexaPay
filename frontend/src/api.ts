export interface Session {
  userId: string;
  roles: string[];
  authenticatedAt: string;
  absoluteExpiresAt: string;
}
export interface Profile {
  id: string;
  email: string;
  displayName: string;
}
export interface Wallet {
  id: string;
  currency: "VND";
  status: "ACTIVE" | "LOCKED";
  availableBalance: string;
  heldBalance: string;
  totalBalance: string;
}
export interface Registration {
  email: string;
  password: string;
  displayName: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Không thể kết nối. Vui lòng kiểm tra mạng rồi thử lại.",
    );
  }
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body as {
      code?: string;
      message?: string;
      correlationId?: string;
    };
    throw new ApiError(
      response.status,
      error.code ?? "REQUEST_FAILED",
      error.message ?? "Chưa thể xử lý yêu cầu.",
      error.correlationId,
    );
  }
  return body as T;
}

async function mutate<T>(
  path: string,
  method: "POST" | "PATCH",
  body?: unknown,
): Promise<T> {
  const csrf = await request<{ token: string; headerName: string }>(
    "/auth/csrf",
  );
  return request<T>(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      [csrf.headerName]: csrf.token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  session: (signal?: AbortSignal) =>
    request<Session>("/auth/session", { signal }),
  profile: (signal?: AbortSignal) => request<Profile>("/me", { signal }),
  wallet: (signal?: AbortSignal) => request<Wallet>("/wallets/me", { signal }),
  register: (body: Registration) =>
    mutate<{ userId: string; walletId: string }>(
      "/auth/register",
      "POST",
      body,
    ),
  login: (body: { email: string; password: string }) =>
    mutate<Session>("/auth/login", "POST", body),
  logout: () => mutate<void>("/auth/logout", "POST"),
  rename: (displayName: string) =>
    mutate<Profile>("/me", "PATCH", { displayName }),
};

export const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : "Chưa thể xử lý yêu cầu. Vui lòng thử lại.";
