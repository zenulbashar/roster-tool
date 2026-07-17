import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ownerRepo } from "@/lib/auth/context";
import { templateSchema } from "@/lib/validation";
import { formatTimeRange } from "@/lib/time";
import { resolveShiftColors, SHIFT_PALETTE } from "@/lib/shift-colors";
import {
  Banner,
  Button,
  ButtonLink,
  Card,
  Field,
  Icon,
  PageHeader,
  TextInput,
} from "@/components/ui";

const PATH = "/app/templates";

const WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

function summariseDays(weekdays: number[]): string {
  if (weekdays.length === 7) return "Every day";
  return WEEKDAYS.filter((d) => weekdays.includes(d.n))
    .map((d) => d.label)
    .join(", ");
}

/** "HH:MM:SS" (or "HH:MM") → "HH:MM" for a <input type="time"> value. */
function timeInputValue(t: string): string {
  return t.slice(0, 5);
}

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const WEEKDAY_LABEL: Record<string, string> = Object.fromEntries(
  WEEKDAYS.map((d) => [String(d.n), d.label]),
);

type DayTimes = Record<string, { start: string; end: string }>;

/**
 * Gather per-day time overrides from the form, only for the days the type
 * actually runs (unselected days are ignored) and only where BOTH a start and
 * end were entered. Returns null when there are none.
 */
function collectOverrides(
  formData: FormData,
  weekdays: number[],
): DayTimes | null {
  const wdSet = new Set(weekdays);
  const out: DayTimes = {};
  for (const wd of ISO_WEEKDAYS) {
    if (!wdSet.has(wd)) continue;
    const start = String(formData.get(`override_start_${wd}`) ?? "").trim();
    const end = String(formData.get(`override_end_${wd}`) ?? "").trim();
    if (start && end) out[String(wd)] = { start, end };
  }
  return Object.keys(out).length ? out : null;
}

/** Drop overrides that match the default time (they'd resolve identically). */
function pruneToDifferences(
  overrides: DayTimes | null | undefined,
  defStart: string,
  defEnd: string,
): DayTimes | null {
  if (!overrides) return null;
  const kept = Object.fromEntries(
    Object.entries(overrides).filter(
      ([, v]) => v.start !== defStart || v.end !== defEnd,
    ),
  );
  return Object.keys(kept).length ? kept : null;
}

type DayStaff = Record<string, number>;

/**
 * Gather per-day STAFFING overrides from the form, only for the days the type
 * runs and only where a number was entered. Returns null when there are none.
 */
function collectStaffOverrides(
  formData: FormData,
  weekdays: number[],
): DayStaff | null {
  const wdSet = new Set(weekdays);
  const out: DayStaff = {};
  for (const wd of ISO_WEEKDAYS) {
    if (!wdSet.has(wd)) continue;
    const raw = String(formData.get(`override_staff_${wd}`) ?? "").trim();
    if (raw) out[String(wd)] = Number(raw);
  }
  return Object.keys(out).length ? out : null;
}

/** Drop staffing overrides equal to the default (they'd resolve identically). */
function pruneStaffToDefault(
  overrides: DayStaff | null | undefined,
  defaultStaff: number,
): DayStaff | null {
  if (!overrides) return null;
  const kept = Object.fromEntries(
    Object.entries(overrides).filter(([, n]) => n !== defaultStaff),
  );
  return Object.keys(kept).length ? kept : null;
}

/**
 * Optional per-day staffing inputs ("Friday needs 4"). A day left blank uses
 * the type's default staff count; only the days that differ are stored. Opens
 * automatically when the type already has overrides (edit form).
 */
function DayStaffOverrides({ overrides }: { overrides?: DayStaff | null }) {
  const has = overrides != null && Object.keys(overrides).length > 0;
  return (
    <details open={has} className="rounded-[9px] bg-[var(--color-bg)] p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-[#2E7D4E]">
        More staff on some days?
      </summary>
      <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
        Leave a day blank to use the staff count above. Only days this type runs
        are used.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {WEEKDAYS.map((d) => (
          <label
            key={d.n}
            className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)]"
          >
            {d.label}
            <input
              type="number"
              name={`override_staff_${d.n}`}
              min={1}
              max={20}
              defaultValue={overrides?.[String(d.n)] ?? ""}
              aria-label={`${d.label} staff needed`}
              className="w-[54px] rounded-[8px] border border-[var(--color-line)] px-2 py-1.5 text-[13px]"
            />
          </label>
        ))}
      </div>
    </details>
  );
}

/**
 * Optional per-day start/end inputs. Each day left blank uses the type's
 * default time; only the days that differ are stored. Opens automatically when
 * the type already has overrides (edit form).
 */
