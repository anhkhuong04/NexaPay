import { render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider } from "@fluentui/react-components";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { RecentActivity } from "./RecentActivity";
import { theme } from "./theme";
import { makeQueryClient } from "./session";
import type { Transaction } from "./transfer";
const base: Transaction = {
  id: "11111111-1111-4111-8111-111111111111",
  operationType: "TRANSFER",
  direction: "OUTGOING",
  status: "SUCCEEDED",
  amount: "10000",
  currency: "VND",
  fee: "0",
  sourceWalletId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  destinationWalletId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  senderName: "An gửi",
  recipientName: "Bình nhận",
  note: "Lunch",
  ledgerTransactionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  errorCode: null,
  createdAt: "2026-11-02T05:00:00Z",
};
const clients: ReturnType<typeof makeQueryClient>[] = [];
afterEach(() => {
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});
function setup(actorId = "A") {
  const client = makeQueryClient();
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <FluentProvider theme={theme}>
        <MemoryRouter>{children}</MemoryRouter>
      </FluentProvider>
    </QueryClientProvider>
  );
  return {
    ...render(<RecentActivity actorId={actorId} />, { wrapper }),
    client,
  };
}
function response(items: Transaction[]) {
  return new Response(JSON.stringify({ items, nextCursor: null }));
}
it("shows loading without invented records or a fabricated empty result", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  setup();
  expect(screen.getByText("Đang tải giao dịch gần đây…")).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.queryByText("Bạn chưa có giao dịch.")).not.toBeInTheDocument();
});
it("renders server order, exact signed successful amounts and unsigned rejected intent", async () => {
  const items: Transaction[] = [
    {
      ...base,
      status: "FAILED",
      ledgerTransactionId: null,
      errorCode: "INSUFFICIENT_FUNDS",
    },
    {
      ...base,
      id: "22222222-2222-4222-8222-222222222222",
      direction: "INCOMING",
    },
    { ...base, id: "33333333-3333-4333-8333-333333333333" },
    {
      ...base,
      id: "44444444-4444-4444-8444-444444444444",
      operationType: "DEMO_FUNDING",
      direction: "FUNDING",
      amount: "100000",
      sourceWalletId: null,
      senderName: "",
      recipientName: "An gửi",
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(items)),
  );
  setup();
  const rows = await screen.findAllByRole("article");
  expect(rows).toHaveLength(4);
  expect(within(rows[0]!).getByText("10.000 ₫")).toBeInTheDocument();
  expect(rows[0]).toHaveTextContent("Bị từ chối");
  expect(rows[0]).toHaveTextContent("Không trừ tiền");
  expect(rows[0]).not.toHaveTextContent("−10.000");
  expect(rows[1]).toHaveTextContent("+10.000 ₫");
  expect(rows[1]).toHaveTextContent("An gửi");
  expect(rows[2]).toHaveTextContent("−10.000 ₫");
  expect(rows[2]).toHaveTextContent("Bình nhận");
  expect(rows[3]).toHaveTextContent("+100.000 ₫");
  expect(rows[3]).toHaveTextContent("Nguồn cấp tiền mô phỏng");
  expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
    "href",
    "/app/transactions/TRANSFER/11111111-1111-4111-8111-111111111111",
  );
  expect(rows[0]!.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-11-02T05:00:00Z",
  );
});
it("renders an authoritative empty state with history and recovery routes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response([])),
  );
  setup();
  expect(await screen.findByText("Bạn chưa có giao dịch.")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Xem toàn bộ lịch sử" }),
  ).toHaveAttribute("href", "/app/transactions");
  expect(screen.getByRole("link", { name: "Thao tác đã lưu" })).toHaveAttribute(
    "href",
    "/app/commands",
  );
});
it("does not replace a failed fetch with empty data and retries the real request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "UNAVAILABLE",
          message: "Không tải được recent.",
        }),
        { status: 503 },
      ),
    )
    .mockImplementation(async () => response([base]));
  vi.stubGlobal("fetch", fetch);
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Không tải được recent.",
  );
  expect(screen.queryByText("Bạn chưa có giao dịch.")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(await screen.findByRole("article")).toHaveTextContent("−10.000 ₫");
});
it("keeps a late old-actor response out of the current activity list", async () => {
  let resolve!: (r: Response) => void;
  const pending = new Promise<Response>((r) => (resolve = r));
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockImplementation(async () =>
        response([{ ...base, recipientName: "Recipient B" }]),
      ),
  );
  const view = setup();
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  view.rerender(<RecentActivity actorId="B" />);
  expect(await screen.findByText("Recipient B")).toBeInTheDocument();
  await act(async () =>
    resolve(response([{ ...base, recipientName: "Private recipient A" }])),
  );
  expect(screen.queryByText("Private recipient A")).not.toBeInTheDocument();
});
