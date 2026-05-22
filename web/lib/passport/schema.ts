// SYNTHETIC TEST DATA — RESEARCH PROTOTYPE.
//
// Two layered shapes: a readable PassportPayload that the rest of the
// app uses, and a wire-format MinifiedPayload that goes inside the JWS
// for QR scan reliability. Keep these in sync via toMinified /
// fromMinified — they are the only sanctioned crossing.

export type PassportImmStatus = "valid" | "invalid" | "due" | "missing";
export type PassportImmSource = "card" | "rules_engine" | "clinician_confirmed";

const STATUS_TO_CODE: Record<PassportImmStatus, 0 | 1 | 2 | 3> = {
  valid: 0,
  invalid: 1,
  due: 2,
  missing: 3,
};
const CODE_TO_STATUS: Record<0 | 1 | 2 | 3, PassportImmStatus> = {
  0: "valid",
  1: "invalid",
  2: "due",
  3: "missing",
};

const SOURCE_TO_CODE: Record<PassportImmSource, 0 | 1 | 2> = {
  card: 0,
  rules_engine: 1,
  clinician_confirmed: 2,
};
const CODE_TO_SOURCE: Record<0 | 1 | 2, PassportImmSource> = {
  0: "card",
  1: "rules_engine",
  2: "clinician_confirmed",
};

export interface PassportImmunisation {
  vaccineCode: string;
  vaccineLabel: string;
  date: string;
  status: PassportImmStatus;
  source?: PassportImmSource;
}

export interface PassportSubject {
  initials: string;
  birthMonth: string;
}

export interface PassportIssuer {
  id: string;
  name: string;
}

export interface PassportPayload {
  subject: PassportSubject;
  issuer: PassportIssuer;
  issuedAt: number;
  schedule: string;
  immunisations: PassportImmunisation[];
}

export interface MinifiedImmunisation {
  vc: string;
  vl: string;
  d: string;
  s: 0 | 1 | 2 | 3;
  src?: 0 | 1 | 2;
}

export interface MinifiedPayload {
  sbj: { i: string; bm: string };
  iss: { id: string; n: string };
  iat: number;
  sch: string;
  imm: MinifiedImmunisation[];
}

export function toMinified(p: PassportPayload): MinifiedPayload {
  return {
    sbj: { i: p.subject.initials, bm: p.subject.birthMonth },
    iss: { id: p.issuer.id, n: p.issuer.name },
    iat: p.issuedAt,
    sch: p.schedule,
    imm: p.immunisations.map((i) => {
      const m: MinifiedImmunisation = {
        vc: i.vaccineCode,
        vl: i.vaccineLabel,
        d: i.date,
        s: STATUS_TO_CODE[i.status],
      };
      if (i.source !== undefined) m.src = SOURCE_TO_CODE[i.source];
      return m;
    }),
  };
}

export function fromMinified(m: MinifiedPayload): PassportPayload {
  return {
    subject: { initials: m.sbj.i, birthMonth: m.sbj.bm },
    issuer: { id: m.iss.id, name: m.iss.n },
    issuedAt: m.iat,
    schedule: m.sch,
    immunisations: m.imm.map((i) => {
      const out: PassportImmunisation = {
        vaccineCode: i.vc,
        vaccineLabel: i.vl,
        date: i.d,
        status: CODE_TO_STATUS[i.s],
      };
      if (i.src !== undefined) out.source = CODE_TO_SOURCE[i.src];
      return out;
    }),
  };
}

export function isMinifiedPayload(value: unknown): value is MinifiedPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sch !== "string") return false;
  if (typeof v.iat !== "number") return false;
  const sbj = v.sbj as Record<string, unknown> | undefined;
  if (!sbj || typeof sbj.i !== "string" || typeof sbj.bm !== "string") return false;
  const iss = v.iss as Record<string, unknown> | undefined;
  if (!iss || typeof iss.id !== "string" || typeof iss.n !== "string") return false;
  if (!Array.isArray(v.imm)) return false;
  return true;
}
