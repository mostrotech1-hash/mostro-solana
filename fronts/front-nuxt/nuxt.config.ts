// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
   compatibilityDate: "2025-01-01",
   devtools: { enabled: false },
   devServer: { port: 4200 },
   // Frontend: the Openfort SDK needs the browser (storage, iframe), so no SSR.
   ssr: false,

   // Shared UI kit (components + design tokens): fronts/ui.
   extends: ["../ui"],
   modules: ["@pinia/nuxt"],

   app: { head: { title: "Mostro" } },

   runtimeConfig: {
      public: {
         // Publishable keys only (pk_... / Shield publishable). Never put secret keys here.
         // Set them in `.env` (see `.env.example`).
         openfortPublishableKey: "",
         shieldPublishableKey: "",
         // Mostro API (back/). NUXT_PUBLIC_API_BASE
         apiBase: "http://localhost:3100",
         // Cluster used for explorer links. NUXT_PUBLIC_SOLANA_CLUSTER: devnet | testnet | mainnet-beta
         solanaCluster: "devnet",
      },
   },
});
