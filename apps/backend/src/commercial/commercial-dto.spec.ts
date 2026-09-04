import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterPaymentDto } from '../payments/dto/payment.dto';
import { CreatePlanDto } from '../plans/dto/plan.dto';
import { CreateSubscriptionDto } from '../subscriptions/dto/subscription.dto';

describe('commercial DTO boundaries', () => {
  it.each(['-1', '100000000.00', '1.234', 10])(
    'rejects invalid plan price %s',
    async (price) => {
      const dto = plainToInstance(CreatePlanDto, {
        name: 'Plan válido',
        classCount: 8,
        price,
      });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it.each(['0', '-1', '0.001', '100000000.00', 1])(
    'rejects invalid payment amount %s',
    async (amount) => {
      const dto = plainToInstance(RegisterPaymentDto, {
        amount,
        paidAt: '2026-09-04T12:00:00Z',
      });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );

  it('requires explicit timezone on subscription periods', async () => {
    const dto = plainToInstance(CreateSubscriptionDto, {
      studentId: '811c2d07-6212-4d45-a9aa-516543cad8c7',
      planId: '4c124740-1810-4e75-875a-f7bd8286be3f',
      periodStart: '2026-09-01T00:00:00',
      periodEnd: '2026-10-01',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
