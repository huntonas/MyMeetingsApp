import { ADMIN_NOTICES, isAdminNotice } from "@/server/admin/notices";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The outcome an admin action redirected back with. An unknown code shows nothing.
export function Notice({ params }: { params: Record<string, string | string[] | undefined> }) {
  const code = params.notice;
  if (!isAdminNotice(code)) return null;
  return (
    <p className="notice" role="status">
      {ADMIN_NOTICES[code]}
    </p>
  );
}
