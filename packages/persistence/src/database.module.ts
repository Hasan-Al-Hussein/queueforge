import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { queueForgeDataSourceOptions } from './data-source.js';

@Module({})
export class PersistenceModule {
  public static forRoot(databaseUrl: string, logging = false): DynamicModule {
    return {
      module: PersistenceModule,
      imports: [
        TypeOrmModule.forRoot(
          queueForgeDataSourceOptions({
            databaseUrl,
            includeMigrations: false,
            logging,
            applicationName: 'queueforge-api',
          }),
        ),
      ],
      exports: [TypeOrmModule],
    };
  }
}
