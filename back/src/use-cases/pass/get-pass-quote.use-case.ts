import { Inject, Injectable } from "@nestjs/common";
import type { PassQuote } from "@mostro/shared/api";
import { SolanaService } from "../../modules/solana/solana.service";

/** The live quote: read from the current curve state, never cached and never hardcoded. */
@Injectable()
export class GetPassQuoteUseCase {
   constructor(@Inject(SolanaService) private readonly solana: SolanaService) {}

   async execute(): Promise<PassQuote> {
      return (await this.solana.loadPassState()).quote;
   }
}
