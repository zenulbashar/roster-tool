import { describe, it, expect, vi } from "vitest";
import { processInternalSubmission } from "@/lib/internal-form-submission";
import type { SubmissionField } from "@/lib/form-submission";

/**
 * Pure coverage of the INTERNAL (staff) submission core. Proves it reuses the
 * public validator's rules, passes the SERVER-RESOLVED respondent (null when
 * anonymous), and only consults the per-form rate limiter on the anonymous path.
 * The repo + rate limiter are stubbed so each branch is deterministic.
 */
describe("processInternalSubmission", () => {
  const fields: SubmissionField[] = [
    {
      id: "f-name",
      label: "Name",
      type: "short_text",
      required: true,
      options: [],
    },
    {
      id: "f-size",
      label: "Size",
      type: "single_select",
      required: false,
      options: [
        { id: "o-s", label: "Small" },
        { id: "o-l", label: "Large" },
      ],
    },
    {
      id: "f-stars",
      label: "Stars",
      type: "rating",
      required: false,
      options: [],
    },
  ];

  type CreateArgs = Parameters<
    import("@/lib/tenant/repository").TenantRepo["createInternalResponse"]
  >;

  function repoStub() {
    return {
      createInternalResponse: vi.fn(
        async (..._args: CreateArgs) =>
          ({ ok: true, responseId: "resp-1" }) as const,
      ),
    };
  }

  const alwaysAllow = {
    consumeAnonRateLimit: vi.fn(async () => true),
    notifyResponse: vi.fn(async () => {}),
  };

  it("attributed: passes the session staff id as respondent, no rate limit", async () => {
    const repo = repoStub();
    const io = {
      consumeAnonRateLimit: vi.fn(async () => true),
      notifyResponse: vi.fn(async () => {}),
    };
    const out = await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada" },
        anonymous: false,
        staffMemberId: "staff-1",
        source: "internal",
      },
      io,
    );
    expect(out).toEqual({ status: "ok", responseId: "resp-1" });
    // Attributed path never touches the anon limiter.
    expect(io.consumeAnonRateLimit).not.toHaveBeenCalled();
    expect(repo.createInternalResponse).toHaveBeenCalledWith("form-1", {
      respondentStaffId: "staff-1",
      source: "internal",
      answers: [
        {
          fieldId: "f-name",
          fieldLabel: "Name",
          fieldType: "short_text",
          valueText: "Ada",
          valueNumber: null,
        },
      ],
    });
  });

  it("anonymous: respondent is null and the per-form rate limit is consulted", async () => {
    const repo = repoStub();
    const io = {
      consumeAnonRateLimit: vi.fn(async () => true),
      notifyResponse: vi.fn(async () => {}),
    };
    await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada" },
        anonymous: true,
        staffMemberId: "staff-1",
        source: "internal",
      },
      io,
    );
    expect(io.consumeAnonRateLimit).toHaveBeenCalledWith("form-1");
    const arg = repo.createInternalResponse.mock.calls[0]![1];
    expect(arg.respondentStaffId).toBeNull();
  });

  it("anonymous: a tripped rate limit rejects WITHOUT storing", async () => {
    const repo = repoStub();
    const io = {
      consumeAnonRateLimit: vi.fn(async () => false),
      notifyResponse: vi.fn(async () => {}),
    };
    const out = await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada" },
        anonymous: true,
        staffMemberId: "staff-1",
      },
      io,
    );
    expect(out.status).toBe("rejected");
    expect(repo.createInternalResponse).not.toHaveBeenCalled();
  });

  it("rejects an unknown field id (validator reuse)", async () => {
    const repo = repoStub();
    const out = await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada", "f-ghost": "x" },
        anonymous: false,
        staffMemberId: "staff-1",
      },
      alwaysAllow,
    );
    expect(out.status).toBe("rejected");
    expect(repo.createInternalResponse).not.toHaveBeenCalled();
  });

  it("rejects an out-of-set single_select option id (validator reuse)", async () => {
    const repo = repoStub();
    const out = await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada", "f-size": "o-not-real" },
        anonymous: false,
        staffMemberId: "staff-1",
      },
      alwaysAllow,
    );
    expect(out.status).toBe("rejected");
  });

  it("rejects a rating out of range (validator reuse)", async () => {
    const repo = repoStub();
    const out = await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada", "f-stars": "9" },
        anonymous: false,
        staffMemberId: "staff-1",
      },
      alwaysAllow,
    );
    expect(out.status).toBe("rejected");
  });

  it("maps the repo's already_responded outcome through", async () => {
    const repo = {
      createInternalResponse: vi.fn(async () => ({
        ok: false as const,
        reason: "already_responded" as const,
      })),
    };
    const out = await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada" },
        anonymous: false,
        staffMemberId: "staff-1",
      },
      alwaysAllow,
    );
    expect(out).toEqual({ status: "already_responded" });
  });

  it("maps the repo's not_found outcome to a rejection", async () => {
    const repo = {
      createInternalResponse: vi.fn(async () => ({
        ok: false as const,
        reason: "not_found" as const,
      })),
    };
    const out = await processInternalSubmission(
      repo,
      {
        formId: "form-1",
        fields,
        rawAnswers: { "f-name": "Ada" },
        anonymous: false,
        staffMemberId: "staff-1",
      },
      alwaysAllow,
    );
    expect(out.status).toBe("rejected");
  });
});
