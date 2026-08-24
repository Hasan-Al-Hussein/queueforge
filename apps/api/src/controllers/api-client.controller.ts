import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiClientService } from '@queueforge/application';
import type { TenantContext } from '@queueforge/contracts';

import { CurrentTenant, RequestCorrelationId } from '../common/http-context.js';
import { requireIdempotencyKey } from '../common/request-values.js';
import { CreateApiClientDto } from '../dto.js';
import {
  ApiIdempotencyKey,
  ApiQueueForgeApiKeyAlternative,
  ApiQueueForgeJsonResponse,
} from '../openapi/decorators.js';
import { API_CLIENT_SCHEMA, arraySchema, CREATED_API_CLIENT_SCHEMA } from '../openapi/schemas.js';

@ApiTags('API clients')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('api-clients')
export class ApiClientController {
  public constructor(private readonly apiClients: ApiClientService) {}

  @Get()
  @ApiOperation({ summary: 'List tenant API clients without secret material' })
  @ApiQueueForgeJsonResponse({
    description: 'Tenant API clients without secret material.',
    schema: arraySchema(API_CLIENT_SCHEMA),
  })
  public list(@CurrentTenant() context: TenantContext): ReturnType<ApiClientService['list']> {
    return this.apiClients.list(context);
  }

  @Post()
  @ApiOperation({ summary: 'Create an API client and reveal its key exactly once' })
  @ApiBody({ type: CreateApiClientDto })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Created API client and one-time API key.',
    schema: CREATED_API_CLIENT_SCHEMA,
  })
  public create(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateApiClientDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<ApiClientService['create']> {
    return this.apiClients.create(
      context,
      input,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }

  @Delete(':apiClientId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an API client immediately' })
  @ApiQueueForgeJsonResponse({
    description: 'Revoked API client.',
    schema: API_CLIENT_SCHEMA,
  })
  public revoke(
    @CurrentTenant() context: TenantContext,
    @Param('apiClientId', new ParseUUIDPipe()) apiClientId: string,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<ApiClientService['revoke']> {
    return this.apiClients.revoke(context, apiClientId, correlationId);
  }
}
