import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
type Kind = "success" | "error";
const Feedback = createContext<(message: string, kind?: Kind) => void>(
  () => {},
);
export const useFeedback = () => useContext(Feedback);
/** Warplet's compact top-edge feedback pattern, never used for polling. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: Kind } | null>(
    null,
  );
  const notify = useCallback(
    (message: string, kind: Kind = "success") => setToast({ message, kind }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <Feedback.Provider value={notify}>
      {children}
      {toast && (
        <div
          className={
            "app-toast " + (toast.kind === "error" ? "app-toast-danger" : "")
          }
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button aria-label="Close message" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </Feedback.Provider>
  );
}
