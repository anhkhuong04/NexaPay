import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FluentProvider } from "@fluentui/react-components";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { expect, it } from "vitest";
import { OverviewActions } from "./OverviewActions";
import type { Wallet } from "./api";
import { theme } from "./theme";
const wallet: Wallet = {
  id: "wallet",
  currency: "VND",
  status: "ACTIVE",
  availableBalance: "100000",
  heldBalance: "0",
  totalBalance: "100000",
};
function setup(props: React.ComponentProps<typeof OverviewActions>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FluentProvider theme={theme}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={children} />
          <Route path="/app/send" element={<h1>Review transfer route</h1>} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>
  );
  return render(<OverviewActions {...props} />, { wrapper });
}
it("blocks new intents on a locked wallet while keeping history and command recovery available", async () => {
  setup({ wallet: { ...wallet, status: "LOCKED" }, loading: false });
  expect(screen.getByRole("alert")).toHaveTextContent("Ví đang bị khóa");
  const send = screen.getByRole("button", { name: "Chuyển tiền" });
  expect(send).toBeDisabled();
  expect(screen.getByRole("button", { name: "Nhận tiền demo" })).toBeDisabled();
  await userEvent.click(send);
  expect(screen.queryByText("Review transfer route")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Lịch sử giao dịch" }),
  ).toHaveAttribute("href", "/app/transactions");
  expect(screen.getByRole("link", { name: "Thao tác đã lưu" })).toHaveAttribute(
    "href",
    "/app/commands",
  );
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Lịch sử giao dịch" })).toHaveFocus();
});
it("does not enable money controls before a successful wallet read or after a failed refresh", () => {
  const view = setup({ loading: true });
  expect(screen.getByRole("button", { name: "Chuyển tiền" })).toBeDisabled();
  view.rerender(
    <OverviewActions
      wallet={wallet}
      loading={false}
      error={new Error("offline")}
    />,
  );
  expect(screen.getByRole("button", { name: "Chuyển tiền" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Nhận tiền demo" })).toBeDisabled();
});
it("enables an authoritative active wallet, supports keyboard navigation, and reacts to a lock refetch", async () => {
  const view = setup({ wallet, loading: false });
  expect(screen.getByRole("button", { name: "Chuyển tiền" })).toBeEnabled();
  view.rerender(
    <OverviewActions
      wallet={{ ...wallet, status: "LOCKED" }}
      loading={false}
    />,
  );
  expect(screen.getByRole("button", { name: "Chuyển tiền" })).toBeDisabled();
  view.rerender(<OverviewActions wallet={wallet} loading={false} />);
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Chuyển tiền" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(
    screen.getByRole("heading", { name: "Review transfer route" }),
  ).toBeInTheDocument();
});
