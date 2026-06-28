import { useMemo, useState } from "react";

import { AppTitleBar } from "../components/layout/AppTitleBar";
import { Sidebar, type AppPageId } from "../components/layout/Sidebar";

import { StatusBar } from "../components/ui/StatusBar";
import { ProjectsSection } from "../components/projects/ProjectsSection";

import { AgentsPreviewModal } from "../components/modals/AgentsPreviewModal";
import { TaskPackDraftModal } from "../components/modals/TaskPackDraftModal";
import { GeneratedTaskPackModal } from "../components/modals/GeneratedTaskPackModal";

import { DashboardHomePage } from "./DashboardHomePage";

import { useDashboardController } from "../hooks/useDashboardController";

import { TaskPacksPage } from "./TaskPacksPage";
import { ContextBuilderPage } from "./ContextBuilderPage";
import { SettingsPage } from "./SettingsPage";
import { PlaceholderPage } from "./PlaceholderPage";
import { ReportsPage } from "./ReportsPage";

import { LoadingOverlay } from "../components/ui/LoadingOverlay";

import { GlobalSearchModal } from "../components/modals/GlobalSearchModal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";


export function DashboardPage() {
  const dashboard = useDashboardController();
  const [activePage, setActivePage] = useState<AppPageId>("dashboard");

  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);

  useKeyboardShortcuts({
    globalSearch: () => setIsGlobalSearchOpen(true)
  });

  const content = useMemo(() => {
    if (activePage === "dashboard") {
      return (
        <DashboardHomePage
          projectsCount={dashboard.projects.length}
          taskPacksCount={dashboard.taskPacks.length}
          readinessScore={dashboard.readinessScore}
          statusMessage={dashboard.statusMessage}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onOpenProjects={() => setActivePage("projects")}
          onOpenContextBuilder={() => setActivePage("context")}
          onOpenTaskPacks={() => setActivePage("taskPacks")}
          onOpenSettings={() => setActivePage("settings")}
        />
      );
    }

    if (activePage === "projects") {
      return (
        <>
          <div className="mb-6">
            <StatusBar message={dashboard.statusMessage} />
          </div>

          <ProjectsSection
            projects={dashboard.projects}
            expandedProjectId={dashboard.expandedProjectId}
            isLoading={dashboard.isLoading}
            onAddProject={dashboard.handleSelectProject}
            onToggleProject={dashboard.handleToggleProject}
            onRescanProject={dashboard.handleRescanProject}
            onGenerateAgents={dashboard.handleGenerateAgentsPreview}
            onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
          />
        </>
      );
    }

    if (activePage === "taskPacks") {
      return (
        <>
          <div className="mb-6">
            <StatusBar message={dashboard.statusMessage} />
          </div>

          <TaskPacksPage
            taskPacks={dashboard.taskPacks}
            onOpenTaskPack={dashboard.setGeneratedTaskPack}
          />
        </>
      );
    }

    if (activePage === "context") {
      return (
        <ContextBuilderPage
          projects={dashboard.projects}
          isLoading={dashboard.isLoading}
          onAddProject={dashboard.handleSelectProject}
          onGenerateAgents={dashboard.handleGenerateAgentsPreview}
          onCreateTaskPack={dashboard.handleCreateTaskPackDraft}
        />
      );
    }

    if (activePage === "reports") {
      return (
        <ReportsPage
          projects={dashboard.projects}
          taskPacks={dashboard.taskPacks}
          readinessScore={dashboard.readinessScore}
          statusMessage={dashboard.statusMessage}
          onOpenProjects={() => setActivePage("projects")}
          onOpenTaskPacks={() => setActivePage("taskPacks")}
          onOpenTaskPack={dashboard.setGeneratedTaskPack}
        />
      );
    }

    if (activePage === "settings") {
      return <SettingsPage />;
    }

    return <PlaceholderPage pageId={activePage} />;
  }, [activePage, dashboard]);

  return (
    <main className="flex h-screen min-h-0 w-screen flex-col overflow-hidden bg-black text-neutral-100">
      <AppTitleBar
        activePage={activePage}
        isLoading={dashboard.isLoading}
        onAddProject={dashboard.handleSelectProject}
        onNavigate={setActivePage}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar activePage={activePage} onNavigate={setActivePage} />

        <section className="flex min-w-0 flex-1 flex-col bg-black">
          <div className="min-h-0 flex-1 overflow-auto p-7">
            {content}
          </div>
        </section>
      </div>

      {dashboard.agentsPreview && (
        <AgentsPreviewModal
          preview={dashboard.agentsPreview}
          isLoading={dashboard.isLoading}
          onClose={() => dashboard.setAgentsPreview(null)}
          onSave={dashboard.handleSaveAgentsFile}
          onRegenerate={dashboard.handleRegenerateAgentsPreview}
        />
      )}

      {dashboard.taskPackDraft && (
        <TaskPackDraftModal
          draft={dashboard.taskPackDraft}
          isLoading={dashboard.isLoading}
          onChange={dashboard.setTaskPackDraft}
          onClose={() => dashboard.setTaskPackDraft(null)}
          onGenerate={dashboard.handleCreateTaskPack}
        />
      )}

      {dashboard.generatedTaskPack && (
        <GeneratedTaskPackModal
          taskPack={dashboard.generatedTaskPack}
          onClose={() => dashboard.setGeneratedTaskPack(null)}
        />
      )}

      {isGlobalSearchOpen && (
        <GlobalSearchModal
          activePage={activePage}
          projects={dashboard.projects}
          taskPacks={dashboard.taskPacks}
          onNavigate={setActivePage}
          onOpenTaskPack={dashboard.setGeneratedTaskPack}
          onAddProject={dashboard.handleSelectProject}
          onClose={() => setIsGlobalSearchOpen(false)}
        />
      )}

      <LoadingOverlay
        isVisible={dashboard.isLoading}
        message={dashboard.statusMessage}
      />
    </main>
  );
}