import { Module } from "@nestjs/common";
import { BuildSponsoredPurchaseUseCase } from "./build-sponsored-purchase.use-case";
import { GetPassOwnershipUseCase } from "./get-pass-ownership.use-case";
import { GetPassQuoteUseCase } from "./get-pass-quote.use-case";
import { GetPurchaseResultUseCase } from "./get-purchase-result.use-case";
import { PassController } from "./pass.controller";
import { TopupDevnetUseCase } from "./topup-devnet.use-case";

@Module({ controllers: [PassController], providers: [GetPassQuoteUseCase, GetPassOwnershipUseCase, BuildSponsoredPurchaseUseCase, GetPurchaseResultUseCase, TopupDevnetUseCase] })
export class PassModule {}
