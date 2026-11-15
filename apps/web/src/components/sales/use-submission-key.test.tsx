/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ANSWER_LOST, keepFormOnLostAnswer, newSubmissionKey, useSubmissionKey } from "./use-submission-key";

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

describe("a save whose answer never arrives", () => {
  const fd = new FormData();
  it("keeps the form and says to save again, instead of failing the page", async () => {
    const lost = keepFormOnLostAnswer<{ error: string | null }>(async () => { throw new TypeError("Failed to fetch"); });
    expect(await lost({ error: null }, fd)).toEqual({ error: ANSWER_LOST });
    expect(ANSWER_LOST).toMatch(/press the save button again.*no second one is created/);
  });
  it("passes an ordinary answer and a refusal through unchanged", async () => {
    expect(await keepFormOnLostAnswer<{ error: string | null }>(async () => ({ error: null }))({ error: null }, fd)).toEqual({ error: null });
    expect(await keepFormOnLostAnswer<{ error: string | null }>(async () => ({ error: "Choose an agency" }))({ error: null }, fd)).toEqual({ error: "Choose an agency" });
  });
  it("lets the redirect of a successful save through", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/sales/opportunities/x;307;" });
    await expect(keepFormOnLostAnswer<{ error: string | null }>(async () => { throw redirect; })({ error: null }, fd)).rejects.toBe(redirect);
  });
});