function DayTimeOverrides({ overrides }: { overrides?: DayTimes | null }) {
  const has = overrides != null && Object.keys(overrides).length > 0;
  return (
    <details open={has} className="rounded-[9px] bg-[var(--color-bg)] p-3">
      <summary className="cursor-pointer text-[13px] font-semibold text-[#2E7D4E]">
        Different times on some days?
      </summary>
      <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
        Leave a day blank to use the default time above. Only days this type
        runs are used.
      </p>
      <div className="mt-2 space-y-1.5">
        {WEEKDAYS.map((d) => {
          const o = overrides?.[String(d.n)];
          return (
            <div key={d.n} className="flex items-center gap-2">
              <span className="w-9 text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
                {d.label}
              </span>
              <input
                type="time"
                name={`override_start_${d.n}`}
                defaultValue={o?.start ?? ""}
                aria-label={`${d.label} start time`}
                className="rounded-[8px] border border-[var(--color-line)] px-2 py-1.5 text-[13px]"
              />
              <span className="text-[var(--color-text-muted)]">–</span>
              <input
                type="time"
                name={`override_end_${d.n}`}
                defaultValue={o?.end ?? ""}
                aria-label={`${d.label} end time`}
                className="rounded-[8px] border border-[var(--color-line)] px-2 py-1.5 text-[13px]"
              />
            </div>
          );
        })}
      </div>
    </details>
  );
}

/**
 * Palette radio picker used on the add + edit forms. "Auto" (empty value) keeps
 * the keyword-derived colour; any swatch stores that bar hex on the type.
 */
