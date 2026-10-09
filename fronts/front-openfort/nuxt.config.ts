import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
   compatibilityDate: "2025-01-01",
   devtools: { enabled: false },
   devServer: { port: 4200 },
   // Frontend-only: the Openfort SDK needs the browser (storage, iframe), so no SSR.
   ssr: false,

   modules: ["@pinia/nuxt"],
   css: ["~/assets/css/main.css"],
   vite: {
      plugins: [tailwindcss()],
   },

   runtimeConfig: {
      public: {
         // Publishable keys only (pk_... / Shield publishable). Never put sk_ keys here.
         // Set via NUXT_PUBLIC_OPENFORT_PUBLISHABLE_KEY and NUXT_PUBLIC_SHIELD_PUBLISHABLE_KEY in `.env`.
         openfortPublishableKey: "",
         shieldPublishableKey: "",
         // Cluster used for the explorer link. NUXT_PUBLIC_SOLANA_CLUSTER: devnet | testnet | mainnet-beta
         solanaCluster: "devnet",
      },
   },
});
