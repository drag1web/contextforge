# ContextForge Stage 4.2 — Layout & Sidebar Hover Polish

## Scope
Small UI-only patch.

## Changes

- Removes the empty reserved status-banner space on Projects and Task Packs when there is no real status message.
- Keeps real transient status messages available when the app actually needs to show one.
- Keeps Dashboard and Context Builder layout untouched.
- Changes Sidebar hover behavior so inactive items no longer flash a white background.
- Keeps the sliding active selection animation in the Sidebar.
- Makes Sidebar hover match Settings Control Center behavior more closely: text and icon brighten, but no white hover pill appears.

## Files changed

- `apps/desktop/renderer/src/pages/DashboardPage.tsx`
- `apps/desktop/renderer/src/components/ui/StatusBar.tsx`
- `apps/desktop/renderer/src/hooks/useDashboardController.ts`
- `apps/desktop/renderer/src/components/layout/Sidebar.tsx`

## Verification

Run:

```powershell
npm run build -w @contextforge/renderer
```

Expected manual checks:

1. Projects page starts at the same visual height as the rest of the main pages.
2. Task Packs page starts at the same visual height as the rest of the main pages.
3. Dashboard and Context Builder remain unchanged.
4. Sidebar active item still slides smoothly.
5. Sidebar inactive hover no longer turns the item background white.
6. Real loading/saved/status messages can still appear when set.
