import { requireAdmin } from "@/lib/admin/context";
import { createAdminRepo } from "@/lib/admin/repository";
import { listFlagStatuses, type FlagStatusRow } from "@/lib/flags";
import {
  setFeatureFlagGlobal,
  setFeatureFlagOverride,
} from "@/app/admin/actions";
import { Card, Badge, Banner } from "@/components/ui";
import { formatDateTime, DEFAULT_TIMEZONE } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Feature flags (OPS-05) — the Zale IT rollout console. Every flag the code
 * declares (src/lib/flags/registry.ts) is listed with its code default, the
 * value everyone currently gets and where that value comes from, plus the
 * per-client overrides. Flags control CODE PATHS (dark-launch, canary, kill
 * switch) — never a client's product configuration.
 */
export default async function AdminFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const [flags, clients] = await Promise.all([
    listFlagStatuses(),
    createAdminRepo().listClients(),
  ]);

  return (
    <div>
      <header className="mb-[18px]">
        <h1 className="font-archivo text-[25px] font-extrabold tracking-[-0.015em] text-[var(--color-text)]">
          Feature flags
        </h1>
        <p className="mt-1.5 max-w-[720px] text-[13.5px] text-[var(--color-text-secondary)]">
          Turn code paths on or off without a deploy. A client override wins
          over the setting for everyone, and both win over the code default. Use
          these to trial a change on one client, roll it out to all, or switch
          off something that misbehaves. Every change is logged.
        </p>
      </header>

      {sp.error === "unknown_org" ? (
        <div className="mb-4">
          <Banner tone="error">
            That client no longer exists — the override was not saved.
          </Banner>
        </div>
      ) : null}

      <div className="space-y-4">
        {flags.map((flag) => (
          <FlagCard key={flag.key} flag={flag} clients={clients} />
        ))}
      </div>
    </div>
  );
}

function FlagCard({
  flag,
  clients,
}: {
  flag: FlagStatusRow;
  clients: Array<{ orgId: string; name: string }>;
}) {
  const overridden = new Set(flag.overrides.map((o) => o.orgId));
  const candidates = clients.filter((c) => !overridden.has(c.orgId));
  const sourceLabel =
    flag.source === "global"
      ? `set for everyone${flag.global?.updatedBy ? ` by ${flag.global.updatedBy}` : ""}${
          flag.global
            ? ` · ${formatDateTime(flag.global.updatedAt, DEFAULT_TIMEZONE)}`
            : ""
        }`
      : "code default";

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-[18px] py-[14px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[14px] font-bold text-[var(--color-text)]">
              {flag.key}
            </h2>
            <Badge tone={flag.effective ? "success" : "draft"}>
              {flag.effective ? "On" : "Off"} for everyone
            </Badge>
            {flag.overrides.length > 0 ? (
              <Badge tone="info">
                {flag.overrides.length} client override
                {flag.overrides.length === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1.5 max-w-[680px] text-[13px] text-[var(--color-text-secondary)]">
            {flag.description}
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
            Currently {flag.effective ? "on" : "off"} ({sourceLabel}). Code
            default: {flag.defaultEnabled ? "on" : "off"}.
          </p>
        </div>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={`Set ${flag.key} for everyone`}
        >
          <GlobalButton
            flagKey={flag.key}
            value="default"
            active={flag.source === "default"}
            label={`Code default (${flag.defaultEnabled ? "on" : "off"})`}
          />
          <GlobalButton
            flagKey={flag.key}
            value="on"
            active={flag.source === "global" && flag.effective}
            label="On for everyone"
          />
          <GlobalButton
            flagKey={flag.key}
            value="off"
            active={flag.source === "global" && !flag.effective}
            label="Off for everyone"
          />
        </div>
      </div>

      <div className="px-[18px] py-[14px]">
        <h3 className="font-archivo text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--color-text-muted)]">
          Client overrides
        </h3>
        {flag.overrides.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--color-text-muted)]">
            No client overrides — every client gets the value above.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[#F3F4F6]">
            {flag.overrides.map((o) => (
              <li
                key={o.orgId}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <Badge tone={o.enabled ? "success" : "danger"}>
                    {o.enabled ? "On" : "Off"}
                  </Badge>
                  <span className="text-[13.5px] font-semibold text-[var(--color-text)]">
                    {o.orgName}
                  </span>
                  <span className="text-[12px] text-[var(--color-text-muted)]">
                    {o.updatedBy ? `${o.updatedBy} · ` : ""}
                    {formatDateTime(o.updatedAt, DEFAULT_TIMEZONE)}
                  </span>
                </div>
                <form action={setFeatureFlagOverride}>
                  <input type="hidden" name="key" value={flag.key} />
                  <input type="hidden" name="orgId" value={o.orgId} />
                  <input type="hidden" name="value" value="clear" />
                  <button
                    type="submit"
                    className="rounded-[8px] border border-[var(--color-border)] bg-white px-[12px] py-[7px] text-[12.5px] font-semibold text-[#374151] hover:border-[#312E81] hover:text-[#312E81]"
                  >
                    Remove override
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {candidates.length > 0 ? (
          <form
            action={setFeatureFlagOverride}
            className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--color-border-subtle)] pt-3"
          >
            <input type="hidden" name="key" value={flag.key} />
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-text-secondary)]">
              Client
              <select
                name="orgId"
                required
                className="min-w-[220px] rounded-[8px] border border-[var(--color-border)] bg-white px-[10px] py-[7px] text-[13px] font-normal text-[var(--color-text)]"
              >
                {candidates.map((c) => (
                  <option key={c.orgId} value={c.orgId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-text-secondary)]">
              Value
              <select
                name="value"
                defaultValue={flag.effective ? "off" : "on"}
                className="rounded-[8px] border border-[var(--color-border)] bg-white px-[10px] py-[7px] text-[13px] font-normal text-[var(--color-text)]"
              >
                <option value="on">On for this client</option>
                <option value="off">Off for this client</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-[8px] bg-[#312E81] px-[14px] py-[8px] text-[12.5px] font-semibold text-white hover:bg-[#3730A3]"
            >
              Add override
            </button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

function GlobalButton({
  flagKey,
  value,
  active,
  label,
}: {
  flagKey: string;
  value: "on" | "off" | "default";
  active: boolean;
  label: string;
}) {
  return (
    <form action={setFeatureFlagGlobal}>
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="value" value={value} />
      <button
        type="submit"
        disabled={active}
        aria-pressed={active}
        className={`rounded-[8px] border px-[12px] py-[7px] text-[12.5px] font-semibold transition-colors ${
          active
            ? "cursor-default border-[#312E81] bg-[#312E81] text-white"
            : "border-[var(--color-border)] bg-white text-[#374151] hover:border-[#312E81] hover:text-[#312E81]"
        }`}
      >
        {label}
      </button>
    </form>
  );
}
