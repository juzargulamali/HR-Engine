/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { newSubmissionKey, useSubmissionKey } from "./use-submission-key";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function Form({ name }: { name: string }) {
  const key = useSubmissionKey();
  return <form aria-label={name}>{key ? <input type="hidden" name="submissionKey" value={key} data-testid={`key-${name}`} /> : null}</form>;
}
afterEach(cleanup);

describe("the submission identifier of an opened form", () => {
  it("is a random identifier, different every time", () => {
    const a = newSubmissionKey(), b = newSubmissionKey();
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
  it("is not made on the server (a cached page would give everyone the same one)", () => {
    expect(renderToString(<Form name="server" />)).not.toContain("submissionKey");
  });
  it("is made once when the form appears and stays the same for that form, however often it renders; another form has another", () => {
    const { rerender } = render(<><Form name="one" /><Form name="two" /></>);
    const one = (screen.getByTestId("key-one") as HTMLInputElement).value;
    const two = (screen.getByTestId("key-two") as HTMLInputElement).value;
    expect(one).toMatch(UUID);
    expect(two).not.toBe(one);
    rerender(<><Form name="one" /><Form name="two" /></>);
    expect((screen.getByTestId("key-one") as HTMLInputElement).value).toBe(one);
  });
  it("a form opened again (closed and reopened) has a new identifier", () => {
    render(<Form name="one" />);
    const first = (screen.getByTestId("key-one") as HTMLInputElement).value;
    cleanup();
    render(<Form name="one" />);
    expect((screen.getByTestId("key-one") as HTMLInputElement).value).not.toBe(first);
  });
});
