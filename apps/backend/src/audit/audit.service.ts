import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditQueryDto } from './dto/audit.dto';
import { publicAuditMetadata } from './audit-metadata';
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  async list(query: AuditQueryDto) {
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo = query.dateTo ? new Date(query.dateTo) : undefined;
    if (dateFrom && dateTo && dateFrom >= dateTo)
      throw new BadRequestException('dateTo debe ser posterior a dateFrom');
    const where: Prisma.AuditLogWhereInput = {
      actorType: query.actorType,
      actorId: query.actorId,
      entity: query.entityType,
      entityId: query.entityId,
      action: query.action,
      ...(dateFrom || dateTo
        ? { createdAt: { gte: dateFrom, lt: dateTo } }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.auditLog.count({ where });
        const rows = await tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          select: {
            id: true,
            actorType: true,
            actorId: true,
            action: true,
            entity: true,
            entityId: true,
            metadata: true,
            createdAt: true,
          },
        });
        const items = rows.map(({ entity, metadata, ...row }) => ({
          ...row,
          entityType: entity,
          metadata: publicAuditMetadata(row.action, metadata),
        }));
        return {
          items,
          meta: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
