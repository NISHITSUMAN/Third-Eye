import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssistantMessage } from "../components/te/CommandBar";

describe("assistant message markup", () => {
  it("renders formatted paragraphs without nesting paragraph elements", () => {
    const { container } = render(
      <AssistantMessage text={"First paragraph.\n\nSecond paragraph.\n# Summary"} />,
    );

    expect(container.querySelector("p p")).toBeNull();
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Summary" })).toBeVisible();
  });
});
