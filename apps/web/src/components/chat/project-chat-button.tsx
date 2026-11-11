"use client";

import { MessageCircle } from "lucide-react";
import { openChatGroup } from "@/lib/chat/model";
import { cn } from "@/lib/utils";

/**
 * A project page's shortcut to its conversation: opens the project's group in the app-wide Chat panel, over the current page. It holds no conversation of its own; the panel
 * (and the server behind it) decides whether this person may read the group.
 */
export function ProjectChatButton({ groupId, unread = 0, className, label = "Chat" }: { groupId: string; unread?: number; className?: string; label?: string }) {
  return (
    <button type="button" onClick={() => openChatGroup(groupId)} data-testid="project-chat-button" aria-label={unread > 0 ? `Open project chat, ${unread} unread` : "Open project chat"}
      className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <MessageCircle className="h-4 w-4" aria-hidden /> {label}
      {unread > 0 ? <span className="rounded-full bg-accent px-1.5 text-[12px] font-semibold text-accent-foreground">{unread > 99 ? "99+" : unread}</span> : null}
    </button>
  );
}
