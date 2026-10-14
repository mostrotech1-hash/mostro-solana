import { Inject, Injectable } from "@nestjs/common";
import type { SignMoonpayUrlRequest, SignMoonpayUrlResponse } from "@mostro/shared/api";
import { MoonpayUrlService } from "../../modules/moonpay/moonpay-url.service";
import type { OpenfortIdentity } from "../../modules/openfort/openfort.service";

@Injectable()
export class SignWidgetUrlUseCase {
   constructor(@Inject(MoonpayUrlService) private readonly moonpay: MoonpayUrlService) {}

   execute(identity: OpenfortIdentity, request: SignMoonpayUrlRequest): SignMoonpayUrlResponse {
      return { signature: this.moonpay.sign(request.urlForSignature, request.preparationToken, identity.openfortId) };
   }
}
