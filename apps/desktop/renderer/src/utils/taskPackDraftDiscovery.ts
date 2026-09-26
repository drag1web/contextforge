import type { TaskPackDraftSession, TaskPackPersistedDraftSummary, TaskPackPersistedDraftView } from "../types";
import { isTaskPackDraftSessionDirty } from "./taskPackDraftSession";

type Summary = TaskPackPersistedDraftSummary;
type View = TaskPackPersistedDraftView;
export type DraftDiscoveryIssue = "listFailed" | "detailFailed" | "notFound" | "notActive" |
  "invalidState" | "projectMissing" | "bound" | "conflict" | "activeDraft" | "localChanged" | "busy";
export interface DraftDiscoveryApi {
  listActiveTaskPackDrafts(projectId?: number): Promise<Summary[]>;
  getTaskPackDraft(id: string): Promise<View>;
  discardTaskPackDraft(id: string, version: number): Promise<View>;
}
export interface DraftDiscoveryContext {
  projectIds: readonly number[];
  session: TaskPackDraftSession | null;
  busy: boolean;
  canOffer: boolean;
  restore(view: View): boolean;
}
export type DraftDiscoveryConfirmation =
  | { kind: "replace"; summary: Summary; session: TaskPackDraftSession | null }
  | { kind: "discard"; view: View };
export interface DraftDiscoveryState {
  summaries: readonly Summary[];
  globalKnown: boolean;
  knownProjects: readonly number[];
  scope: number | null;
  open: boolean;
  loading: boolean;
  listIssue: DraftDiscoveryIssue | null;
  selectedId: string | null;
  detail: View | null;
  detailLoading: boolean;
  issue: DraftDiscoveryIssue | null;
  pending: "continuing" | "discarding" | null;
  confirmation: DraftDiscoveryConfirmation | null;
  notice: "restored" | "discarded" | "listFailed" | null;
}

/** Explicit projection even when the caller supplies a full view. Never cache author text. */
export function toActiveDraftSummary(view: Summary): Summary {
  return {
    id: view.id, projectId: view.projectId, projectName: view.projectName,
    taskPackId: view.taskPackId, baseRevisionId: view.baseRevisionId,
    lifecycle: { ...view.lifecycle }, draftVersion: view.draftVersion,
    createdAt: view.createdAt, updatedAt: view.updatedAt, expiresAt: view.expiresAt,
  };
}
export function reconcileActiveDraftSummary(items: readonly Summary[], view: Summary): Summary[] {
  const existing = items.find(item => item.id === view.id);
  if (existing && existing.draftVersion > view.draftVersion) return [...items];
  const next = items.filter(item => item.id !== view.id);
  if (view.lifecycle.state === "active") next.push(toActiveDraftSummary(view));
  // Only local reconciliation needs sorting; list responses retain the server's order.
  return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function getProjectActiveDraftCount(state: DraftDiscoveryState, projectId: number): number | undefined {
  return state.globalKnown || state.knownProjects.includes(projectId)
    ? state.summaries.filter(item => item.projectId === projectId).length : undefined;
}
export function needsDraftReplacementConfirmation(session: TaskPackDraftSession | null): boolean {
  return session !== null && (session.persistence === null
    ? session.draft.rawTask.trim().length > 0 : isTaskPackDraftSessionDirty(session));
}
export function restorableDraftIssue(view: View, summary: Summary, projectIds: readonly number[]): DraftDiscoveryIssue | null {
  if (view.id !== summary.id || view.projectId !== summary.projectId ||
    !Number.isSafeInteger(view.draftVersion) || view.draftVersion <= 0 || view.draftVersion < summary.draftVersion) return "invalidState";
  if (!projectIds.includes(view.projectId)) return "projectMissing";
  if (view.lifecycle.state !== "active") return "notActive";
  if (view.taskPackId !== null || view.baseRevisionId !== null) return "bound";
  return null;
}
function requestIssue(error: unknown, fallback: DraftDiscoveryIssue): DraftDiscoveryIssue {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "TASK_PACK_DRAFT_NOT_FOUND") return "notFound";
  if (code === "TASK_PACK_DRAFT_CONFLICT") return "conflict";
  if (code === "TASK_PACK_DRAFT_NOT_EDITABLE") return "notActive";
  if (code === "TASK_PACK_DRAFT_PROJECT_NOT_FOUND") return "projectMissing";
  if (code === "TASK_PACK_DRAFT_ALREADY_BOUND") return "bound";
  return fallback; // Never surface raw server messages or conflict tokens.
}

