import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma.service';
import { Clock } from '../src/time/clock';

export const QR_NOW = new Date('2035-01-10T13:00:00.000Z');
export class QrClock implements Clock {
  value = new Date(QR_NOW);
  now() {
    return new Date(this.value);
  }
  set(value: Date) {
    this.value = new Date(value);
  }
}

export async function qrFixture(prisma: PrismaService, scheduleId?: string) {
  const student = await prisma.student.create({
    data: {
      fullName: 'QR ' + randomUUID(),
      createdAt: new Date('2035-01-01T00:00:00Z'),
    },
  });
  const plan = await prisma.plan.create({
    data: { name: 'QR ' + randomUUID(), classCount: 4, price: '100.00' },
  });
  const subscription = await prisma.subscription.create({
    data: {
      studentId: student.id,
      planId: plan.id,
      planName: plan.name,
      agreedPrice: plan.price,
      classAllowance: 4,
      currency: 'ARS',
      periodStart: new Date('2035-01-01T00:00:00Z'),
      periodEnd: new Date('2035-02-01T00:00:00Z'),
    },
  });
  const schedule = scheduleId
    ? { id: scheduleId }
    : await prisma.schedule.create({
        data: {
          dayOfWeek: 3,
          startMinute: 600,
          endMinute: 660,
          defaultCapacity: 30,
        },
      });
  await prisma.enrollment.create({
    data: {
      studentId: student.id,
      subscriptionId: subscription.id,
      scheduleId: schedule.id,
      validFrom: new Date('2035-01-01T00:00:00Z'),
      validUntil: new Date('2035-02-01T00:00:00Z'),
    },
  });
  const session = await prisma.classSession.upsert({
    where: {
      scheduleId_occurrenceDate: {
        scheduleId: schedule.id,
        occurrenceDate: new Date('2035-01-10T00:00:00Z'),
      },
    },
    update: {},
    create: {
      scheduleId: schedule.id,
      occurrenceDate: new Date('2035-01-10T00:00:00Z'),
      startAt: QR_NOW,
      endAt: new Date('2035-01-10T14:00:00Z'),
      capacity: 30,
    },
  });
  return { student, subscription, session };
}
