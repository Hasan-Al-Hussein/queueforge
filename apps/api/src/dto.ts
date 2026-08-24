import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import type { TenantRole } from '@queueforge/contracts';

const TENANT_ROLES = ['viewer', 'approver', 'operator', 'tenant_admin'] as const;
const API_CLIENT_ROLES = ['viewer', 'operator'] as const;

export class SelectTenantDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public tenantId!: string;
}

export class CreateWorkflowDto {
  @ApiProperty({ example: 'expense_review' })
  @Matches(/^[a-z0-9][a-z0-9_-]*$/)
  @Length(2, 100)
  public stableKey!: string;

  @ApiProperty({ example: 'Expense review' })
  @IsString()
  @Length(1, 160)
  public name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  public description?: string | null;
}

export class CreateWebhookEndpointDto {
  @ApiProperty({ example: 'Local verification sink' })
  @IsString()
  @Length(1, 160)
  public name!: string;

  @ApiProperty({ example: 'http://127.0.0.1:3300/webhooks' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2_048)
  public url!: string;

  @ApiProperty({ example: 'local-v1' })
  @Matches(/^[A-Za-z0-9._:-]+$/)
  @Length(2, 80)
  public keyId!: string;
}

export class UpdateWebhookEndpointDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 160)
  public name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2_048)
  public url?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  public active?: boolean;
}

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Operations' })
  @IsString()
  @Length(1, 160)
  public name!: string;

  @ApiProperty({ example: 'acme-operations' })
  @Matches(/^[a-z0-9][a-z0-9-]{1,78}$/)
  public slug!: string;
}

export class CreateMembershipDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  public email!: string;

  @ApiProperty({ enum: TENANT_ROLES })
  @IsIn(TENANT_ROLES)
  public role!: TenantRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 160)
  public displayName?: string;

  @ApiPropertyOptional({ minLength: 12, writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  public initialPassword?: string;
}

export class UpdateMembershipRoleDto {
  @ApiProperty({ enum: TENANT_ROLES })
  @IsIn(TENANT_ROLES)
  public role!: TenantRole;
}

export class MarkNotificationReadDto {
  @ApiProperty({ enum: [true] })
  @IsIn([true])
  public read!: true;
}

export class CreateApiClientDto {
  @ApiProperty({ example: 'Expense submission integration' })
  @IsString()
  @Length(1, 160)
  public name!: string;

  @ApiProperty({ enum: API_CLIENT_ROLES })
  @IsIn(API_CLIENT_ROLES)
  public role!: 'operator' | 'viewer';
}
