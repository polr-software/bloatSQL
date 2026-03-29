import { ApplySchemaOperationsResult } from '../../types/tableStructure';

type SchemaMutationFailure = NonNullable<ApplySchemaOperationsResult['failure']>;

function getFailureOrFallback(
  result: Pick<ApplySchemaOperationsResult, 'rolledBack' | 'failure'>
): string {
  if (!result.failure) {
    return result.rolledBack
      ? 'Structure changes failed and the transaction was rolled back.'
      : 'Structure changes failed.';
  }

  return result.failure.message;
}

export function formatSchemaMutationError(
  result: Pick<ApplySchemaOperationsResult, 'rolledBack' | 'failure'>
): string {
  const failure = result.failure;
  if (!failure) {
    return getFailureOrFallback(result);
  }

  const parts = [failure.message];

  if (failure.detail) {
    parts.push(`Detail: ${failure.detail}`);
  }

  if (failure.hint) {
    parts.push(`Hint: ${failure.hint}`);
  }

  if (failure.failedStatement) {
    parts.push(`SQL: ${failure.failedStatement}`);
  }

  parts.push(
    result.rolledBack
      ? 'Rollback: transaction reverted all changes.'
      : 'Rollback: not performed, partial changes may have been applied.'
  );

  return parts.join('\n\n');
}

export function getSchemaMutationFailureNotification(
  result: Pick<ApplySchemaOperationsResult, 'rolledBack' | 'executedOperations' | 'totalOperations'>
): string {
  return result.rolledBack
    ? `Failed on operation ${result.executedOperations + 1}/${result.totalOperations}. Transaction was rolled back.`
    : `Applied ${result.executedOperations}/${result.totalOperations} operations. Partial changes may remain.`;
}

export function getSchemaMutationSuccessNotification(executedOperations: number): string {
  return `Applied ${executedOperations} structure change${executedOperations !== 1 ? 's' : ''}`;
}

export type { SchemaMutationFailure };
