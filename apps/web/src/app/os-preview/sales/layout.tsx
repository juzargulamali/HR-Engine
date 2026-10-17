import { SalesGuard } from "../_components/sales-guard";

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return <SalesGuard>{children}</SalesGuard>;
}
