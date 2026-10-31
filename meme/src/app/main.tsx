import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import "./brandComponents.css";
import { qaEnabled } from "./qaMode";
if (import.meta.env.DEV && qaEnabled)
  void import("./QAWorkbench").then((module) =>
    module.mountQA(document.getElementById("root")!),
  );
else
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
