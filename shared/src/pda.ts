import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import { DEFAULT_COLLECTION_SALT, PROGRAM_ID, SEEDS, TOKEN_METADATA_PROGRAM_ID } from "./constants";

export type Pda = [PublicKey, number];
export type U64Like = BN | number | string | bigint;

/** Little-endian u32, as Anchor encodes `index.to_le_bytes()`. */
export function u32Le(n: number): Buffer {
   if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError(`u32 out of range: ${n}`);
   const b = Buffer.alloc(4);
   b.writeUInt32LE(n, 0);
   return b;
}

/** Little-endian u64, as Anchor encodes `nonce.to_le_bytes()`. */
export function u64Le(n: U64Like): Buffer {
   const bn = toBn(n);
   if (bn.isNeg() || bn.bitLength() > 64) throw new RangeError(`u64 out of range: ${bn.toString()}`);
   return bn.toArrayLike(Buffer, "le", 8);
}

export function toBn(n: U64Like): BN {
   if (BN.isBN(n)) return n;
   if (typeof n === "bigint") return new BN(n.toString());
   if (typeof n === "number") {
      if (!Number.isSafeInteger(n)) throw new RangeError(`not a safe integer: ${n}`);
      return new BN(n);
   }
   return new BN(n);
}

export function configPda(programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.config], programId);
}

export function treasuryPda(programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.treasury], programId);
}

export function curvePda(curveIndex: number, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.curve, u32Le(curveIndex)], programId);
}

export function mintPda(curveIndex: number, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.mint, u32Le(curveIndex)], programId);
}

/** Hot vault: the 28 % sold on the curve. */
export function curveVaultPda(curve: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.curveVault, curve.toBuffer()], programId);
}

/** Cold vault: the artist's 50 %. */
export function artistReservePda(curve: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.artistReserve, curve.toBuffer()], programId);
}

/** Cold vault: Mostro's 15 %. */
export function mostroReservePda(curve: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.mostroReserve, curve.toBuffer()], programId);
}

/** Cold vault: the 7 % DEX liquidity reserve. */
export function dexReservePda(curve: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.dexReserve, curve.toBuffer()], programId);
}

export function solVaultPda(curve: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.solVault, curve.toBuffer()], programId);
}

export function rewardsVaultPda(curve: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.rewards, curve.toBuffer()], programId);
}

export function artistPda(artistIndex: number, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.artist, u32Le(artistIndex)], programId);
}

export function perkPda(artist: PublicKey, perkIndex: number, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.perk, artist.toBuffer(), u32Le(perkIndex)], programId);
}

/**
 * Core collection of a perk: `["collection", perk, collection_salt u64 LE]`. The salt is the one passed to
 * `create_perk`; it is not stored on-chain, so prefer `perk.collection` when you have the account.
 */
export function collectionPda(perk: PublicKey, collectionSalt: U64Like = DEFAULT_COLLECTION_SALT, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.collection, perk.toBuffer(), u64Le(collectionSalt)], programId);
}

export function assetPda(perk: PublicKey, nonce: U64Like, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.asset, perk.toBuffer(), u64Le(nonce)], programId);
}

export function receiptPda(asset: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.receipt, asset.toBuffer()], programId);
}

/** Blacklist entry of a wallet. Always passed to buys and redeems; usually empty (not blacklisted). */
export function blacklistPda(wallet: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.blacklist, wallet.toBuffer()], programId);
}

/** Governance member record of a wallet. */
export function memberPda(wallet: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.member, wallet.toBuffer()], programId);
}

/** Proposal by index (`config.proposalCount` is the next index). */
export function proposalPda(proposalIndex: U64Like, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.proposal, u64Le(proposalIndex)], programId);
}

/** One member's approval of one proposal. */
export function approvalPda(proposal: PublicKey, wallet: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.approval, proposal.toBuffer(), wallet.toBuffer()], programId);
}

/** Anti-whale tracker of a wallet on a curve. */
export function spendPda(curve: PublicKey, wallet: PublicKey, programId: PublicKey = PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.spend, curve.toBuffer(), wallet.toBuffer()], programId);
}

/** Metaplex Token Metadata account of a mint: `["metadata", token_metadata_program, mint]` under the Token Metadata program. */
export function metadataPda(mint: PublicKey, tokenMetadataProgram: PublicKey = TOKEN_METADATA_PROGRAM_ID): Pda {
   return PublicKey.findProgramAddressSync([SEEDS.metadata, tokenMetadataProgram.toBuffer(), mint.toBuffer()], tokenMetadataProgram);
}

/** Associated token account; `owner` may be a PDA (off-curve). */
export function ata(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
   return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
}

/** Protocol USDC treasury: the config PDA's associated token account for the USDC mint. */
export function treasuryUsdcAta(usdcMint: PublicKey, programId: PublicKey = PROGRAM_ID, usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
   return ata(configPda(programId)[0], usdcMint, usdcTokenProgram);
}

/** A curve's USDC vault: the curve PDA's associated token account for the USDC mint. */
export function curveUsdcVaultAta(curve: PublicKey, usdcMint: PublicKey, usdcTokenProgram: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
   return ata(curve, usdcMint, usdcTokenProgram);
}

/** Everything derivable for one curve from its index alone. */
export interface CurveAddresses {
   curve: PublicKey;
   curveBump: number;
   mint: PublicKey;
   mintBump: number;
   curveVault: PublicKey;
   artistReserve: PublicKey;
   mostroReserve: PublicKey;
   dexReserve: PublicKey;
   solVault: PublicKey;
   solVaultBump: number;
   rewardsVault: PublicKey;
   metadata: PublicKey;
}

export function deriveCurveAddresses(curveIndex: number, programId: PublicKey = PROGRAM_ID): CurveAddresses {
   const [curve, curveBump] = curvePda(curveIndex, programId);
   const [mint, mintBump] = mintPda(curveIndex, programId);
   const [solVault, solVaultBump] = solVaultPda(curve, programId);
   return {
      curve,
      curveBump,
      mint,
      mintBump,
      curveVault: curveVaultPda(curve, programId)[0],
      artistReserve: artistReservePda(curve, programId)[0],
      mostroReserve: mostroReservePda(curve, programId)[0],
      dexReserve: dexReservePda(curve, programId)[0],
      solVault,
      solVaultBump,
      rewardsVault: rewardsVaultPda(curve, programId)[0],
      metadata: metadataPda(mint)[0],
   };
}

/** Everything derivable for one perk from (artist index, perk index). */
export interface PerkAddresses {
   artist: PublicKey;
   artistBump: number;
   perk: PublicKey;
   perkBump: number;
   collection: PublicKey;
   collectionBump: number;
}

export function derivePerkAddresses(artistIndex: number, perkIndex: number, collectionSalt: U64Like = DEFAULT_COLLECTION_SALT, programId: PublicKey = PROGRAM_ID): PerkAddresses {
   const [artist, artistBump] = artistPda(artistIndex, programId);
   const [perk, perkBump] = perkPda(artist, perkIndex, programId);
   const [collection, collectionBump] = collectionPda(perk, collectionSalt, programId);
   return { artist, artistBump, perk, perkBump, collection, collectionBump };
}
