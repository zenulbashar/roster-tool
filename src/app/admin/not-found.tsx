import { NotFoundState } from "@/components/NotFoundState";

/** Admin-console 404 (e.g. an unknown client id) — inside the indigo chrome. */
export default function AdminNotFound() {
  return (
    <NotFoundState
      title="No such client or page"
      description="The client may have been removed, or the link is out of date."
      homeHref="/admin/clients"
      homeLabel="Back to clients"
    />
  );
}
