import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import Openfort, { APIError } from "@openfort/openfort-node";
import type { LoginType } from "@mostro/shared/api";
import { ENV, type Env } from "../../config/env";
import { requireConfigured } from "../../common/http";

/** What Openfort itself vouches for. Nothing the browser sends in a body is trusted for identity. */
export interface OpenfortIdentity {
   /** Openfort user id (`usr_...`). */
   openfortId: string;
   email: string | null;
   /** Profile picture URL given by the provider (Google, X...), when there is one. */
   imageUrl: string | null;
}

const SUPPORTED: readonly LoginType[] = ["google", "apple", "twitter", "email"];

@Injectable()
export class OpenfortService {
   private readonly logger = new Logger(OpenfortService.name);
   private client: Openfort | null = null;

   constructor(@Inject(ENV) private readonly env: Env) {}

   private getClient(): Openfort {
      const secret = requireConfigured(this.env.OPENFORT_SECRET_KEY, "Openfort");
      // The publishable key is required for token checks: Openfort validates the token against that project's auth config.
      const publishableKey = requireConfigured(this.env.OPENFORT_PUBLISHABLE_KEY, "Openfort");
      this.client ??= new Openfort(secret, { publishableKey });
      return this.client;
   }

   async verifyAccessToken(accessToken: string): Promise<OpenfortIdentity> {
      const client = this.getClient();
      let session;
      try {
         session = await client.iam.getSession({ accessToken });
      } catch (err) {
         this.logger.warn(`Openfort rejected an access token: ${describe(err)}`);
         throw new UnauthorizedException("Invalid or expired session.");
      }
      if (!session?.user?.id) throw new UnauthorizedException("Invalid or expired session.");

      return { openfortId: session.user.id, email: session.user.email || null, imageUrl: session.user.image ?? null };
   }

   /** Which method the user signed in with: the most recently used supported provider on the Openfort user. */
   async loginTypeOf(userId: string): Promise<LoginType> {
      const client = this.getClient();
      try {
         const user = await client.iam.users.get(userId);
         const accounts = [...user.linkedAccounts].sort((a, b) => b.updatedAt - a.updatedAt);
         for (const account of accounts) {
            const provider = account.provider === "credential" ? "email" : account.provider;
            if ((SUPPORTED as readonly string[]).includes(provider)) return provider as LoginType;
         }
      } catch (err) {
         this.logger.warn(`Could not read linked accounts of ${userId}: ${describe(err)}`);
      }
      return "email";
   }

   /** True only when `address` is one of this user's own Openfort Solana wallets: the sponsor never pays for a wallet the user does not own. */
   async ownsSolanaWallet(openfortId: string, address: string): Promise<boolean> {
      const client = this.getClient();
      try {
         const list = await client.accounts.list({ user: openfortId, chainType: "SVM", address, limit: 5 } as never);
         return list.data.some((account) => account.address === address);
      } catch (err) {
         this.logger.warn(`Could not check wallet ownership: ${describe(err)}`);
         return false;
      }
   }

   /** Shield "automatic recovery" session: lets the front create the embedded wallet without asking the user for a password. */
   async createEncryptionSession(): Promise<string> {
      const client = this.getClient();
      const key = requireConfigured(this.env.SHIELD_API_KEY, "Shield");
      const secret = requireConfigured(this.env.SHIELD_API_SECRET, "Shield");
      const share = requireConfigured(this.env.SHIELD_ENCRYPTION_SHARE, "Shield");
      try {
         return await client.createEncryptionSession(key, secret, share);
      } catch (err) {
         this.logger.error(`Could not create an encryption session: ${describe(err)}`);
         throw err;
      }
   }
}

function describe(err: unknown): string {
   return err instanceof APIError ? `${err.errorType} (${err.statusCode}): ${err.errorMessage}` : ((err as Error)?.message ?? String(err));
}
