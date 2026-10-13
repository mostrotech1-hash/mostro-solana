import { PublicKey } from "@solana/web3.js";
import { apiError } from "../../common/api-error";
import type { OpenfortIdentity, OpenfortService } from "../../modules/openfort/openfort.service";

/** Validates a client-supplied wallet address and proves it belongs to the signed-in user. Nothing else is trusted from the client. */
export async function requireOwnedWallet(openfort: OpenfortService, identity: OpenfortIdentity, address: string): Promise<PublicKey> {
   let wallet: PublicKey;
   try {
      wallet = new PublicKey(address);
   } catch {
      throw apiError(400, "WALLET_NOT_OWNED", "Invalid Solana wallet address.");
   }
   // A user wallet is an ed25519 key pair, so its address is on the curve. This also rejects program-derived addresses.
   if (!PublicKey.isOnCurve(wallet.toBytes())) throw apiError(400, "WALLET_NOT_OWNED", "Invalid Solana wallet address.");
   if (!(await openfort.ownsSolanaWallet(identity.openfortId, wallet.toBase58()))) throw apiError(403, "WALLET_NOT_OWNED", "This wallet does not belong to your account.");
   return wallet;
}
