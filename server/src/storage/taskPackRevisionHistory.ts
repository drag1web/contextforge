import { isDeepStrictEqual } from "node:util";
import {
  assertTaskPackAggregate,
  assertTaskPackRevision,
  type TaskPackReviewState,
} from "../taskPacks/taskPackLifecycle.js";
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
  TaskPackRevisionHistoryStorageError,
  type TaskPackRevisionHistorySnapshot,
  type TaskPackRevisionReviewEventRecord,
} from "./types.js";

/** One scoped statement on either engine. Orphan/foreign review events must
 * reach validation too, not disappear through an ownership-filtered JOIN.
 * The orphan branch only affects corrupt persistence; valid events join once.
 * Native created_at/id order is retained, including each database's collation.
 */
export function taskPackRevisionHistorySql(parameter: "?" | "$1"): string {
  return `
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
    LEFT JOIN task_pack_revisions r ON r.task_pack_id = tp.id
    LEFT JOIN task_pack_revision_review_events e ON e.revision_id = r.id
      OR (e.task_pack_id = tp.id AND NOT EXISTS (
        SELECT 1 FROM task_pack_revisions owned
        WHERE owned.id = e.revision_id AND owned.task_pack_id = tp.id
      ))
    WHERE tp.id = ${parameter}
    ORDER BY r.revision_number ASC, r.id ASC, e.created_at ASC, e.id ASC;
  `;
}

function prefixedRow(row: Record<string, unknown>, prefix: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, value]) => [key.slice(prefix.length), value]));
}

/** Pure validation/replay, shared by storage and the application projection.
 * No I/O here: mapping/domain failures are corruption, driver failures are not.
 * Revision numbers must start at 1 and increase; no invented contiguous-number
 * policy or current-is-latest assumption beyond the existing domain contract.
 */
export function validateTaskPackRevisionHistorySnapshot(
  taskPackId: number,
  snapshot: TaskPackRevisionHistorySnapshot,
): TaskPackReviewState[] {
  try {
    const { aggregate, revisions } = snapshot;
    assertTaskPackAggregate(aggregate);
    if (aggregate.id !== taskPackId || revisions.length === 0) throw new TaskPackRevisionHistoryStorageError();
    const byId = new Map<number, TaskPackRevisionHistorySnapshot["revisions"][number]>();
    let previousNumber = 0;
    for (const item of revisions) {
      const { revision } = item;
      assertTaskPackRevision(revision, { aggregate, verifyContentHash: true });
      if (byId.has(revision.id) || revision.revisionNumber <= previousNumber ||
        (previousNumber === 0 && revision.revisionNumber !== 1)) {
        throw new TaskPackRevisionHistoryStorageError();
      }
      byId.set(revision.id, item);
      previousNumber = revision.revisionNumber;
    }
    if (!byId.has(aggregate.currentRevisionId) ||
      (aggregate.acceptedRevisionId !== null && !byId.has(aggregate.acceptedRevisionId))) {
      throw new TaskPackRevisionHistoryStorageError();
    }
    const eventIds = new Set<string>();
    return revisions.map(({ revision, reviewEvents }) => {
      if (revision.baseRevisionId !== null) {
        const base = byId.get(revision.baseRevisionId)?.revision;
        if (!base) throw new TaskPackRevisionHistoryStorageError();
        assertTaskPackRevision(revision, { aggregate, baseRevision: base, verifyContentHash: true });
      }
      for (const event of reviewEvents) {
        if (eventIds.has(event.id)) throw new TaskPackRevisionHistoryStorageError();
        eventIds.add(event.id);
      }
      return deriveTaskPackRevisionReviewState(aggregate, revision, reviewEvents);
    });
  } catch {
    // Only pure validation; never attach raw content, messages, causes or SQL.
    throw new TaskPackRevisionHistoryStorageError();
  }
}

export function mapTaskPackRevisionHistoryRows(
  taskPackId: number,
  rows: readonly Record<string, unknown>[],
): TaskPackRevisionHistorySnapshot | null {
  try {
    if (!Number.isSafeInteger(taskPackId) || taskPackId < 1) throw new TaskPackRevisionHistoryStorageError();
    if (rows.length === 0) return null;
    const aggregateRow = prefixedRow(rows[0], "aggregate_");
    const aggregate = mapTaskPackAggregatePersistenceRow(aggregateRow as TaskPackAggregatePersistenceRow);
    // The existing mapper intentionally normalizes non-archived lifecycle; do
    // not let that hide an impossible archived_from_state column here.
    if (aggregate.lifecycle.archivedFromState !== aggregateRow.archived_from_state) {
      throw new TaskPackRevisionHistoryStorageError();
    }
    const revisions: { revision: TaskPackRevisionHistorySnapshot["revisions"][number]["revision"];
      reviewEvents: TaskPackRevisionReviewEventRecord[] }[] = [];
    const byId = new Map<number, typeof revisions[number]>();
    const rawRevisions = new Map<number, Record<string, unknown>>();
    for (const row of rows) {
      if (!isDeepStrictEqual(prefixedRow(row, "aggregate_"), aggregateRow) || row.id === null) {
        throw new TaskPackRevisionHistoryStorageError();
      }
      const revisionRow = Object.fromEntries(Object.entries(row)
        .filter(([key]) => !key.startsWith("aggregate_") && !key.startsWith("review_")));
      const id = Number(row.id);
      let item = byId.get(id);
      if (!item) {
        item = { revision: mapTaskPackRevisionPersistenceRow(revisionRow as TaskPackRevisionPersistenceRow), reviewEvents: [] };
        byId.set(id, item);
        rawRevisions.set(id, revisionRow);
        revisions.push(item);
      } else if (revisions[revisions.length - 1] !== item || row.review_id === null || item.reviewEvents.length === 0 ||
        !isDeepStrictEqual(rawRevisions.get(id), revisionRow)) {
        throw new TaskPackRevisionHistoryStorageError();
      }
      if (row.review_id !== null) {
        item.reviewEvents.push(mapTaskPackReviewEventPersistenceRow(
          prefixedRow(row, "review_") as TaskPackReviewEventPersistenceRow,
        ));
      } else if (item.reviewEvents.length > 0) {
        throw new TaskPackRevisionHistoryStorageError();
      }
    }
    const snapshot = { aggregate, revisions };
    validateTaskPackRevisionHistorySnapshot(taskPackId, snapshot);
    return snapshot;
  } catch {
    throw new TaskPackRevisionHistoryStorageError();
  }
}
