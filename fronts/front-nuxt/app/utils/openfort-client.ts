import { Openfort, OpenfortConfiguration, ShieldConfiguration } from "@openfort/openfort-js";

let client: Openfort | null = null;

/** The SDK must be instantiated once; every page shares this instance (browser only, the app is SPA). */
export function getOpenfortClient(publishableKey: string, shieldPublishableKey: string): Openfort {
   if (!publishableKey) throw new Error("NUXT_PUBLIC_OPENFORT_PUBLISHABLE_KEY is not set (fronts/front-nuxt/.env).");
   if (!shieldPublishableKey) throw new Error("NUXT_PUBLIC_SHIELD_PUBLISHABLE_KEY is not set (fronts/front-nuxt/.env).");
   client ??= new Openfort({
      baseConfiguration: new OpenfortConfiguration({ publishableKey }),
      shieldConfiguration: new ShieldConfiguration({ shieldPublishableKey }),
   });
   return client;
}
