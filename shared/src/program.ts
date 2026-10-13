import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { Mostro } from "../types/mostro";
import idlJson from "../idl/mostro.json";

/** The program IDL as a typed object. */
export const IDL = idlJson as unknown as Mostro;

export type MostroProgram = Program<Mostro>;

/**
 * A read-only `Program<Mostro>` bound to a connection. Enough for every fetch helper and every
 * instruction builder in this package (builders never sign; the front signs with its own stack).
 */
export function createReadonlyProgram(connection: Connection, programId: PublicKey = new PublicKey(IDL.address)): MostroProgram {
   const idl = programId.equals(new PublicKey(IDL.address)) ? IDL : ({ ...IDL, address: programId.toBase58() } as Mostro);
   return new Program<Mostro>(idl, { connection });
}

/**
 * A `Program<Mostro>` with an Anchor provider that can sign (tests, scripts, Node CLIs).
 * `wallet` may be any Anchor `Wallet`-compatible object; a throwaway keypair is used when omitted.
 */
export function createProgram(connection: Connection, wallet?: Wallet, programId: PublicKey = new PublicKey(IDL.address)): MostroProgram {
   const provider = new AnchorProvider(connection, wallet ?? new Wallet(Keypair.generate()), { commitment: "confirmed", preflightCommitment: "confirmed" });
   const idl = programId.equals(new PublicKey(IDL.address)) ? IDL : ({ ...IDL, address: programId.toBase58() } as Mostro);
   return new Program<Mostro>(idl, provider);
}
