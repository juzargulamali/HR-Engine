import {
  BellRing,
  Building,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Landmark,
  LayoutDashboard,
  Package,
  Receipt,
  ScrollText,
  Sparkles,
  TrendingUp,
  User,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { NavIconKey } from "./nav-groups";

/**
 * Resolves a NavIconKey (plain string, safe to pass from a Server
 * Component) to an actual icon component — done here, inside a module
 * only ever imported by Client Components (sidebar-nav.tsx,
 * command-palette.tsx), so the component reference never has to cross the
 * server/client boundary as prop data.
 */
export const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  profile: User,
  employees: Users,
  attendance: CalendarCheck,
  leave: CalendarDays,
  reimbursements: Receipt,
  performance: TrendingUp,
  approvals: ClipboardCheck,
  alerts: BellRing,
  letters: FileText,
  payroll: Wallet,
  assets: Package,
  policies: BookOpen,
  holidays: Landmark,
  companies: Building,
  ai: Sparkles,
  audit: ScrollText,
  users: UserCog,
};
