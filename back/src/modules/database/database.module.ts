import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import { ENV, type Env } from "../../config/env";

export const PG_POOL = Symbol("PG_POOL");

@Global()
@Module({
   providers: [{ provide: PG_POOL, inject: [ENV], useFactory: (env: Env) => new Pool({ connectionString: env.DATABASE_URL, max: 5 }) }],
   exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
   constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

   async onApplicationShutdown(): Promise<void> {
      await this.pool.end();
   }
}
