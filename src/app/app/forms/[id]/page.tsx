import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { ownerRepo } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { formSaveSchema, type FormFieldTypeInput } from "@/lib/validation";
import { Banner, Button, Card, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";
import {
  FormEditor,
  type FormEditorField,
  type SaveFormState,
} from "@/components/FormEditor";

const PATH = "/app/forms";

/** Map a persisted field row to the editor/save exchange shape. */
function toEditorField(f: {
  id: string;
  label: string;
  type: FormFieldTypeInput;
  required: boolean;
  options: { id: string; label: string }[] | null;
}): FormEditorField {
  return {
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })),
  };
}

export default async function FormEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    published?: string;
    closed?: string;
    error?: string;
    staffOn?: string;
    staffOff?: string;
    anonError?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const repo = await ownerRepo();
  const data = await repo.getFormWithFields(id);
  if (!data) {
    redirect(
      `${PATH}?error=${encodeURIComponent("That form could not be found.")}`,
    );
  }

  const [responseCount, internalResponseCount] = await Promise.all([
    repo.countResponses(id),
    repo.countInternalResponses(id),
  ]);
  const status = data.form.status;
  const isPublished = status === "published";
  const internalEnabled = data.form.internalEnabled;
  const allowAnonymous = data.form.allowAnonymous;
  // Anonymity is frozen once staff have responded (mirrors the repo guard).
  const anonymityFrozen = internalResponseCount > 0;
  // Fields are frozen while collecting from EITHER channel.
  const fieldsLocked = isPublished || internalEnabled;
  const publicUrl =
    data.form.publicSlug !== null
      ? `${env.APP_URL}/f/${data.form.publicSlug}`
      : null;
  // QR is just the public URL as an image (no separate channel/route).
  const qrDataUrl =
    isPublished && publicUrl
      ? await QRCode.toDataURL(publicUrl, { width: 220, margin: 1 })
      : null;

  async function save(
    _prev: SaveFormState,
    formData: FormData,
  ): Promise<SaveFormState> {
    "use server";
    const repo = await ownerRepo();
    let json: unknown;
    try {
      json = JSON.parse(String(formData.get("payload") ?? ""));
    } catch {
      return {
        status: "error",
        message: "Could not read the form. Please try again.",
      };
    }
    const parsed = formSaveSchema.safeParse(json);
    if (!parsed.success) {
      return {
        status: "error",
        message: parsed.error.issues[0]?.message ?? "Please check the form.",
      };
    }
    const saved = await repo.saveForm(id, parsed.data);
    if (!saved.ok) {
      return {
        status: "error",
        message:
          saved.reason === "locked"
            ? saved.message
            : "This form could not be found.",
      };
    }
    revalidatePath(PATH);
    revalidatePath(`${PATH}/${id}`);
    return {
      status: "success",
      message: "Saved.",
      title: saved.form.title,
      description: saved.form.description ?? "",
      fields: saved.fields.map(toEditorField),
    };
  }

  async function publish() {
    "use server";
    const repo = await ownerRepo();
    const result = await repo.publishForm(id);
    if (!result) {
      redirect(`${PATH}?error=${encodeURIComponent("Form not found")}`);
    }
    revalidatePath(`${PATH}/${id}`);
    redirect(`${PATH}/${id}?published=1`);
  }

  async function close() {
    "use server";
    const repo = await ownerRepo();
    await repo.closeForm(id);
    revalidatePath(`${PATH}/${id}`);
    redirect(`${PATH}/${id}?closed=1`);
  }

  // Toggle staff access. The desired value is server-decided from a hidden flag
  // (no trust issue — owner-authenticated, scoped). Turning it on freezes the
  // fields; turning it off lets the owner edit again.
  async function setStaffAccess(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const enabled = formData.get("enabled") === "1";
    await repo.setFormInternalEnabled(id, enabled);
    revalidatePath(`${PATH}/${id}`);
    redirect(`${PATH}/${id}?${enabled ? "staffOn" : "staffOff"}=1`);
  }

  // Toggle anonymity for staff responses. Refused once internal responses exist
  // (the anonymity guarantee can't change under collected data).
  async function setAnonymous(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const anonymous = formData.get("anonymous") === "1";
    const result = await repo.setFormAllowAnonymous(id, anonymous);
    revalidatePath(`${PATH}/${id}`);
    if (!result.ok && result.reason === "locked") {
      redirect(
        `${PATH}/${id}?anonError=${encodeURIComponent(
          "Anonymity can't be changed once staff have responded.",
        )}`,
      );
    }
    redirect(`${PATH}/${id}`);
  }

  return (
    <>
      <PageHeader
        title="Edit form"
        subtitle="Add the questions you want to ask, then publish to share a link or QR code."
      />

      {sp.published ? (
        <Banner tone="success">Form published — share the link below.</Banner>
      ) : null}
      {sp.closed ? (
        <Banner tone="success">
          Form closed — it no longer accepts responses.
        </Banner>
      ) : null}
      {sp.staffOn ? (
        <Banner tone="success">
          Staff access on — your team can fill this form from their notices
          page.
        </Banner>
      ) : null}
      {sp.staffOff ? (
        <Banner tone="success">
          Staff access off — your team can no longer fill this form.
        </Banner>
      ) : null}
      {sp.anonError ? <Banner tone="warn">{sp.anonError}</Banner> : null}
      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Sharing</h2>
            <p className="text-sm text-[var(--color-muted)]">
              Status:{" "}
              <span className="font-semibold">
                {status === "published"
                  ? "Published"
                  : status === "closed"
                    ? "Closed"
                    : "Draft"}
              </span>
              {responseCount > 0 ? (
                <>
                  {" · "}
                  <Link
                    href={`${PATH}/${id}/responses`}
                    className="font-medium text-[var(--color-brand)] underline underline-offset-2"
                  >
                    {responseCount} response{responseCount === 1 ? "" : "s"}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPublished ? (
              <form action={close}>
                <Button type="submit" variant="secondary">
                  Unpublish (close)
                </Button>
              </form>
            ) : (
              <form action={publish}>
                <Button type="submit">
                  {status === "closed" ? "Re-publish" : "Publish"}
                </Button>
              </form>
            )}
          </div>
        </div>

        {isPublished && publicUrl ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-[var(--color-muted)]">
              Anyone with this link can fill in the form. Print the QR code for
              a table or counter.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <code className="break-all rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm">
                {publicUrl}
              </code>
              <CopyButton value={publicUrl} />
            </div>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt="QR code linking to the public form"
                width={220}
                height={220}
                className="rounded-lg border border-[var(--color-line)] bg-white p-2"
              />
            ) : null}
          </div>
        ) : null}

        {fieldsLocked ? (
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            {isPublished
              ? "This form is published, so its fields are locked. Unpublishing only stops new responses — your collected responses are kept, and the link and QR code stay the same when you re-publish."
              : "This form is shared with staff, so its fields are locked. Turn off staff access to change its questions — collected responses are always kept."}
          </p>
        ) : null}
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Staff access</h2>
            <p className="text-sm text-[var(--color-muted)]">
              Let your team fill this form from their private notices page (the
              link you share with each staff member). This is separate from the
              public link above — a form can be staff-only, public-only, or
              both.
            </p>
          </div>
          <form action={setStaffAccess}>
            <input
              type="hidden"
              name="enabled"
              value={internalEnabled ? "0" : "1"}
            />
            <Button
              type="submit"
              variant={internalEnabled ? "secondary" : "primary"}
            >
              {internalEnabled ? "Turn off staff access" : "Share with staff"}
            </Button>
          </form>
        </div>

        <div className="mt-4 rounded-lg border border-[var(--color-line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {allowAnonymous
                  ? "Responses are anonymous"
                  : "Responses are linked to each staff member"}
              </p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                {allowAnonymous
                  ? "Anonymous: responses are NOT attributable to a person — nothing links a response back to who sent it. Each person can submit more than once."
                  : "Attributed: you'll see who sent each response, and each person can respond once."}
              </p>
            </div>
            {anonymityFrozen ? (
              <span className="text-sm text-[var(--color-muted)]">
                Locked — staff have responded
              </span>
            ) : (
              <form action={setAnonymous}>
                <input
                  type="hidden"
                  name="anonymous"
                  value={allowAnonymous ? "0" : "1"}
                />
                <Button type="submit" variant="secondary">
                  {allowAnonymous ? "Make attributed" : "Make anonymous"}
                </Button>
              </form>
            )}
          </div>
          {anonymityFrozen ? (
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Anonymity can&rsquo;t be changed once staff have responded — it
              would change how already-collected responses are treated.
            </p>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Choose before staff start responding. Switching to anonymous
              can&rsquo;t be undone for responses already collected.
            </p>
          )}
        </div>
      </Card>

      <div className="mt-6">
        <FormEditor
          action={save}
          initialTitle={data.form.title}
          initialDescription={data.form.description ?? ""}
          initialFields={data.fields.map(toEditorField)}
          listHref={PATH}
          locked={fieldsLocked}
        />
      </div>
    </>
  );
}
