import { render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { expect, it, vi } from "vitest";
import { RobotAvatar } from "./RobotAvatar";

it("mounts without matchMedia rather than halting the renderer", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  try {
    expect(() => render(() => <RobotAvatar label="No media query support" />)).not.toThrow();
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-robot-renderer", "unavailable"));
  } finally {
    if (descriptor) Object.defineProperty(window, "matchMedia", descriptor);
    else Reflect.deleteProperty(window, "matchMedia");
  }
});

it("exposes canvas failure instead of calling a flat placeholder 3D", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  render(() => <RobotAvatar label="Unavailable robot" />);
  await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-robot-renderer", "unavailable"));
  expect(screen.getByRole("img")).toHaveAttribute(
    "data-robot-error",
    "3D avatar cannot display: canvas drawing is unavailable.",
  );
  expect(screen.getByRole("img")).toHaveAccessibleName("Unavailable robot. 3D avatar unavailable.");
});

it("disposes an avatar during a parent render without writing readiness", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
  const [visible, setVisible] = createSignal(true);
  render(() => (
    <Show when={visible()}>
      <RobotAvatar label="Remount robot" />
    </Show>
  ));
  await screen.findByRole("img");
  expect(() => setVisible(false)).not.toThrow();
  await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  expect(() => setVisible(true)).not.toThrow();
  await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-robot-renderer", "unavailable"));
});
