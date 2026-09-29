// Server-held owner key for the wallet. DEMO ONLY.
//
// In a real product the customer's key lives on their device (BMONI's SDK uses
// Keystore / Secure Enclave). Here the server generates and stores it so the
// sandbox demo can run end to end. See docs/payments/README.md "Limitations".

import { Wallet } from "ethers";

export interface OwnerKey {
  address: string;
  privateKey: string;
}

export function generateOwnerKey(): OwnerKey {
  const w = Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey };
}

/**
 * Owner-proof challenge signature: EIP-191 personal_sign (WITH the message
 * prefix). ethers' signMessage does exactly that.
 */
export function signOwnerProof(privateKey: string, message: string) {
  return new Wallet(privateKey).signMessage(message);
}

/**
 * Proposal signature: sign the RAW 32-byte digest, NO prefix. Not used by the
 * subscription flow yet (only needed if we send payouts), kept here so the two
 * methods sit side by side and don't get mixed up.
 */
export function signProposalDigest(privateKey: string, hashToSign: string) {
  return new Wallet(privateKey).signingKey.sign(hashToSign).serialized;
}
