import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "./app";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let handler: Promise<Handler> | undefined;

/** Vercel function: boots the Nest app once per instance and hands every request to its Express instance. */
export default async function (req: IncomingMessage, res: ServerResponse): Promise<void> {
   handler ??= createApp().then(async ({ app }) => {
      await app.init();
      return app.getHttpAdapter().getInstance() as Handler;
   });
   (await handler)(req, res);
}
