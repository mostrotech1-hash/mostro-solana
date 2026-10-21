import { Module } from "@nestjs/common";
import { UsersModule } from "../users/users.module";
import { TokensController } from "./tokens.controller";
import { BuildTokenPurchaseUseCase, GetTokenQuoteUseCase } from "./tokens.use-cases";

@Module({ imports: [UsersModule], controllers: [TokensController], providers: [GetTokenQuoteUseCase, BuildTokenPurchaseUseCase] })
export class TokensModule {}
