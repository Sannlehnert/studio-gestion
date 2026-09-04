import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiProperty,
} from '@nestjs/swagger';

class HealthResponseDto {
  @ApiProperty({ enum: ['ok'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
