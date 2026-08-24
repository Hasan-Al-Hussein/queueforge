import { Module } from '@nestjs/common';
import { ApolloDriver } from '@nestjs/apollo';
import type { ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { depthLimit } from '@graphile/depth-limit';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';
import { GraphQLError } from 'graphql';
import type { ASTVisitor, DocumentNode, GraphQLSchema, ValidationContext } from 'graphql';
import type { Response } from 'express';

import { loadRuntimeEnvironment } from '@queueforge/config';
import { ErrorCodeSchema } from '@queueforge/contracts';

import type { QueueForgeRequest } from '../common/http-context.js';

const MAX_ALIASES = 20;
const MAX_COMPLEXITY = 200;
const MAX_QUERY_NODES = 1_000;
const graphqlEnvironment = loadRuntimeEnvironment();
const complexityEstimators = [
  fieldExtensionsEstimator(),
  simpleEstimator({ defaultComplexity: 1 }),
] as const;

function aliasLimitRule(context: ValidationContext): ASTVisitor {
  let aliases = 0;
  return {
    Field(node) {
      if (node.alias === undefined) return;
      aliases += 1;
      if (aliases === MAX_ALIASES + 1) {
        context.reportError(
          new GraphQLError(`GraphQL operations may use at most ${String(MAX_ALIASES)} aliases`, {
            nodes: node,
          }),
        );
      }
    },
  };
}

export function assertGraphqlComplexity(input: {
  readonly document: DocumentNode;
  readonly operationName?: string;
  readonly schema: GraphQLSchema;
  readonly variables?: Record<string, unknown>;
}): void {
  const complexity = getComplexity({
    estimators: [...complexityEstimators],
    schema: input.schema,
    query: input.document,
    variables: input.variables,
    operationName: input.operationName,
    maxQueryNodes: MAX_QUERY_NODES,
  });
  if (complexity > MAX_COMPLEXITY) {
    throw new GraphQLError('GraphQL operation exceeds the complexity limit', {
      extensions: { code: 'GRAPHQL_COMPLEXITY_LIMIT' },
    });
  }
}

type ApolloDriverPlugin = NonNullable<ApolloDriverConfig['plugins']>[number];

const complexityPlugin: ApolloDriverPlugin = {
  async requestDidStart() {
    await Promise.resolve();
    return {
      async didResolveOperation(requestContext) {
        assertGraphqlComplexity({
          schema: requestContext.schema,
          document: requestContext.document,
          variables: requestContext.request.variables,
          operationName: requestContext.request.operationName ?? undefined,
        });
        await Promise.resolve();
      },
    };
  },
};

export function enrichGraphqlError(error: GraphQLError, request: QueueForgeRequest): void {
  const parsedCode = ErrorCodeSchema.safeParse(error.extensions.code);
  Object.assign(error.extensions, {
    code: parsedCode.success ? parsedCode.data : 'VALIDATION_FAILED',
    correlationId: request.correlationId,
    requestId: request.requestId,
  });
}

const errorEnvelopePlugin: ApolloDriverPlugin = {
  async requestDidStart() {
    await Promise.resolve();
    return {
      async didEncounterErrors(requestContext) {
        const context = requestContext.contextValue as { readonly req?: QueueForgeRequest };
        if (context.req === undefined) return;
        for (const error of requestContext.errors) {
          enrichGraphqlError(error, context.req);
        }
        await Promise.resolve();
      },
    };
  },
};

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      autoSchemaFile: true,
      buildSchemaOptions: { dateScalarMode: 'isoDate', noDuplicatedFields: true },
      context: ({ req, res }: { req: QueueForgeRequest; res: Response }) => ({ req, res }),
      csrfPrevention: true,
      driver: ApolloDriver,
      graphiql: graphqlEnvironment.NODE_ENV !== 'production',
      includeStacktraceInErrorResponses: false,
      introspection: graphqlEnvironment.NODE_ENV !== 'production',
      path: '/graphql',
      plugins: [complexityPlugin, errorEnvelopePlugin],
      sortSchema: true,
      validationRules: [
        depthLimit({ maxDepth: 8, maxListDepth: 3, revealDetails: false }),
        aliasLimitRule,
      ],
    }),
  ],
})
export class GraphqlApiModule {}
