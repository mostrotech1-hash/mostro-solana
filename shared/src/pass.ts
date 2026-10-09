/**
 * Find the MoOG Pass a wallet holds so `redeem_perk` can be called with the right optional accounts.
 * On-chain `resolve_pass` requires: `pass_perk.kind == Pass`, `pass_asset.owner == buyer` and
 * `pass_asset.update_authority == Collection(pass_perk.collection)`; this helper applies the same filter.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { publicKey as umiPublicKey, Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchAssetsByOwner, AssetV1 } from "@metaplex-foundation/mpl-core";
import { TIER_VIP } from "./constants";
import { PerkAccount, WithKey, isPassPerk } from "./accounts";

export interface PassPerkRef {
   /** Perk PDA of the pass tier. */
   perk: PublicKey;
   /** Core collection of that perk (`perk.collection`; seeds `["collection", perk, salt]`). */
   collection: PublicKey;
   /** 0 Standard, 1 VIP. */
   tier: number;
   /** `perk.active`. `redeem_perk` rejects a pass whose tier was deactivated (`PerkInactive`). */
   active: boolean;
}

export interface FoundPass {
   /** Core asset address: goes in `redeem_perk.pass_asset`. */
   asset: PublicKey;
   /** Pass perk PDA: goes in `redeem_perk.pass_perk`. */
   perk: PublicKey;
   collection: PublicKey;
   tier: number;
   /** False when the pass tier was deactivated; presenting it fails on-chain, so treat as "no pass". */
   active: boolean;
   name: string;
   uri: string;
}

/** Turn fetched pass perks (from `listPassPerks`) into the references `findPassForBuyer` needs. Collections come from the accounts. */
export function passPerkRefs(perks: WithKey<PerkAccount>[]): PassPerkRef[] {
   return perks.filter((p) => isPassPerk(p.account)).map((p) => ({ perk: p.publicKey, collection: p.account.collection, tier: p.account.tier, active: p.account.active }));
}

export function umiFrom(source: Umi | Connection): Umi {
   if (source instanceof Connection) return createUmi(source);
   return source;
}

/** All passes the buyer owns (including ones from deactivated tiers, flagged `active: false`), VIP first. */
export async function findPassesForBuyer(source: Umi | Connection, buyer: PublicKey, passPerks: PassPerkRef[]): Promise<FoundPass[]> {
   if (passPerks.length === 0) return [];
   const umi = umiFrom(source);
   const byCollection = new Map(passPerks.map((p) => [p.collection.toBase58(), p]));
   const assets: AssetV1[] = await fetchAssetsByOwner(umi, umiPublicKey(buyer.toBase58()), { skipDerivePlugins: true });
   const found: FoundPass[] = [];
   for (const a of assets) {
      if (a.updateAuthority.type !== "Collection" || !a.updateAuthority.address) continue;
      const ref = byCollection.get(a.updateAuthority.address.toString());
      if (!ref) continue;
      found.push({ asset: new PublicKey(a.publicKey.toString()), perk: ref.perk, collection: ref.collection, tier: ref.tier, active: ref.active, name: a.name, uri: a.uri });
   }
   return found.sort((x, y) => y.tier - x.tier);
}

/** The best usable pass (VIP over Standard, active tiers only) the buyer owns, or `null`. */
export async function findPassForBuyer(source: Umi | Connection, buyer: PublicKey, passPerks: PassPerkRef[]): Promise<FoundPass | null> {
   const all = await findPassesForBuyer(source, buyer, passPerks);
   return all.find((p) => p.active) ?? null;
}

export function isVip(pass: FoundPass | null | undefined): boolean {
   return !!pass && pass.tier === TIER_VIP;
}

/** Shape expected by `buildRedeemPerk({ pass })`. */
export function toPassAccounts(pass: FoundPass | null | undefined): { asset: PublicKey; perk: PublicKey } | null {
   return pass ? { asset: pass.asset, perk: pass.perk } : null;
}
