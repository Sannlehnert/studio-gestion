import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ListStudentsQueryDto,
  StudentStatusFilter,
} from './list-students-query.dto';
import { CreateStudentDto } from './student-name.dto';

const strict = { whitelist: true, forbidNonWhitelisted: true };

describe('Student DTOs', () => {
  it('normalizes surrounding and repeated whitespace without changing capitalization', async () => {
    const dto = plainToInstance(CreateStudentDto, {
      fullName: '  mARTina   del  Río  ',
    });
    expect(await validate(dto, strict)).toHaveLength(0);
    expect(dto.fullName).toBe('mARTina del Río');
  });

  it.each([
    { fullName: '   ' },
    { fullName: 'x' },
    { fullName: 'x'.repeat(121) },
    { fullName: 123 },
    { fullName: 'Martina', isActive: false },
  ])('rejects an invalid or manipulated creation body', async (body) => {
    expect(
      await validate(plainToInstance(CreateStudentDto, body), strict),
    ).not.toHaveLength(0);
  });

  it('applies documented list defaults and numeric transformations', async () => {
    const defaults = plainToInstance(ListStudentsQueryDto, {});
    expect(await validate(defaults, strict)).toHaveLength(0);
    expect(defaults).toMatchObject({
      status: StudentStatusFilter.ACTIVE,
      page: 1,
      limit: 20,
    });

    const query = plainToInstance(ListStudentsQueryDto, {
      status: 'all',
      page: '2',
      limit: '50',
      search: '  MARTINA ',
    });
    expect(await validate(query, strict)).toHaveLength(0);
    expect(query).toMatchObject({
      status: 'all',
      page: 2,
      limit: 50,
      search: 'MARTINA',
    });
  });

  it.each([
    { page: '0' },
    { page: '1.5' },
    { limit: '101' },
    { status: 'deleted' },
    { search: ' ' },
    { search: 'x'.repeat(81) },
    { role: 'ADMIN' },
  ])('rejects an invalid or manipulated list query', async (query) => {
    expect(
      await validate(plainToInstance(ListStudentsQueryDto, query), strict),
    ).not.toHaveLength(0);
  });
});
