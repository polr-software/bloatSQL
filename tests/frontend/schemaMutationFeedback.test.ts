import { describe, expect, test } from 'bun:test';
import {
  formatSchemaMutationError,
  getSchemaMutationFailureNotification,
  getSchemaMutationSuccessNotification,
} from '../../src/components/StructureEditor/schemaMutationFeedback';

describe('schemaMutationFeedback', () => {
  test('formats rollback failure with SQL details', () => {
    const message = formatSchemaMutationError({
      rolledBack: true,
      failure: {
        failedOperationIndex: 0,
        failedOperationType: 'MODIFY_COLUMN',
        message: 'Type change failed',
        detail: 'column contains incompatible values',
        hint: 'Clean the data before retrying',
        failedStatement: 'ALTER TABLE "users" ALTER COLUMN "age" TYPE INT',
      },
    });

    expect(message).toContain('Type change failed');
    expect(message).toContain('Detail: column contains incompatible values');
    expect(message).toContain('Hint: Clean the data before retrying');
    expect(message).toContain('SQL: ALTER TABLE "users" ALTER COLUMN "age" TYPE INT');
    expect(message).toContain('Rollback: transaction reverted all changes.');
  });

  test('formats partial-apply failure without rollback', () => {
    const message = formatSchemaMutationError({
      rolledBack: false,
      failure: {
        failedOperationIndex: 1,
        failedOperationType: 'DROP_COLUMN',
        message: 'Drop failed',
      },
    });

    expect(message).toContain('Drop failed');
    expect(message).toContain(
      'Rollback: not performed, partial changes may have been applied.'
    );
  });

  test('builds notifications for failure and success states', () => {
    expect(
      getSchemaMutationFailureNotification({
        rolledBack: true,
        executedOperations: 1,
        totalOperations: 3,
      })
    ).toBe('Failed on operation 2/3. Transaction was rolled back.');

    expect(
      getSchemaMutationFailureNotification({
        rolledBack: false,
        executedOperations: 1,
        totalOperations: 3,
      })
    ).toBe('Applied 1/3 operations. Partial changes may remain.');

    expect(getSchemaMutationSuccessNotification(1)).toBe('Applied 1 structure change');
    expect(getSchemaMutationSuccessNotification(2)).toBe('Applied 2 structure changes');
  });
});
