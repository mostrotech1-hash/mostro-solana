import { defineStore } from "pinia";
import devnet from "@mostro/shared/addresses/devnet";

/** The user's balances, read straight from Solana devnet: SOL and the artist token. Refreshed on page loads and after a purchase. */
export const useWalletStore = defineStore("wallet", () => {
   const config = useRuntimeConfig();
   const session = useSessionStore();
   const sol = ref<bigint | null>(null);
   const token = ref<bigint | null>(null);
   const loading = ref(false);
   let loadedAt = 0;

   /** Symbol of the artist token (MOOG), from the same file the program addresses come from. */
   const tokenSymbol = devnet.curves[0]?.symbol ?? "MOOG";
   const tokenMint = devnet.curves[0]?.mint ?? "";

   /** `force` skips the 10 second cache (use it right after a purchase). Never throws: a failed read keeps the last numbers. */
   async function refresh(force = false): Promise<void> {
      const address = session.walletAddress;
      if (!address || loading.value) return;
      if (!force && Date.now() - loadedAt < 10_000 && sol.value !== null) return;
      loading.value = true;
      try {
         const [lamports, tokens] = await Promise.all([getBalanceLamports(config.public.solanaRpcUrl, address), getTokenBalance(config.public.solanaRpcUrl, address, tokenMint)]);
         sol.value = lamports;
         token.value = tokens;
         loadedAt = Date.now();
      } catch (error) {
         console.warn("[mostro] could not read the wallet balances", error);
      } finally {
         loading.value = false;
      }
   }

   function reset() {
      sol.value = null;
      token.value = null;
      loadedAt = 0;
   }

   return { sol, token, loading, tokenSymbol, refresh, reset };
});
