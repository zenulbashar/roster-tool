import { notFound } from "next/navigation";
import { findPublishedFormBySlug } from "@/lib/tenant/public-access";
import { createTenantRepo } from "@/lib/tenant/repository";
import { env } from "@/lib/env";
import { PublicFormFill } from "@/components/PublicFormFill";
import { submitPublicForm } from "./actions";

/**
 * PUBLIC, unauthenticated form-fill page. Lives OUTSIDE /app (root layout, no
 * owner session, no nav). The slug is the only identifier; a draft/closed/
 * unknown slug 404s. Only the SAFE field shape is passed to the client — never
 * raw rows (which carry business_id / public_slug).
 */
export const dynamic = "force-dynamic";

export default async function PublicFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const resolved = await findPublishedFormBySlug(slug);
  if (!resolved) notFound();

  const repo = createTenantRepo(resolved.businessId);
  const data = await repo.getFormWithFields(resolved.formId);
  if (!data) notFound();

  const fields = data.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
  }));

  return (
    <main id="main" className="mx-auto max-w-md px-5 py-10">
      <PublicFormFill
        slug={slug}
        title={data.form.title}
        description={data.form.description}
        fields={fields}
        action={submitPublicForm}
        turnstileSiteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null}
        source={typeof sp.src === "string" ? sp.src : null}
      />
    </main>
  );
}
