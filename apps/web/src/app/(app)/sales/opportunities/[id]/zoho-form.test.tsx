/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));

import { ZohoForm } from "./commercial-forms";
import { ZOHO_SAVE_UNAVAILABLE } from "@/lib/crm/zoho-save";

const values = { quoteRef: "QT-1", quoteSentOn: "2026-11-02", invoiceRef: null, invoiceIssuedOn: null, paymentReceivedOn: null, paidAmount: null };
beforeEach(() => { rpc.mockReset(); from.mockReset(); });
afterEach(() => cleanup());
const typeInvoice = () => fireEvent.change(screen.getByLabelText(/Invoice reference/), { target: { value: "INV-9" } });

describe("the Zoho references form when the database save function is not installed", () => {
  it("keeps the stored references readable in the fields, and on save shows 'temporarily unavailable' with no other write", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.crm_save_zoho_reference in the schema cache" } });
    render(<ZohoForm opportunityId="22222222-2222-4222-8222-222222222222" values={values} currency="AED" />);
    expect((screen.getByLabelText(/Quote reference/) as HTMLInputElement).value).toBe("QT-1");
    typeInvoice();
    fireEvent.click(screen.getByRole("button", { name: "Save references" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(ZOHO_SAVE_UNAVAILABLE));
    expect(screen.getByRole("alert").textContent).not.toMatch(/Someone else changed|cannot be cleared|valid date/);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe("crm_save_zoho_reference");
    expect(from).not.toHaveBeenCalled();
    // what the person typed is kept, and the stored values are still shown
    expect((screen.getByLabelText(/Invoice reference/) as HTMLInputElement).value).toBe("INV-9");
    expect((screen.getByLabelText(/Quote reference/) as HTMLInputElement).value).toBe("QT-1");
  });
  it("a refusal to clear the quote reference is shown as that refusal (not as 'unavailable')", async () => {
    const refusal = "The Zoho Books quote reference cannot be cleared once the enquiry has reached Quote sent (Quote sent, Negotiation, Won, or on hold from one of them). Replace it with the correct reference instead.";
    rpc.mockResolvedValue({ data: null, error: { code: "23514", message: refusal } });
    render(<ZohoForm opportunityId="22222222-2222-4222-8222-222222222222" values={values} currency="AED" />);
    fireEvent.change(screen.getByLabelText(/Quote reference/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save references" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(refusal));
    expect(screen.getByRole("alert").textContent).not.toBe(ZOHO_SAVE_UNAVAILABLE);
  });
});
