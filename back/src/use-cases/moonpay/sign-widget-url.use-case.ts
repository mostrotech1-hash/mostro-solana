import { Inject, Injectable } from "@nestjs/common";
import type { SignMoonpayUrlRequest, SignMoonpayUrlResponse } from "@mostro/shared/api";
import { MoonpayUrlService } from "../../modules/moonpay/moonpay-url.service";

@Injectable()
export class SignWidgetUrlUseCase {
   constructor(@Inject(MoonpayUrlService) private readonly moonpay: MoonpayUrlService) {}

   execute(request: SignMoonpayUrlRequest): SignMoonpayUrlResponse {
      return { signature: this.moonpay.sign(request.urlForSignature) };
   }
}
