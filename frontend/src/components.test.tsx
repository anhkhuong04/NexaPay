import { render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { it, expect } from "vitest";
import { WalletPanel } from "./components";
import { theme } from "./theme";
import { ApiError } from "./api";

it("never displays a fabricated zero while wallet is loading", () => {
  render(
    <FluentProvider theme={theme}>
      <WalletPanel loading retry={() => {}} />
    </FluentProvider>,
  );
  expect(screen.queryByTestId("wallet-balance")).not.toBeInTheDocument();
  expect(screen.getByText("Đang tải số dư ví…")).toBeInTheDocument();
});
it("never treats a failed fetch as zero and offers retry", () => {
  render(
    <FluentProvider theme={theme}>
      <WalletPanel
        loading={false}
        error={new ApiError(0, "NETWORK_ERROR", "Mất kết nối")}
        retry={() => {}}
      />
    </FluentProvider>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Mất kết nối");
  expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  expect(screen.queryByTestId("wallet-balance")).not.toBeInTheDocument();
});
it("renders an authoritative locked zero wallet read-only", () => {
  render(
    <FluentProvider theme={theme}>
      <WalletPanel
        loading={false}
        wallet={{
          id: "wallet",
          currency: "VND",
          status: "LOCKED",
          availableBalance: "0",
          heldBalance: "0",
          totalBalance: "0",
        }}
        retry={() => {}}
      />
    </FluentProvider>,
  );
  expect(screen.getByTestId("wallet-balance")).toHaveTextContent("0 ₫");
  expect(screen.getByText("Ví bị khóa")).toBeInTheDocument();
});
