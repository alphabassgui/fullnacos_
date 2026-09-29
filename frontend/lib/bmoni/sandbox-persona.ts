// Sandbox test personas used as the merchant identity.
// From https://embedded-docs.bmoni.com/api-reference/sandbox-test-data/
// Names, phone and BVN must all belong to the SAME persona or verification
// fails on purpose. Fake data, safe to commit.
//
// Two personas exist. If the shared sandbox key is in use, another team may
// already own one persona's phone number (BMONI answers 409 on duplicate
// phone/email), so provisioning falls back to the next persona.

export interface Persona {
  firstName: string;
  lastName: string;
  phoneNumber: string; // E.164
  bvn: string;
}

export const PERSONAS: Persona[] = [
  { firstName: "Samson", lastName: "Jabo", phoneNumber: "+2348000000001", bvn: "22222222222" },
  { firstName: "Bunch", lastName: "Dillon", phoneNumber: "+2348000000000", bvn: "95888168924" },
];

/** Unique per run so we never recover (and reuse) a user that belongs to someone else. */
export const personaEmail = (p: Persona, tag: string) =>
  `${p.firstName}.${p.lastName}+${tag}@example.com`.toLowerCase();
