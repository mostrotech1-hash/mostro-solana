import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./modules/database/database.module";
import { OpenfortModule } from "./modules/openfort/openfort.module";
import { SolanaModule } from "./modules/solana/solana.module";
import { StorageModule } from "./modules/storage/storage.module";
import { MoonpayModule } from "./use-cases/moonpay/moonpay.module";
import { KycModule } from "./use-cases/kyc/kyc.module";
import { PassModule } from "./use-cases/pass/pass.module";
import { TokensModule } from "./use-cases/tokens/tokens.module";
import { UsersModule } from "./use-cases/users/users.module";
import { WalletModule } from "./use-cases/wallet/wallet.module";

@Module({ imports: [ConfigModule, DatabaseModule, OpenfortModule, StorageModule, SolanaModule, UsersModule, WalletModule, MoonpayModule, PassModule, KycModule, TokensModule] })
export class AppModule {}
