import { type ComponentProps, type ComponentPropsWithRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FloatingPortal } from "@floating-ui/react";

// Keep fixed UI outside the transformed, scrolling page. The overlay host has
// the same scale, but its containing block always follows the visible viewport.
export function AppViewport({ portalled = true, ...props }: ComponentPropsWithRef<"div"> & { portalled?: boolean }) {
  return <AppPortal enabled={portalled}><div {...props} /></AppPortal>;
}

export function AppPortal({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const host = document.getElementById("app-overlays");
  return host && enabled ? createPortal(children, host) : children;
}

export function AppFloatingPortal(props: ComponentProps<typeof FloatingPortal>) {
  return <FloatingPortal {...props} root={document.getElementById("app-overlays")} />;
}

export function getAppScale(width: number): number {
  return Number.isFinite(width) ? Math.min(1.5, Math.max(1, width / 500)) : 1;
}

export function getElementScale(element: HTMLElement): number {
  return element.offsetWidth > 0 ? element.getBoundingClientRect().width / element.offsetWidth : 1;
}
