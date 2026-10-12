import { Module } from "@nestjs/common";
import { MoonpayUrlService } from "../../modules/moonpay/moonpay-url.service";
import { UsersModule } from "../users/users.module";
import { MoonpayController } from "./moonpay.controller";
import { PrepareWidgetUseCase } from "./prepare-widget.use-case";
import { SignWidgetUrlUseCase } from "./sign-widget-url.use-case";

@Module({ imports: [UsersModule], controllers: [MoonpayController], providers: [PrepareWidgetUseCase, SignWidgetUrlUseCase, MoonpayUrlService] })
export class MoonpayModule {}
