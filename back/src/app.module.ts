import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./modules/database/database.module";
import { OpenfortModule } from "./modules/openfort/openfort.module";
import { StorageModule } from "./modules/storage/storage.module";
import { MoonpayModule } from "./use-cases/moonpay/moonpay.module";
import { UsersModule } from "./use-cases/users/users.module";
import { WalletModule } from "./use-cases/wallet/wallet.module";

@Module({ imports: [ConfigModule, DatabaseModule, OpenfortModule, StorageModule, UsersModule, WalletModule, MoonpayModule] })
export class AppModule {}
