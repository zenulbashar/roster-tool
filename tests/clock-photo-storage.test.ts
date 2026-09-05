import { describe, it, expect } from "vitest";
import {
  CLOCK_PHOTO_KEY_PREFIX,
  checksumOf,
  clockPhotoKey,
  extensionFor,
  resolvePhotoWriteMode,
} from "@/lib/clock-photo-storage";
import { isValidBlobKey } from "@/lib/blob/store";

/** PERF-06 — the pure half of clock-photo storage. */
describe("clock photo storage (pure)", () => {
  it("picks the write mode from configuration + the rollout flag", () => {
    expect(
      resolvePhotoWriteMode({ storeConfigured: false, storeOnly: false }),
    ).toBe("database");
    // The flag can't move bytes out of the database when there is no store.
    expect(
      resolvePhotoWriteMode({ storeConfigured: false, storeOnly: true }),
    ).toBe("database");
    expect(
      resolvePhotoWriteMode({ storeConfigured: true, storeOnly: false }),
    ).toBe("dual");
    expect(
      resolvePhotoWriteMode({ storeConfigured: true, storeOnly: true }),
    ).toBe("store");
  });

  it("derives a tenant-first key that passes the store's grammar", () => {
    const key = clockPhotoKey({
      businessId: "0f1e2d3c-4b5a-4968-8776-655443322110",
      timesheetEntryId: "6b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      photoId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      mimeType: "image/jpeg",
    });
    expect(key).toBe(
      `${CLOCK_PHOTO_KEY_PREFIX}/0f1e2d3c-4b5a-4968-8776-655443322110/6b1a2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg`,
    );
    expect(isValidBlobKey(key)).toBe(true);
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("IMAGE/JPEG")).toBe("jpg");
    expect(extensionFor("application/octet-stream")).toBe("bin");
  });

  it("checksums are sha256 hex of the bytes", () => {
    expect(checksumOf(Buffer.from("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});
