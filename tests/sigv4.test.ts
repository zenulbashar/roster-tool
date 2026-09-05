import { describe, it, expect } from "vitest";
import {
  EMPTY_PAYLOAD_HASH,
  amzDate,
  canonicalHeaders,
  canonicalQueryString,
  encodeKeyPath,
  sha256Hex,
  signRequest,
  uriEncode,
} from "@/lib/blob/sigv4";

/**
 * PERF-06 — the raw-fetch S3 client's signing maths, pinned to the worked
 * examples in Amazon S3's "Authenticating Requests (AWS Signature Version 4):
 * Using the Authorization Header" (access key AKIAIOSFODNN7EXAMPLE, the
 * documented secret, examplebucket, 24 May 2013). Each stage is checked so a
 * regression names the step that drifted.
 */
const CREDS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "s3",
};
const NOW = new Date("2013-05-24T00:00:00Z");

describe("SigV4", () => {
  it("GET Object example: canonical request, string to sign, signature", () => {
    const signed = signRequest(
      {
        method: "GET",
        host: "examplebucket.s3.amazonaws.com",
        path: "/test.txt",
        headers: { Range: "bytes=0-9" },
        payloadHash: EMPTY_PAYLOAD_HASH,
        now: NOW,
      },
      CREDS,
    );
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY_PAYLOAD_HASH}`,
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY_PAYLOAD_HASH,
      ].join("\n"),
    );
    expect(sha256Hex(signed.canonicalRequest)).toBe(
      "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
    );
    expect(signed.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
      ].join("\n"),
    );
    expect(signed.signature).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
    expect(signed.headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("PUT Object example: a payload hash and a `$` in the key", () => {
    const body = "Welcome to Amazon S3.";
    const payloadHash = sha256Hex(body);
    expect(payloadHash).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
    );
    const signed = signRequest(
      {
        method: "PUT",
        host: "examplebucket.s3.amazonaws.com",
        path: encodeKeyPath("test$file.text"),
        headers: {
          Date: "Fri, 24 May 2013 00:00:00 GMT",
          "x-amz-storage-class": "REDUCED_REDUNDANCY",
        },
        payloadHash,
        now: NOW,
      },
      CREDS,
    );
    expect(signed.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(signed.signature).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("encodes keys per AWS UriEncode and sorts query/header sets", () => {
    expect(uriEncode("a b+c/d~e!f*g'h(i)")).toBe(
      "a%20b%2Bc%2Fd~e%21f%2Ag%27h%28i%29",
    );
    expect(encodeKeyPath("clock-photos/b/e/p.jpg")).toBe(
      "/clock-photos/b/e/p.jpg",
    );
    expect(
      canonicalQueryString([
        ["z", "1"],
        ["a", "x y"],
        ["a", "b"],
      ]),
    ).toBe("a=b&a=x%20y&z=1");
    expect(
      canonicalHeaders({
        "X-Amz-Date": " d ",
        host: "h",
        "Content-Type": "a  b",
      }),
    ).toEqual({
      canonical: "content-type:a b\nhost:h\nx-amz-date:d\n",
      signedHeaders: "content-type;host;x-amz-date",
    });
    expect(amzDate(new Date("2026-09-05T01:02:03.456Z"))).toEqual({
      amzDate: "20260905T010203Z",
      dateStamp: "20260905",
    });
  });
});
