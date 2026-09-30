import {
  deriveTaskPackRevisionReviewState,
  mapTaskPackAggregatePersistenceRow,
  mapTaskPackRevisionPersistenceRow,
  mapTaskPackReviewEventPersistenceRow,
  type TaskPackAggregatePersistenceRow,
  type TaskPackRevisionPersistenceRow,
  type TaskPackReviewEventPersistenceRow,
} from "./taskPackLifecyclePersistence.js";
import {
  TaskPackCurrentStateStorageError,
  type TaskPackCurrentWorkflowSnapshot,
  type TaskPackRevisionReviewEventRecord,
} from "./types.js";

/** One statement = one database snapshot on both engines, including zero-event packs.
 * Do not add ownership predicates to the LEFT JOINs: corrupt foreign references
 * must reach validation, not silently turn into an absent revision/history.
 */
export const TASK_PACK_CURRENT_WORKFLOW_SQL = `
  SELECT tp.id AS aggregate_id, tp.project_id AS aggregate_project_id,
         tp.title AS aggregate_title, tp.lifecycle_state AS aggregate_lifecycle_state,
         tp.archived_from_state AS aggregate_archived_from_state,
         tp.current_revision_id AS aggregate_current_revision_id,
         tp.accepted_revision_id AS aggregate_accepted_revision_id,
         tp.lifecycle_version AS aggregate_lifecycle_version,
         tp.created_at AS aggregate_created_at, tp.updated_at AS aggregate_updated_at,
         tp.completed_at AS aggregate_completed_at, tp.archived_at AS aggregate_archived_at,
         r.*,
         e.id AS review_id, e.task_pack_id AS review_task_pack_id,
         e.revision_id AS review_revision_id, e.event_type AS review_event_type,
         e.from_state AS review_from_state, e.to_state AS review_to_state,
         e.source AS review_source, e.actor_id AS review_actor_id,
         e.created_at AS review_created_at, e.metadata AS review_metadata
  FROM task_packs tp
  LEFT JOIN task_pack_revisions r ON r.id = tp.current_revision_id
  LEFT JOIN task_pack_revision_review_events e ON e.revision_id = tp.current_revision_id
  ORDER BY tp.created_at DESC, tp.id ASC, e.created_at ASC, e.id ASC;
`;

function prefixedRow(row: Record<string, unknown>, prefix: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value]));
}

/** Pure mapping/validation only. Query/driver failures are deliberately outside
 * this boundary, so they cannot be mislabeled as persisted-state corruption.
 */
export function mapTaskPackCurrentWorkflowRows(
  rows: readonly Record<string, unknown>[],
): TaskPackCurrentWorkflowSnapshot[] {
  try {
    const snapshots = new Map<number, TaskPackCurrentWorkflowSnapshot>();
    const histories = new Map<number, TaskPackRevisionReviewEventRecord[]>();
    for (const row of rows) {
      const taskPackId = Number(row.aggregate_id);
      if (!snapshots.has(taskPackId)) {
        const aggregate = mapTaskPackAggregatePersistenceRow(
          prefixedRow(row, "aggregate_") as TaskPackAggregatePersistenceRow,
        );
        if (aggregate.lifecycle.archivedFromState !== row.aggregate_archived_from_state) {
          throw new TaskPackCurrentStateStorageError();
        }
        if (row.id === null) throw new TaskPackCurrentStateStorageError();
        const revision = mapTaskPackRevisionPersistenceRow(row as TaskPackRevisionPersistenceRow);
        if (revision.id !== aggregate.currentRevisionId || revision.taskPackId !== aggregate.id) {
          throw new TaskPackCurrentStateStorageError();
        }
        const reviewEvents: TaskPackRevisionReviewEventRecord[] = [];
        histories.set(taskPackId, reviewEvents);
        snapshots.set(taskPackId, { aggregate, revision, reviewEvents });
      }
      if (row.review_id !== null) {
        histories.get(taskPackId)!.push(mapTaskPackReviewEventPersistenceRow(
          prefixedRow(row, "review_") as TaskPackReviewEventPersistenceRow,
        ));
      }
    }
    for (const { aggregate, revision, reviewEvents } of snapshots.values()) {
      // Includes ownership, canonical content hash and complete-chain validation.
      deriveTaskPackRevisionReviewState(aggregate, revision, reviewEvents);
    }
    return [...snapshots.values()]; // SQL order, not numeric object-key enumeration.
  } catch {
    // Existing mappers can throw ordinary Errors for malformed JSON/timestamps.
    // This block performs no I/O and attaches no private message/cause.
    throw new TaskPackCurrentStateStorageError();
  }
}
