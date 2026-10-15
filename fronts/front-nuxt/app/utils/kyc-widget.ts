/** Loads the Sumsub web widget and launches it in a container. The token always comes from our API; the widget only shows the steps. */

const SDK_URL = "https://static.sumsub.com/idensic/static/sns-websdk-builder.js";

interface SumsubSdk {
   launch(container: string): void;
}
interface SumsubBuilder {
   init(token: string, refresh: () => Promise<string>): SumsubBuilder;
   withConf(conf: { lang: string; email?: string; theme?: "light" | "dark" }): SumsubBuilder;
   withOptions(options: { addViewportTag?: boolean; adaptIframeHeight?: boolean }): SumsubBuilder;
   on(event: string, handler: (payload?: unknown) => void): SumsubBuilder;
   build(): SumsubSdk;
}
declare global {
   interface Window {
      snsWebSdk?: SumsubBuilder;
   }
}

let sdkLoaded: Promise<SumsubBuilder> | null = null;

function loadSumsubSdk(): Promise<SumsubBuilder> {
   sdkLoaded ??= new Promise<SumsubBuilder>((resolve, reject) => {
      if (window.snsWebSdk) return resolve(window.snsWebSdk);
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => (window.snsWebSdk ? resolve(window.snsWebSdk) : reject(new Error("The verification widget did not load.")));
      script.onerror = () => reject(new Error("The verification widget could not be loaded. Check your connection."));
      document.head.appendChild(script);
   }).catch((error) => {
      sdkLoaded = null; // allow a retry
      throw error;
   });
   return sdkLoaded;
}

export interface KycWidgetOptions {
   /** CSS selector of an empty element. */
   container: string;
   email?: string | null;
   /** Asks the API for a fresh token (used for the first launch and every time the widget needs a new one). */
   getToken: () => Promise<string>;
   onReady: () => void;
   onSubmitted: () => void;
   onError: (message: string) => void;
}

/** Launches the widget. Returns a function that empties the container (call it when the page is left). */
export async function launchKycWidget(options: KycWidgetOptions): Promise<() => void> {
   const builder = await loadSumsubSdk();
   const token = await options.getToken();
   const sdk = builder
      .init(token, options.getToken)
      .withConf({ lang: "en", theme: "dark", ...(options.email ? { email: options.email } : {}) })
      .withOptions({ addViewportTag: false, adaptIframeHeight: true })
      .on("idCheck.onReady", () => options.onReady())
      .on("idCheck.onApplicantSubmitted", () => options.onSubmitted())
      .on("idCheck.onError", (payload) => {
         console.error("[mostro] verification widget error", payload);
         options.onError("The verification could not continue. Please try again.");
      })
      .build();
   sdk.launch(options.container);
   return () => {
      const element = document.querySelector(options.container);
      if (element) element.innerHTML = "";
   };
}
