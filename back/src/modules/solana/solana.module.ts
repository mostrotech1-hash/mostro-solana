import { Global, Module } from "@nestjs/common";
import { PurchaseTransactionBuilder } from "./purchase-transaction.builder";
import { SolanaService } from "./solana.service";
import { TokenPurchaseBuilder } from "./token-purchase.builder";

@Global()
@Module({ providers: [SolanaService, PurchaseTransactionBuilder, TokenPurchaseBuilder], exports: [SolanaService, PurchaseTransactionBuilder, TokenPurchaseBuilder] })
export class SolanaModule {}
