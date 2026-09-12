import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MarkPresentDto } from './dto/attendance-challenge.dto';
import { AttendanceRateGuard } from './attendance-rate.guard';
import { StudentGuard } from '../auth/guards/student.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { AttendanceService } from './attendance.service';
import {
  ClassAllowanceSummaryDto,
  MarkAttendanceResponseDto,
  StudentAttendanceResponseDto,
  UpcomingClassSessionsQueryDto,
  UpcomingClassSessionsResponseDto,
} from './dto/attendance.dto';

@ApiTags('student-attendance')
@ApiCookieAuth('session')
@UseGuards(StudentGuard)
@Controller('student')
export class StudentAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('class-sessions/upcoming')
  @ApiOperation({ summary: 'Consultar próximas clases propias y su ventana' })
  @ApiResponse({ status: 200, type: UpcomingClassSessionsResponseDto })
  upcoming(
    @CurrentUser() student: AuthenticatedUser,
    @Query() query: UpcomingClassSessionsQueryDto,
  ) {
    return this.attendance.upcoming(student.id, query);
  }

  @Post('class-sessions/:classSessionId/attendance')
  @UseGuards(AttendanceRateGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar PRESENT propio con challenge QR vigente',
  })
  @ApiParam({ name: 'classSessionId', format: 'uuid' })
  @ApiResponse({ status: 200, type: MarkAttendanceResponseDto })
  mark(
    @Param('classSessionId', ParseUUIDPipe) classSessionId: string,
    @CurrentUser() student: AuthenticatedUser,
    @Body() body: MarkPresentDto,
  ) {
    return this.attendance.markPresent(
      classSessionId,
      student.id,
      body.challenge,
    );
  }

  @Get('class-sessions/:classSessionId/attendance')
  @ApiOperation({ summary: 'Consultar la asistencia propia de una clase' })
  @ApiParam({ name: 'classSessionId', format: 'uuid' })
  @ApiResponse({ status: 200, type: StudentAttendanceResponseDto })
  getAttendance(
    @Param('classSessionId', ParseUUIDPipe) classSessionId: string,
    @CurrentUser() student: AuthenticatedUser,
  ) {
    return this.attendance.getStudentAttendance(classSessionId, student.id);
  }

  @Get('subscriptions/:subscriptionId/class-summary')
  @ApiOperation({ summary: 'Consultar clases usadas y restantes propias' })
  @ApiParam({ name: 'subscriptionId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ClassAllowanceSummaryDto })
  classSummary(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @CurrentUser() student: AuthenticatedUser,
  ) {
    return this.attendance.getClassSummary(subscriptionId, student.id);
  }
}
