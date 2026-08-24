import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { RUNTIME_ENVIRONMENT } from '@queueforge/application';
import { ApplicationError } from '@queueforge/application';
import type { RuntimeEnvironment } from '@queueforge/config';
import { MetricsService } from '@queueforge/observability';

import { Public } from '../common/http-context.js';
import { DependencyProbeService } from './dependency-probe.service.js';
import { ApiQueueForgeJsonResponse, ApiQueueForgeTextResponse } from '../openapi/decorators.js';
import { HEALTH_LIVE_SCHEMA, HEALTH_READY_SCHEMA } from '../openapi/schemas.js';

const SERVICE_VERSION = '0.1.0';

interface LiveHealth {
  readonly service: string;
  readonly status: 'ok';
  readonly timestamp: string;
  readonly version: string;
}

interface ReadyHealth extends LiveHealth {
  readonly dependencies: {
    readonly database: 'ready';
    readonly redis: 'ready';
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  public constructor(private readonly probes: DependencyProbeService) {}

  @Public()
  @Get('live')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Process liveness probe' })
  @ApiQueueForgeJsonResponse({
    description: 'The API process is alive.',
    schema: HEALTH_LIVE_SCHEMA,
  })
  public live(): LiveHealth {
    return {
      status: 'ok',
      service: 'queueforge-api',
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'PostgreSQL and Redis readiness probe' })
  @ApiQueueForgeJsonResponse({
    description: 'The API and all required dependencies are ready.',
    schema: HEALTH_READY_SCHEMA,
  })
  public async ready(): Promise<ReadyHealth> {
    const readiness = await this.probes.readiness();
    if (!readiness.ready) {
      throw new ApplicationError('DEPENDENCY_UNAVAILABLE', 'A required dependency is unavailable', {
        database: readiness.database,
        redis: readiness.redis,
      });
    }
    return {
      status: 'ok',
      service: 'queueforge-api',
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString(),
      dependencies: { database: 'ready', redis: 'ready' },
    };
  }
}

@ApiTags('observability')
@Controller()
export class MetricsController {
  public constructor(
    private readonly metrics: MetricsService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  @Public()
  @Get('metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Prometheus metrics; bearer-protected in production' })
  @ApiBearerAuth('metricsBearer')
  @ApiQueueForgeTextResponse('Prometheus text exposition format.')
  public async render(
    @Headers('authorization') authorization: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (this.environment.NODE_ENV === 'production') {
      const expected = this.environment.METRICS_TOKEN;
      if (expected === undefined || authorization !== `Bearer ${expected}`) {
        throw new ApplicationError('AUTHENTICATION_REQUIRED', 'Metrics bearer token is required');
      }
    }
    response.setHeader('Content-Type', this.metrics.contentType);
    response.send(await this.metrics.render());
  }
}