/** Small observable owner: executable async/race tests without a React test framework. */
export function createTaskPackDraftDiscovery(api: DraftDiscoveryApi, context: () => DraftDiscoveryContext) {
  let state: DraftDiscoveryState = {
    summaries: [], globalKnown: false, knownProjects: [], scope: null, open: false,
    loading: false, listIssue: null, selectedId: null, detail: null, detailLoading: false,
    issue: null, pending: null, confirmation: null, notice: null,
  };
  const listeners = new Set<() => void>();
  let listSequence = 0;
  let detailSequence = 0;
  let operationSequence = 0;
  let startupAttempted = false;
  const patch = (next: Partial<DraftDiscoveryState>) => {
    state = { ...state, ...next };
    listeners.forEach(listener => listener());
  };
  const visible = () => state.summaries.filter(item => state.scope === null || item.projectId === state.scope);
  function remove(id: string) {
    patch({ summaries: state.summaries.filter(item => item.id !== id),
      ...(state.selectedId === id ? { selectedId: null, detail: null } : {}) });
  }
  function failItem(id: string, issue: DraftDiscoveryIssue) {
    if (issue === "notFound" || issue === "notActive") remove(id);
    patch({ issue, detail: null });
    // Reconcile a deleted/stale project without repeatedly selecting its remaining row.
    if (issue === "projectMissing") void refresh(state.scope, false, true);
  }
  function reconcile(view: Summary) {
    // An older in-flight list must not undo a successful Save/Discard/Reload.
    ++listSequence;
    patch({ summaries: reconcileActiveDraftSummary(state.summaries, view), loading: false });
    if (state.selectedId === view.id) {
      ++detailSequence;
      patch({ detail: null, detailLoading: false, confirmation: null });
      if (view.lifecycle.state !== "active") remove(view.id);
    }
  }
  async function select(id: string) {
    if (!state.open || state.pending || state.confirmation) return;
    const summary = visible().find(item => item.id === id);
    if (!summary) return;
    const token = ++detailSequence;
    patch({ selectedId: id, detail: null, detailLoading: true, issue: null });
    try {
      const view = await api.getTaskPackDraft(id);
      if (token !== detailSequence || !state.open) return;
      const issue = restorableDraftIssue(view, summary, context().projectIds);
      if (issue) failItem(id, issue);
      else patch({ detail: structuredClone(view) });
    } catch (error) {
      if (token === detailSequence && state.open) failItem(id, requestIssue(error, "detailFailed"));
    } finally {
      if (token === detailSequence) patch({ detailLoading: false });
    }
  }
  async function refresh(scope: number | null = state.scope, automatic = false, staleProject = false) {
    if (state.pending && !staleProject) return;
    const token = ++listSequence;
    ++detailSequence;
    patch({ scope, loading: true, listIssue: null, selectedId: null, detail: null,
      detailLoading: false, issue: staleProject ? "projectMissing" : null, confirmation: null });
    try {
      const response = await api.listActiveTaskPackDrafts(scope ?? undefined);
      if (token !== listSequence) return;
      if (response.some(item => item.lifecycle.state !== "active" || (scope !== null && item.projectId !== scope))) {
        throw new Error("Invalid discovery response.");
      }
      const items = response.map(toActiveDraftSummary);
      patch({ summaries: scope === null ? items : [
        ...state.summaries.filter(item => item.projectId !== scope), ...items,
      ], globalKnown: state.globalKnown || scope === null,
      knownProjects: scope === null ? state.knownProjects : [...new Set([...state.knownProjects, scope])],
      loading: false,
      ...(automatic ? { open: items.length > 0 && context().canOffer } : {}),
      });
      if (state.open && items.length === 1 && !staleProject) await select(items[0].id);
    } catch {
      if (token === listSequence) patch({ loading: false, listIssue: "listFailed",
        ...(automatic ? { notice: "listFailed" as const } : {}) });
    }
  }
  async function startup() {
    if (startupAttempted) return;
    startupAttempted = true;
    await refresh(null, true);
  }
  async function open(projectId: number | null = null) {
    if (state.pending || context().busy) return;
    startupAttempted = true; // Manual use also consumes the automatic offer.
    patch({ open: true, notice: null });
    await refresh(projectId);
  }
  function close() {
    startupAttempted = true;
    ++listSequence; ++detailSequence; ++operationSequence;
    patch({ open: false, loading: false, detailLoading: false, confirmation: null, detail: null, selectedId: null });
  }
  async function continueDraft(confirmed?: Extract<DraftDiscoveryConfirmation, { kind: "replace" }>) {
    if (!state.open || state.pending || state.detailLoading) return;
    const summary = confirmed?.summary ?? (state.detail ? toActiveDraftSummary(state.detail) : undefined);
    if (!summary || summary.id !== state.selectedId || (!confirmed && !state.detail)) return;
    const local = context();
    const localSession = local.session;
    if (local.busy) { patch({ issue: "busy" }); return; }
    if (confirmed && localSession !== confirmed.session) { patch({ confirmation: null, issue: "localChanged" }); return; }
    if (!confirmed && needsDraftReplacementConfirmation(localSession)) {
      patch({ confirmation: { kind: "replace", summary, session: localSession } }); return;
    }
    const token = ++operationSequence;
    ++detailSequence;
    patch({ pending: "continuing", confirmation: null, issue: null });
    try {
      const view = await api.getTaskPackDraft(summary.id); // Fresh detail, never the preview cache.
      if (token !== operationSequence || !state.open) return;
      const now = context();
      const issue = restorableDraftIssue(view, summary, now.projectIds);
      if (issue) { failItem(summary.id, issue); return; }
      if (now.busy || now.session !== localSession) { patch({ issue: "localChanged" }); return; }
      if (!now.restore(view)) { patch({ issue: "localChanged" }); return; }
      reconcile(view);
      patch({ notice: "restored" });
      close();
    } catch (error) {
      if (token === operationSequence && state.open) failItem(summary.id, requestIssue(error, "detailFailed"));
    } finally { patch({ pending: null }); }
  }
  function requestDiscard() {
    const view = state.detail;
    if (!view || !state.open || state.pending || state.detailLoading) return;
    if (context().session?.persistence?.id === view.id) { patch({ issue: "activeDraft" }); return; }
    patch({ confirmation: { kind: "discard", view: structuredClone(view) }, issue: null });
  }
  async function confirm() {
    const confirmation = state.confirmation;
    if (!confirmation || state.pending) return;
    if (confirmation.kind === "replace") { await continueDraft(confirmation); return; }
    const { view } = confirmation;
    if (context().session?.persistence?.id === view.id) {
      patch({ confirmation: null, issue: "activeDraft" }); return;
    }
    if (context().busy) { patch({ confirmation: null, issue: "busy" }); return; }
    const token = ++operationSequence;
    patch({ pending: "discarding", confirmation: null, issue: null });
    try {
      const result = await api.discardTaskPackDraft(view.id, view.draftVersion);
      if (result.id !== view.id || result.projectId !== view.projectId || result.lifecycle.state !== "discarded") {
        throw new Error("Invalid discard response.");
      }
      reconcile(result);
      if (token !== operationSequence || !state.open) return;
      patch({ selectedId: null, detail: null, notice: "discarded", pending: null });
      const next = visible()[0];
      if (next) await select(next.id);
    } catch (error) {
      if (token === operationSequence && state.open) patch({ issue: requestIssue(error, "detailFailed") });
    } finally { patch({ pending: null }); }
  }
  return { getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    startup, open, close, refresh: () => refresh(), select, continueDraft: () => continueDraft(), requestDiscard, confirm,
    cancelConfirmation: () => patch({ confirmation: null }), reconcile,
    clearNotice: () => patch({ notice: null }),
  };
}
