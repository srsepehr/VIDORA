export interface CheckoutRequest {
  planSlug: string;
  returnTo: string;
}

export interface PaymentAdapter {
  startCheckout(request: CheckoutRequest): Promise<never>;
}

export class PaymentNotConfiguredError extends Error {
  readonly code = "PAYMENT_NOT_CONFIGURED";
  readonly messageFa = "درگاه پرداخت هنوز متصل نشده است. انتخاب شما حفظ شده و پس از راه‌اندازی پرداخت قابل ادامه خواهد بود.";

  constructor() {
    super("No verified payment provider is configured");
    this.name = "PaymentNotConfiguredError";
  }
}

class UnavailablePaymentAdapter implements PaymentAdapter {
  async startCheckout(_request: CheckoutRequest): Promise<never> {
    throw new PaymentNotConfiguredError();
  }
}

export const paymentAdapter: PaymentAdapter = new UnavailablePaymentAdapter();
