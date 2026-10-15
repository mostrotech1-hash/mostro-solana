import { Module } from "@nestjs/common";
import { OpenfortModule } from "../../modules/openfort/openfort.module";
import { SumsubModule } from "../../modules/sumsub/sumsub.module";
import { UsersModule } from "../users/users.module";
import { KycController } from "./kyc.controller";
import { CreateKycAccessTokenUseCase, GetKycStatusUseCase, HandleSumsubWebhookUseCase } from "./kyc.use-cases";

@Module({
   imports: [UsersModule, SumsubModule, OpenfortModule],
   controllers: [KycController],
   providers: [CreateKycAccessTokenUseCase, GetKycStatusUseCase, HandleSumsubWebhookUseCase],
})
export class KycModule {}