function ColorPicker({ current }: { current?: string | null }) {
  const sel = (current ?? "").toLowerCase();
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-semibold">Colour</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer" title="Auto — from the name">
          <input
            type="radio"
            name="color"
            value=""
            defaultChecked={sel === ""}
            className="peer sr-only"
            aria-label="Automatic colour from the name"
          />
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border border-[var(--color-line)] bg-white text-[var(--color-muted)] peer-checked:ring-2 peer-checked:ring-[var(--color-ink)] peer-checked:ring-offset-1">
            <Icon name="auto_awesome" className="text-[16px]" />
          </span>
        </label>
        {SHIFT_PALETTE.map((p) => (
          <label key={p.bar} className="cursor-pointer" title={p.name}>
            <input
              type="radio"
              name="color"
              value={p.bar}
              defaultChecked={sel === p.bar.toLowerCase()}
              className="peer sr-only"
              aria-label={p.name}
            />
            <span
              className="block h-[30px] w-[30px] rounded-[8px] border border-black/5 peer-checked:ring-2 peer-checked:ring-[var(--color-ink)] peer-checked:ring-offset-1"
              style={{ background: p.bar }}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    saved?: string;
    deleted?: string;
    confirmDelete?: string;
  }>;
}) {
  const sp = await searchParams;
  const repo = await ownerRepo();
  const templates = await repo.listTemplates();

  // A delete awaiting confirmation.
  const pendingDelete =
    templates.find((t) => t.id === sp.confirmDelete) ?? null;

  async function addTemplate(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const weekdays = formData.getAll("weekdays").map((v) => Number(v));
    const parsed = templateSchema.safeParse({
      label: formData.get("label"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      weekdays,
      color: formData.get("color"),
      dayTimeOverrides: collectOverrides(formData, weekdays),
      requiredStaff: formData.get("requiredStaff") ?? 1,
      dayStaffOverrides: collectStaffOverrides(formData, weekdays),
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    await repo.addTemplate({
      ...parsed.data,
      dayTimeOverrides: pruneToDifferences(
        parsed.data.dayTimeOverrides,
        parsed.data.startTime,
        parsed.data.endTime,
      ),
      dayStaffOverrides: pruneStaffToDefault(
        parsed.data.dayStaffOverrides,
        parsed.data.requiredStaff,
      ),
    });
    revalidatePath(PATH);
    redirect(`${PATH}?added=1`);
  }

  async function editTemplate(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const weekdays = formData.getAll("weekdays").map((v) => Number(v));
    const parsed = templateSchema.safeParse({
      label: formData.get("label"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      weekdays,
      color: formData.get("color"),
      dayTimeOverrides: collectOverrides(formData, weekdays),
      requiredStaff: formData.get("requiredStaff") ?? 1,
      dayStaffOverrides: collectStaffOverrides(formData, weekdays),
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? "Please check the form";
      redirect(`${PATH}?error=${encodeURIComponent(msg)}`);
    }
    const updated = await repo.updateTemplate(id, {
      ...parsed.data,
      // Always write the (possibly null) maps so removing overrides sticks.
      dayTimeOverrides: pruneToDifferences(
        parsed.data.dayTimeOverrides,
        parsed.data.startTime,
        parsed.data.endTime,
      ),
      dayStaffOverrides: pruneStaffToDefault(
        parsed.data.dayStaffOverrides,
        parsed.data.requiredStaff,
      ),
    });
    if (!updated)
      redirect(`${PATH}?error=${encodeURIComponent("Shift type not found")}`);
    revalidatePath(PATH);
    redirect(`${PATH}?saved=1`);
  }

  async function toggleActive(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const active = formData.get("active") === "true";
    await repo.updateTemplate(id, { active: !active });
    revalidatePath(PATH);
  }

  async function deleteTemplate(formData: FormData) {
    "use server";
    const repo = await ownerRepo();
    const id = String(formData.get("id"));
    const confirmed = formData.get("confirmed") === "1";
    // Always confirm a delete. It's non-destructive to past rosters (their
    // shifts unlink via set-null), but removing a type is still deliberate.
    if (!confirmed) redirect(`${PATH}?confirmDelete=${id}`);
    await repo.deleteTemplate(id);
    revalidatePath(PATH);
    redirect(`${PATH}?deleted=1`);
  }

  return (
    <>
      <PageHeader
        title="Shift types"
        subtitle="Reusable templates with set times and a colour. Drop them onto the roster grid."
        action={
          <ButtonLink href="#add-form" variant="primary">
            <Icon name="add" className="text-[19px]" />
            Add shift type
          </ButtonLink>
        }
      />

      {sp.error ? <Banner tone="warn">{sp.error}</Banner> : null}
      {sp.added ? <Banner tone="success">Shift type added.</Banner> : null}
      {sp.saved ? <Banner tone="success">Shift type updated.</Banner> : null}
      {sp.deleted ? <Banner tone="success">Shift type deleted.</Banner> : null}

      {pendingDelete ? (
        <Card className="mt-4 border-[var(--color-danger)]">
          <h2 className="font-archivo text-[17px] font-bold text-[var(--color-text)]">
            Delete “{pendingDelete.label}”?
          </h2>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-secondary)]">
            Past and published rosters keep their shifts — they just stop being
            linked to this type. You won’t be able to add “{pendingDelete.label}
            ” to new rosters. This can’t be undone.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <form action={deleteTemplate}>
              <input type="hidden" name="id" value={pendingDelete.id} />
              <input type="hidden" name="confirmed" value="1" />
              <Button type="submit" variant="danger">
                Delete shift type
              </Button>
            </form>
            <Link
              href={PATH}
              className="text-[13px] font-semibold text-[var(--color-text-secondary)] hover:underline"
            >
              Cancel
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const scheme = resolveShiftColors(t.color, t.label);
          return (
            <div
              key={t.id}
              className={`overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] ${
                t.active ? "" : "opacity-70"
              }`}
            >
              <div
                className="h-2"
                style={{ background: scheme.bar }}
                aria-hidden="true"
              />
              <div className="p-[18px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-3.5 w-3.5 flex-shrink-0 rounded-[5px]"
                      style={{ background: scheme.bar }}
                      aria-hidden="true"
                    />
                    <span className="font-archivo text-[16px] font-bold text-[var(--color-text)]">
                      {t.label}
                    </span>
                    {!t.active ? (
                      <span className="rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-muted)]">
                        Off
                      </span>
                    ) : null}
                  </div>
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-[12.5px] font-semibold text-[#2E7D4E] [&::-webkit-details-marker]:hidden">
                      <Icon name="edit" className="text-[16px]" />
                      Edit
                    </summary>
                    <form action={editTemplate} className="mt-3 space-y-3">
                      <input type="hidden" name="id" value={t.id} />
                      <Field label="Name">
                        <TextInput
                          name="label"
                          required
                          defaultValue={t.label}
                        />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Starts">
                          <TextInput
                            type="time"
                            name="startTime"
                            required
                            defaultValue={timeInputValue(t.startTime)}
                          />
                        </Field>
                        <Field label="Ends">
                          <TextInput
                            type="time"
                            name="endTime"
                            required
                            defaultValue={timeInputValue(t.endTime)}
                          />
                        </Field>
                      </div>
                      <p className="-mt-1 text-[12px] text-[var(--color-text-muted)]">
                        Finishes at or before it starts? The shift runs into the
                        next day (e.g. 6 pm – 2 am).
                      </p>
                      <Field label="How many staff on this shift?">
                        <TextInput
                          type="number"
                          name="requiredStaff"
                          min={1}
                          max={20}
                          required
                          defaultValue={String(t.requiredStaff)}
                        />
                      </Field>
                      <DayStaffOverrides overrides={t.dayStaffOverrides} />
                      <fieldset>
                        <legend className="mb-1 block text-sm font-semibold">
                          Which days?
                        </legend>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAYS.map((d) => (
                            <label
                              key={d.n}
                              className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[13px] has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-blue-50"
                            >
                              <input
                                type="checkbox"
                                name="weekdays"
                                value={d.n}
                                defaultChecked={t.weekdays.includes(d.n)}
                                className="h-4 w-4"
                              />
                              {d.label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <ColorPicker current={t.color} />
                      <DayTimeOverrides overrides={t.dayTimeOverrides} />
                      <Button type="submit" variant="secondary">
                        Save changes
                      </Button>
                    </form>

                    <div className="mt-3 flex items-center gap-3 border-t border-[var(--color-border-subtle)] pt-3">
                      <form action={toggleActive}>
                        <input type="hidden" name="id" value={t.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={String(t.active)}
                        />
                        <Button type="submit" variant="ghost">
                          {t.active ? "Turn off" : "Turn on"}
                        </Button>
                      </form>
                      <form action={deleteTemplate}>
                        <input type="hidden" name="id" value={t.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#B91C1C] hover:underline"
                        >
                          <Icon name="delete" className="text-[16px]" />
                          Delete
                        </button>
                      </form>
                    </div>
                  </details>
                </div>

                <div
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-[11px] py-[7px]"
                  style={{ background: scheme.bg }}
                >
                  <Icon
                    name="schedule"
                    className="text-[17px] text-[var(--color-muted)]"
                  />
                  <span className="font-archivo text-[13.5px] font-semibold text-[#374151]">
                    {formatTimeRange(t.startTime, t.endTime)}
                  </span>
                </div>

                <div className="mt-3 text-[12px] text-[#9CA3AF]">
                  {summariseDays(t.weekdays)}
                  {t.requiredStaff > 1 ? (
                    <span className="ml-2 rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                      {t.requiredStaff} staff each
                    </span>
                  ) : null}
                </div>

                {t.dayStaffOverrides &&
                Object.keys(t.dayStaffOverrides).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(t.dayStaffOverrides)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([wd, n]) => (
                        <span
                          key={wd}
                          className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
                          title="Different staffing on this day"
                        >
                          {WEEKDAY_LABEL[wd] ?? wd} ×{n} staff
                        </span>
                      ))}
                  </div>
                ) : null}

                {t.dayTimeOverrides &&
                Object.keys(t.dayTimeOverrides).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(t.dayTimeOverrides)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([wd, o]) => (
                        <span
                          key={wd}
                          className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
                          title="Different time on this day"
                        >
                          {WEEKDAY_LABEL[wd] ?? wd}{" "}
                          {formatTimeRange(o.start, o.end)}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        <a
          href="#add-form"
          className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border-[1.5px] border-dashed border-[#D1D5DB] bg-[#FAFBFC] p-[18px] text-left transition-colors hover:border-[#13301F] hover:bg-[#ECF3EE]"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-[#ECF3EE]">
              <Icon name="add" className="text-[20px] text-[#2E7D4E]" />
            </span>
            <span className="font-archivo text-[15px] font-bold text-[var(--color-text)]">
              New shift type
            </span>
          </div>
          <div className="text-[12.5px] text-[var(--color-text-secondary)]">
            Pick a name, times and colour
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            {SHIFT_PALETTE.map((p) => (
              <span
                key={p.bar}
                className="h-[18px] w-[18px] rounded-[5px]"
                style={{ background: p.bar }}
              />
            ))}
          </div>
        </a>
      </div>

      <div id="add-form" className="scroll-mt-6" />
      <Card className="mt-8">
        <h2 className="font-archivo text-lg font-bold text-[var(--color-text)]">
          Add a shift type
        </h2>
        <form action={addTemplate} className="mt-3 space-y-4">
          <Field label="Name">
            <TextInput name="label" required placeholder="e.g. Morning" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Starts">
              <TextInput
                type="time"
                name="startTime"
                required
                defaultValue="09:00"
              />
            </Field>
            <Field label="Ends">
              <TextInput
                type="time"
                name="endTime"
                required
                defaultValue="17:00"
              />
            </Field>
          </div>
          <p className="-mt-2 text-[12px] text-[var(--color-text-muted)]">
            Finishes at or before it starts? The shift runs into the next day
            (e.g. 6 pm – 2 am).
          </p>
          <Field label="How many staff on this shift?">
            <TextInput
              type="number"
              name="requiredStaff"
              min={1}
              max={20}
              required
              defaultValue="1"
            />
          </Field>
          <DayStaffOverrides />
          <fieldset>
            <legend className="mb-1 block text-sm font-semibold">
              Which days?
            </legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label
                  key={d.n}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-blue-50"
                >
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={d.n}
                    defaultChecked
                    className="h-4 w-4"
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          <ColorPicker />
          <DayTimeOverrides />
          <Button type="submit">Add shift type</Button>
        </form>
      </Card>
    </>
  );
}
