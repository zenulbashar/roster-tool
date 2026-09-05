import { describe, it, expect } from "vitest";
import {
  JOB_RETENTION_SECONDS,
  queueOptions,
  updatableQueueOptions,
} from "@/lib/jobs/boss";
import { QUEUES } from "@/lib/jobs/queues";

/**
 * The per-queue settings the worker applies at boot (and the web producer on
 * a lazy first send). Two invariants: every queue dead-letters into
 * `dead-letter` (OPS-02), and every keyed queue uses the `short` policy so a
 * singleton key actually collapses duplicate enqueues — on pg-boss's default
 * `standard` policy the key is inert. The dead-letter queue itself must stay
 * `standard`: its jobs carry no key and would otherwise share one slot.
 */
describe("queue options", () => {
  it("every queue except dead-letter dead-letters and dedupes by key", () => {
    for (const name of Object.values(QUEUES)) {
      const opts = queueOptions(name);
      expect(opts.deleteAfterSeconds).toBe(JOB_RETENTION_SECONDS);
      if (name === QUEUES.deadLetter) {
        expect(opts.deadLetter).toBeUndefined();
        expect(opts.policy).toBeUndefined();
      } else {
        expect(opts.deadLetter).toBe(QUEUES.deadLetter);
        expect(opts.policy).toBe("short");
      }
    }
  });

  it("keeps finished jobs for two weeks", () => {
    expect(JOB_RETENTION_SECONDS).toBe(14 * 24 * 60 * 60);
  });

  it("never passes the fixed-at-creation policy to updateQueue", () => {
    for (const name of Object.values(QUEUES)) {
      const opts = updatableQueueOptions(name);
      expect("policy" in opts).toBe(false);
      expect(opts.deleteAfterSeconds).toBe(JOB_RETENTION_SECONDS);
    }
  });
});
