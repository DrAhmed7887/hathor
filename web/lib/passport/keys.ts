// SYNTHETIC TEST ISSUER — NOT VALID FOR CLINICAL USE.
//
// Static ES256 keypair embedded for the OSVP 2026 demo. Both halves are
// committed by design: the demo signs in the browser and verifies in the
// browser, with no backend, no key federation, and no real issuer
// integration. Replacing this with a real key would require a separate
// signing service and a published JWKS — explicitly out of scope.
//
// kid is used in the JWS protected header so a future multi-issuer
// build can route to the right public key without changing the wire
// format.

import type { JWK } from "jose";

export const DEMO_ISSUER_KID = "hathor-demo-issuer-2026";
export const DEMO_ISSUER_NAME = "Hathor Demo Clinic (synthetic)";
export const DEMO_ISSUER_ID = "did:web:hathor.demo";

export const DEMO_ISSUER_PUBLIC_KEY: JWK = {
  kty: "EC",
  crv: "P-256",
  x: "xBqz04PJ1SYfHF7mj_Z1Gm_EW28qSlOOFFPwQW7U45Y",
  y: "gAQ6KK9VhKGS3KaZIws20dcMMOC_Aiu8olBQ9T4Se3E",
  kid: DEMO_ISSUER_KID,
  use: "sig",
  alg: "ES256",
};

export const DEMO_ISSUER_PRIVATE_KEY: JWK = {
  kty: "EC",
  crv: "P-256",
  x: "xBqz04PJ1SYfHF7mj_Z1Gm_EW28qSlOOFFPwQW7U45Y",
  y: "gAQ6KK9VhKGS3KaZIws20dcMMOC_Aiu8olBQ9T4Se3E",
  d: "GTmDtVzUe0hwwSkclB6BmHXaoY7OFqF1tP4XdT95erc",
  kid: DEMO_ISSUER_KID,
  use: "sig",
  alg: "ES256",
};
