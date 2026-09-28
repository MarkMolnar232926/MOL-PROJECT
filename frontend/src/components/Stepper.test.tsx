import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Stepper } from "./Stepper";

test("a step opens only after the previous one is done", async () => {
  const onSelect = vi.fn();
  render(
    <Stepper
      current="incoming"
      available={{ original: true, incoming: true, matching: false, export: false }}
      done={{ original: true, incoming: false, matching: false, export: false }}
      onSelect={onSelect}
    />,
  );
  expect(screen.getByTestId("step-original")).toHaveAttribute("data-done", "true");
  expect(screen.getByTestId("step-incoming")).toHaveAttribute("aria-current", "step");
  expect(screen.getByTestId("step-matching")).toBeDisabled();
  expect(screen.getByTestId("step-export")).toBeDisabled();
  expect(screen.getByTestId("step-matching")).toHaveTextContent("not available yet");
  await userEvent.click(screen.getByTestId("step-original"));
  expect(onSelect).toHaveBeenCalledWith("original");
});
