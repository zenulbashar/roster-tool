/**
 * Pure upload validation — size ceiling + an allow-list of common document and
 * image types. Used by the upload server action before any bytes are streamed
 * to Drive. No I/O.
 */

/** 10 MB. Generous for a contract/ID scan, small enough to stream safely. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Common document + image types staff records are made of. */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

/** Owner-facing labels for the optional document type. Free text in the DB. */
export const DOC_TYPES = ["Contract", "RSA", "ID", "Other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type UploadValidation =
  | { ok: true }
  | { ok: false; reason: "empty" | "too_large" | "bad_type"; message: string };

export function validateUpload(input: {
  size: number;
  mimeType: string;
}): UploadValidation {
  if (!input.size || input.size <= 0) {
    return { ok: false, reason: "empty", message: "Choose a file to upload." };
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      message: "That file is over the 10 MB limit.",
    };
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return {
      ok: false,
      reason: "bad_type",
      message:
        "That file type isn't supported. Upload a PDF, image, Word, Excel or text file.",
    };
  }
  return { ok: true };
}
