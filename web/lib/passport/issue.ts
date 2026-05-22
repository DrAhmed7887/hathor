// SYNTHETIC TEST DATA — RESEARCH PROTOTYPE.
//
// Compact-JWS (ES256) issue and verify for the Hathor Passport demo.
// Web Crypto-compatible so the same code runs in Node tests and in the
// browser at scan time.

import { CompactSign, compactVerify, importJWK } from "jose";

import {
  DEMO_ISSUER_KID,
  DEMO_ISSUER_PRIVATE_KEY,
  DEMO_ISSUER_PUBLIC_KEY,
} from "./keys.ts";
import {
  fromMinified,
  isMinifiedPayload,
  toMinified,
  type MinifiedPayload,
  type PassportPayload,
} from "./schema.ts";

const ALG = "ES256";

export type VerifyError = "bad_signature" | "malformed" | "expired";

export type VerifyResult =
  | { ok: true; payload: PassportPayload; protectedHeader: { alg: string; kid?: string } }
  | { ok: false; error: VerifyError };

export async function issuePassport(payload: PassportPayload): Promise<string> {
  const minified = toMinified(payload);
  const json = JSON.stringify(minified);
  const bytes = new TextEncoder().encode(json);

  const privateKey = await importJWK(DEMO_ISSUER_PRIVATE_KEY, ALG);

  const jws = await new CompactSign(bytes)
    .setProtectedHeader({ alg: ALG, kid: DEMO_ISSUER_KID })
    .sign(privateKey);

  return jws;
}

export async function verifyPassport(jws: string): Promise<VerifyResult> {
  if (typeof jws !== "string" || jws.split(".").length !== 3) {
    return { ok: false, error: "malformed" };
  }

  let publicKey: Awaited<ReturnType<typeof importJWK>>;
  try {
    publicKey = await importJWK(DEMO_ISSUER_PUBLIC_KEY, ALG);
  } catch {
    return { ok: false, error: "malformed" };
  }

  let verified;
  try {
    verified = await compactVerify(jws, publicKey, { algorithms: [ALG] });
  } catch {
    return { ok: false, error: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(verified.payload));
  } catch {
    return { ok: false, error: "malformed" };
  }

  if (!isMinifiedPayload(parsed)) {
    return { ok: false, error: "malformed" };
  }

  const payload = fromMinified(parsed as MinifiedPayload);
  return {
    ok: true,
    payload,
    protectedHeader: {
      alg: typeof verified.protectedHeader.alg === "string" ? verified.protectedHeader.alg : ALG,
      kid: typeof verified.protectedHeader.kid === "string" ? verified.protectedHeader.kid : undefined,
    },
  };
}
