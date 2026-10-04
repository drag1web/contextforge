import type { TaskPackRevisionDetail, TaskPackRevisionDetailItem } from "../types";

export const TASK_PACK_TEXT_DIFF_LIMITS = Object.freeze({ totalCharacters: 120_000, totalLines: 1_200, matrixCells: 250_000 });
export type RevisionChangeKind = "unchanged" | "changed" | "added" | "removed";
export interface RevisionTextLine {
  readonly number: number;
  readonly content: string;
  readonly ending: "" | "\n" | "\r" | "\r\n";
}
export interface RevisionTextDiffRow {
  readonly kind: "equal" | "changed" | "added" | "removed";
  readonly left: RevisionTextLine | null;
  readonly right: RevisionTextLine | null;
}
interface RevisionTextComparisonBase {
  readonly leftText: string;
  readonly rightText: string;
  readonly changed: boolean;
  readonly kind: RevisionChangeKind;
}
export type RevisionTextComparison = RevisionTextComparisonBase & (
  | { readonly mode: "line_diff"; readonly rows: readonly RevisionTextDiffRow[]; readonly matrixCells: number }
  | { readonly mode: "side_by_side"; readonly reason: "characters" | "lines" | "matrix"; readonly matrixCells: 0 }
);
export const TASK_PACK_REVISION_SCALAR_FIELDS = ["taskType", "targetTool", "sourceKind", "generationMode",
  "generationModel", "generationUsedFallback"] as const;
export type RevisionScalarField = typeof TASK_PACK_REVISION_SCALAR_FIELDS[number];
export interface RevisionScalarChange {
  readonly field: RevisionScalarField;
  readonly left: string | boolean | null;
  readonly right: string | boolean | null;
  readonly changed: boolean;
  readonly kind: RevisionChangeKind;
}
export interface TaskPackRevisionComparisonModel {
  readonly leftRevisionId: number;
  readonly rightRevisionId: number;
  readonly scalarChanges: readonly RevisionScalarChange[];
  readonly rawTask: RevisionTextComparison;
  readonly generatedPrompt: RevisionTextComparison;
  readonly hasContentChanges: boolean;
}

/** No normalization: a token includes its original CR/LF/CRLF terminator. Stop before oversized line allocation. */
function lines(text: string, limit: number): RevisionTextLine[] | null {
  const result: RevisionTextLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null && match[0] !== "") {
    if (result.length === limit) return null;
    result.push(Object.freeze({ number: result.length + 1, content: match[1], ending: match[2] as RevisionTextLine["ending"] }));
  }
  return result;
}

/** Exact authored-string equality, then bounded, deterministic LCS over exact line tokens.
 * At most 120k total UTF-16 characters, 1200 total lines, 250k Uint16 cells (~500KB) per text field.
 * Tokens are interned once: the matrix compares integers, not potentially long strings per cell.
 * Budget failure allocates no matrix and keeps both complete source strings for read-only fallback.
 */
export function compareTaskPackRevisionText(leftText: string, rightText: string): RevisionTextComparison {
  const changed = leftText !== rightText;
  const kind: RevisionChangeKind = !changed ? "unchanged" : leftText === "" ? "added" : rightText === "" ? "removed" : "changed";
  const base = { leftText, rightText, changed, kind };
  const fallback = (reason: "characters" | "lines" | "matrix"): RevisionTextComparison =>
    Object.freeze({ ...base, mode: "side_by_side", reason, matrixCells: 0 });
  if (leftText.length + rightText.length > TASK_PACK_TEXT_DIFF_LIMITS.totalCharacters) return fallback("characters");
  const left = lines(leftText, TASK_PACK_TEXT_DIFF_LIMITS.totalLines);
  if (!left) return fallback("lines");
  const right = lines(rightText, TASK_PACK_TEXT_DIFF_LIMITS.totalLines - left.length);
  if (!right) return fallback("lines");
  const width = right.length + 1;
  const matrixCells = (left.length + 1) * width;
  if (matrixCells > TASK_PACK_TEXT_DIFF_LIMITS.matrixCells) return fallback("matrix");
  const tokens = new Map<string, number>();
  const intern = (line: RevisionTextLine) => {
    const raw = line.content + line.ending;
    let id = tokens.get(raw);
    if (id === undefined) { id = tokens.size; tokens.set(raw, id); }
    return id;
  };
  const leftIds = left.map(intern), rightIds = right.map(intern);
  const matrix = new Uint16Array(matrixCells);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      matrix[i * width + j] = leftIds[i] === rightIds[j] ? 1 + matrix[(i + 1) * width + j + 1]
        : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
    }
  }
  const rows: RevisionTextDiffRow[] = [];
  let removed: RevisionTextLine[] = [], added: RevisionTextLine[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(removed.length, added.length); k++) {
      rows.push(Object.freeze({ kind: removed[k] && added[k] ? "changed" : removed[k] ? "removed" : "added",
        left: removed[k] ?? null, right: added[k] ?? null }));
    }
    removed = []; added = [];
  };
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && leftIds[i] === rightIds[j]) {
      flush(); rows.push(Object.freeze({ kind: "equal", left: left[i++], right: right[j++] }));
    } else if (i < left.length && (j === right.length || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])) {
      removed.push(left[i++]); // stable deletion-first tie break
    } else added.push(right[j++]);
  }
  flush();
  return Object.freeze({ ...base, mode: "line_diff", rows: Object.freeze(rows), matrixCells });
}

function scalarChange(field: RevisionScalarField, left: TaskPackRevisionDetailItem, right: TaskPackRevisionDetailItem): RevisionScalarChange {
  const before = left[field], after = right[field];
  const changed = before !== after;
  return Object.freeze({ field, left: before, right: after, changed,
    kind: !changed ? "unchanged" : before === null ? "added" : after === null ? "removed" : "changed" });
}

/** Caller supplies explicit left/base and right/target. Never sort by identity, infer review, or compare private JSON. */
export function compareTaskPackRevisions(left: TaskPackRevisionDetail, right: TaskPackRevisionDetail): TaskPackRevisionComparisonModel {
  if (left.taskPackId !== right.taskPackId) throw new Error("Revision comparison requires the same Task Pack.");
  const scalarChanges = Object.freeze(TASK_PACK_REVISION_SCALAR_FIELDS.map(field => scalarChange(field, left.revision, right.revision)));
  const rawTask = compareTaskPackRevisionText(left.revision.rawTask, right.revision.rawTask);
  const generatedPrompt = compareTaskPackRevisionText(left.revision.generatedPrompt, right.revision.generatedPrompt);
  return Object.freeze({ leftRevisionId: left.revision.id, rightRevisionId: right.revision.id,
    scalarChanges, rawTask, generatedPrompt,
    hasContentChanges: rawTask.changed || generatedPrompt.changed || scalarChanges.some(change => change.changed) });
}
