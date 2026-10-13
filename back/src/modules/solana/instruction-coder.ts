import { BorshInstructionCoder, type Idl } from "@coral-xyz/anchor";
import idlJson from "@mostro/shared/idl";

/** Decodes Mostro instruction data from a compiled transaction (used to inspect what we sign and what landed on-chain). */
export const instructionCoder = new BorshInstructionCoder(idlJson as unknown as Idl);

const instructions = (idlJson as unknown as { instructions: { name: string; accounts: { name: string }[] }[] }).instructions;

/** Position of an account in an instruction's account list, from the IDL (so nothing is hardcoded). */
export function accountSlot(instruction: string, account: string): number {
   const slot = instructions.find((i) => i.name === instruction)?.accounts.findIndex((a) => a.name === account) ?? -1;
   if (slot < 0) throw new Error(`Unknown account ${account} in ${instruction}`);
   return slot;
}

/** `buy_tokens_exact_out_sol`, `buyTokensExactOutSol` and so on all normalize to the same string. */
export const normalizeName = (name: string): string => name.replace(/_/g, "").toLowerCase();
