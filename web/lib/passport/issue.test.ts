import { test } from "node:test";
import assert from "node:assert/strict";

import { issuePassport, verifyPassport } from "./issue.ts";
import type { PassportPayload } from "./schema.ts";

const SAMPLE: PassportPayload = {
  subject: { initials: "A.D.", birthMonth: "2024-04" },
  issuer: {
    id: "did:web:hathor.demo",
    name: "Hathor Demo Clinic (synthetic)",
  },
  issuedAt: 1714545600,
  schedule: "EG-NIP-2024",
  immunisations: [
    {
      vaccineCode: "BCG",
      vaccineLabel: "BCG",
      date: "2024-04-15",
      status: "valid",
      source: "clinician_confirmed",
    },
    {
      vaccineCode: "DTP",
      vaccineLabel: "DTP",
      date: "2024-06-20",
      status: "valid",
      source: "rules_engine",
    },
  ],
};

test("issuePassport → verifyPassport round-trips the payload", async () => {
  const jws = await issuePassport(SAMPLE);
  assert.equal(typeof jws, "string");
  assert.equal(jws.split(".").length, 3, "compact JWS has three segments");

  const result = await verifyPassport(jws);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.payload.subject, SAMPLE.subject);
  assert.deepEqual(result.payload.issuer, SAMPLE.issuer);
  assert.equal(result.payload.issuedAt, SAMPLE.issuedAt);
  assert.equal(result.payload.schedule, SAMPLE.schedule);
  assert.equal(result.payload.immunisations.length, SAMPLE.immunisations.length);
  assert.deepEqual(result.payload.immunisations[0], SAMPLE.immunisations[0]);
  assert.equal(result.protectedHeader.alg, "ES256");
  assert.equal(result.protectedHeader.kid, "hathor-demo-issuer-2026");
});

test("verifyPassport rejects a tampered payload segment", async () => {
  const jws = await issuePassport(SAMPLE);
  const [header, payloadSeg, sig] = jws.split(".");

  const decoded = Buffer.from(payloadSeg, "base64url").toString("utf8");
  const mutated = decoded.replace('"BCG"', '"YF"');
  const reencoded = Buffer.from(mutated, "utf8").toString("base64url");
  assert.notEqual(reencoded, payloadSeg, "tampered segment must differ");

  const tampered = `${header}.${reencoded}.${sig}`;
  const result = await verifyPassport(tampered);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, "bad_signature");
});

test("verifyPassport rejects malformed input", async () => {
  for (const bad of ["", "abc", "abc.def", "abc.def.ghi.jkl"]) {
    const result = await verifyPassport(bad);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error === "malformed" || result.error === "bad_signature");
    }
  }
});
