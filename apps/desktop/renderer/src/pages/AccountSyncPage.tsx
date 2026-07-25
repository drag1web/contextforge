import { Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";

import { WorkspacePageHeader } from "../components/layout/WorkspacePageHeader";
import { DesktopAccountPanel } from "../components/settings/DesktopAccountPanel";

export function AccountSyncPage() {
  const { t } = useTranslation();

  return (
    <section className="space-y-5 text-render-crisp">
      <WorkspacePageHeader
        icon={<Cloud size={18} />}
        eyebrow={t("accountSync.eyebrow")}
        title={t("accountSync.title")}
        description={t("accountSync.description")}
        headingLevel={1}
      />

      <DesktopAccountPanel />
    </section>
  );
}
