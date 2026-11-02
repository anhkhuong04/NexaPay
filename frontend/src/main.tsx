import React from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { theme } from "./theme";
import { makeQueryClient } from "./session";
import "./styles.css";

const client = makeQueryClient();
const App = React.lazy(async () => ({ default: (await import("./App")).App }));
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FluentProvider theme={theme}>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <React.Suspense
            fallback={
              <div className="loading" role="status">
                Đang mở NexaPay…
              </div>
            }
          >
            <App />
          </React.Suspense>
        </BrowserRouter>
      </QueryClientProvider>
    </FluentProvider>
  </React.StrictMode>,
);
