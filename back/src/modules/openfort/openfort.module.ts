import { Global, Module } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { OpenfortService } from "./openfort.service";

@Global()
@Module({ providers: [OpenfortService, AuthGuard], exports: [OpenfortService, AuthGuard] })
export class OpenfortModule {}
