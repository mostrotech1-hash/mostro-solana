import { Global, Module } from "@nestjs/common";
import { PurchaseTransactionBuilder } from "./purchase-transaction.builder";
import { SolanaService } from "./solana.service";

@Global()
@Module({ providers: [SolanaService, PurchaseTransactionBuilder], exports: [SolanaService, PurchaseTransactionBuilder] })
export class SolanaModule {}
