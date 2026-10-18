import { redirect } from "next/navigation";

export default function OsPreviewIndex() {
  redirect("/os-preview/my-day?role=sales");
}
