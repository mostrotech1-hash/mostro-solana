import { Module } from "@nestjs/common";
import { CreateEncryptionSessionUseCase } from "./create-encryption-session.use-case";
import { WalletController } from "./wallet.controller";

@Module({ controllers: [WalletController], providers: [CreateEncryptionSessionUseCase] })
export class WalletModule {}
