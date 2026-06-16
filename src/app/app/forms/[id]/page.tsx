import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ownerRepo } from "@/lib/auth/context";
import { formSaveSchema, type FormFieldTypeInput } from "@/lib/validation";
import { PageHeader } from "@/components/ui";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const repo = await ownerRepo();
  const data = await repo.getFormWithFields(id);
  if (!data) {
    redirect(
      `${PATH}?error=${encodeURIComponent("That form could not be found.")}`,
    );
  }

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

  return (
    <>
      <PageHeader
        title="Edit form"
        subtitle="Add the questions you want to ask. Saved as a draft — nothing is published yet."
      />
      <FormEditor
        action={save}
        initialTitle={data.form.title}
        initialDescription={data.form.description ?? ""}
        initialFields={data.fields.map(toEditorField)}
        listHref={PATH}
      />
    </>
  );
}
