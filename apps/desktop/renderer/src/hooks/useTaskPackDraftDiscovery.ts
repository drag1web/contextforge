import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { listActiveTaskPackDrafts, getTaskPackDraft, discardTaskPackDraft } from "../api/client";
import { createTaskPackDraftDiscovery, type DraftDiscoveryContext } from "../utils/taskPackDraftDiscovery";

export function useTaskPackDraftDiscovery(options: DraftDiscoveryContext & { startupReady: boolean }) {
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(true);
  const [owner] = useState(() => createTaskPackDraftDiscovery(
    { listActiveTaskPackDrafts, getTaskPackDraft, discardTaskPackDraft },
    () => ({ ...latest.current,
      canOffer: mounted.current && latest.current.canOffer &&
        !document.querySelector('[role="dialog"][aria-modal="true"]'),
      busy: !mounted.current || latest.current.busy,
    }),
  ));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (options.startupReady) void owner.startup(); }, [options.startupReady, owner]);
  useEffect(() => {
    if (!state.notice) return;
    const timeout = window.setTimeout(owner.clearNotice, 6000);
    return () => window.clearTimeout(timeout);
  }, [state.notice, owner]);
  return { state, owner };
}
