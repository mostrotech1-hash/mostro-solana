import { fileURLToPath } from "node:url";

// Nuxt layer: any front that does `extends: ["../ui"]` gets the Ui* components and the design tokens.
export default defineNuxtConfig({
   css: [fileURLToPath(new URL("./assets/css/tokens.css", import.meta.url))],
   app: {
      head: {
         link: [
            // Tab icon for every front that extends this layer (file: public/favicon.ico).
            { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
            { rel: "preconnect", href: "https://fonts.googleapis.com" },
            { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
            { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" },
         ],
      },
   },
});
