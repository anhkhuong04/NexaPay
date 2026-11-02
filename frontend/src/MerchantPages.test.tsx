import { afterEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FluentProvider } from "@fluentui/react-components";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MerchantNameForm } from "./MerchantPages";
import { merchantApi, merchantKey, type Merchant } from "./merchant";
import { api, ApiError } from "./api";
import { theme } from "./theme";
const merchant: Merchant = {
  id: "M",
  displayName: "Demo",
  status: "ACTIVE",
  createdAt: "2026-11-02T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
};
const session = {
  userId: "A",
  roles: ["INDIVIDUAL"],
  authenticatedAt: "",
  absoluteExpiresAt: "",
};
afterEach(() => vi.restoreAllMocks());
function setup(existing?: Merchant) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["session"], session);
  render(
    <FluentProvider theme={theme}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Routes>
            <Route
              path="/"
              element={<MerchantNameForm actorId="A" merchant={existing} />}
            />
            <Route
              path="/business/overview"
              element={<h1>Business result</h1>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>,
  );
  return client;
}
it("validates before POST and disables the form until authoritative creation", async () => {
  let resolve!: (m: Merchant) => void;
  const pending = new Promise<Merchant>((r) => (resolve = r));
  const create = vi.spyOn(merchantApi, "onboard").mockReturnValue(pending);
  vi.spyOn(api, "session").mockResolvedValue({
    ...session,
    merchantId: "M",
    roles: ["INDIVIDUAL", "MERCHANT"],
  });
  const client = setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Tạo doanh nghiệp" }),
  );
  expect(create).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText(/^Tên doanh nghiệp/), "Café Demo");
  await userEvent.click(
    screen.getByRole("button", { name: "Tạo doanh nghiệp" }),
  );
  expect(screen.getByRole("button", { name: "Đang lưu…" })).toBeDisabled();
  expect(client.getQueryData(merchantKey("A"))).toBeUndefined();
  resolve(merchant);
  expect(
    await screen.findByRole("heading", { name: "Business result" }),
  ).toBeVisible();
  expect(create).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(["session"])).toMatchObject({ merchantId: "M" });
});
it("lost create response requires GET recovery and never automatically posts twice", async () => {
  const create = vi
    .spyOn(merchantApi, "onboard")
    .mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "Lost"));
  const lookup = vi.spyOn(merchantApi, "own").mockResolvedValue(merchant);
  vi.spyOn(api, "session").mockResolvedValue({ ...session, merchantId: "M" });
  setup();
  await userEvent.type(screen.getByLabelText(/^Tên doanh nghiệp/), "Demo");
  await userEvent.click(
    screen.getByRole("button", { name: "Tạo doanh nghiệp" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Chưa xác định được kết quả",
  );
  expect(lookup).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Kiểm tra doanh nghiệp đã tạo" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Business result" }),
  ).toBeVisible();
  expect(create).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenCalledTimes(1);
});
it("confirmed missing after recovery enables an explicit new submit", async () => {
  const create = vi
    .spyOn(merchantApi, "onboard")
    .mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "Unknown"));
  vi.spyOn(merchantApi, "own").mockResolvedValue(null);
  setup();
  await userEvent.type(screen.getByLabelText(/^Tên doanh nghiệp/), "Demo");
  await userEvent.click(
    screen.getByRole("button", { name: "Tạo doanh nghiệp" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Kiểm tra doanh nghiệp đã tạo" }),
  );
  expect(
    await screen.findByRole("button", { name: "Tạo doanh nghiệp" }),
  ).toBeEnabled();
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Chưa tìm thấy doanh nghiệp",
  );
});
it("late create result cannot overwrite a different actor or navigate it", async () => {
  let resolve!: (m: Merchant) => void;
  vi.spyOn(merchantApi, "onboard").mockReturnValue(
    new Promise((r) => (resolve = r)),
  );
  const summary = vi.spyOn(api, "session");
  const client = setup();
  await userEvent.type(screen.getByLabelText(/^Tên doanh nghiệp/), "Demo");
  await userEvent.click(
    screen.getByRole("button", { name: "Tạo doanh nghiệp" }),
  );
  client.clear();
  client.setQueryData(["session"], { ...session, userId: "B" });
  resolve(merchant);
  await screen.findByRole("button", { name: "Tạo doanh nghiệp" });
  expect(client.getQueryData(merchantKey("A"))).toBeUndefined();
  expect(client.getQueryData(["session"])).toMatchObject({ userId: "B" });
  expect(summary).not.toHaveBeenCalled();
  expect(screen.queryByText("Business result")).not.toBeInTheDocument();
});
it("renames the owned merchant from server result without touching personal cache", async () => {
  const rename = vi
    .spyOn(merchantApi, "rename")
    .mockResolvedValue({ ...merchant, displayName: "New Demo" });
  const client = setup(merchant);
  client.setQueryData(["wallet", "A", "personal"], {
    availableBalance: "100000",
  });
  await userEvent.clear(screen.getByLabelText(/^Tên doanh nghiệp/));
  await userEvent.type(screen.getByLabelText(/^Tên doanh nghiệp/), "New Demo");
  await userEvent.click(
    screen.getByRole("button", { name: "Lưu tên doanh nghiệp" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Đã lưu tên doanh nghiệp",
  );
  expect(rename).toHaveBeenCalledWith("M", "New Demo");
  expect(client.getQueryData(["wallet", "A", "personal"])).toEqual({
    availableBalance: "100000",
  });
});

it("expired session during explicit recovery returns to unauthenticated state", async () => {
  vi.spyOn(merchantApi, "onboard").mockRejectedValue(
    new ApiError(0, "NETWORK_ERROR", "Lost"),
  );
  vi.spyOn(merchantApi, "own").mockRejectedValue(
    new ApiError(401, "UNAUTHENTICATED", "Login"),
  );
  const client = setup();
  await userEvent.type(screen.getByLabelText(/^Tên doanh nghiệp/), "Demo");
  await userEvent.click(
    screen.getByRole("button", { name: "Tạo doanh nghiệp" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Kiểm tra doanh nghiệp đã tạo" }),
  );
  await screen.findByRole("button", { name: "Kiểm tra doanh nghiệp đã tạo" });
  expect(client.getQueryData(["session"])).toBeNull();
});
