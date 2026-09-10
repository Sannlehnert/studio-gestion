import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { activePeriodAt } from './student-status-history';

type PrismaClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class StudentStatusHistoryService {
  activeAtWhere(instant: Date): Prisma.StudentWhereInput {
    return { activePeriods: { some: activePeriodAt(instant) } };
  }

  async wasActiveAt(
    client: PrismaClient,
    studentId: string,
    instant: Date,
  ): Promise<boolean> {
    return (
      (await client.studentActivePeriod.count({
        where: { studentId, ...activePeriodAt(instant) },
      })) > 0
    );
  }
}
