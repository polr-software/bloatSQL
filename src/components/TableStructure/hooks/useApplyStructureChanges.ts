import { useCallback, useState } from 'react';
import { tauriCommands } from '../../../tauri/commands';
import {
  AlterColumnOperation,
  ApplySchemaOperationsResult,
} from '../../../types/tableStructure';

interface UseApplyStructureChangesResult {
  applyChanges: (
    tableName: string,
    operations: AlterColumnOperation[]
  ) => Promise<ApplySchemaOperationsResult>;
  isApplying: boolean;
}

export function useApplyStructureChanges(): UseApplyStructureChangesResult {
  const [isApplying, setIsApplying] = useState(false);

  const applyChanges = useCallback(
    async (
      tableName: string,
      operations: AlterColumnOperation[]
    ): Promise<ApplySchemaOperationsResult> => {
      if (operations.length === 0) {
        return {
          success: true,
          totalOperations: 0,
          executedOperations: 0,
          rolledBack: false,
        };
      }

      setIsApplying(true);

      try {
        return await tauriCommands.applySchemaOperations({ tableName, operations });
      } finally {
        setIsApplying(false);
      }
    },
    []
  );

  return { applyChanges, isApplying };
}
