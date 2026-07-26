import type { TFunction } from "i18next";

import type { ReadinessCheck, ReadinessReport } from "../../types";

const ACTIONABLE_CHECK_KEYS = new Set([
  "readme",
  "agents",
  "build-script",
  "dev-script",
  "test-script",
  "env-example",
  "typescript-config",
  "tests",
  "docs"
]);

function checkBaseKey(check: ReadinessCheck) {
  return `projectDetailsPage.readinessChecks.${check.key}`;
}

export function localizeReadinessCheckLabel(t: TFunction, check: ReadinessCheck) {
  return t(`${checkBaseKey(check)}.label`, { defaultValue: check.label });
}

export function localizeReadinessCheckMessage(
  t: TFunction,
  report: ReadinessReport,
  check: ReadinessCheck
) {
  const signals = report.signals;
  const baseKey = checkBaseKey(check);

  switch (check.key) {
    case "build-script":
      return check.passed && signals?.commands.build
        ? t(`${baseKey}.detected`, { command: signals.commands.build })
        : t(`${baseKey}.missing`);
    case "dev-script":
      return check.passed && signals?.commands.dev
        ? t(`${baseKey}.detected`, { command: signals.commands.dev })
        : t(`${baseKey}.missing`);
    case "test-script": {
      if (check.passed && signals?.commands.test) {
        return t(`${baseKey}.detected`, { command: signals.commands.test });
      }

      const hasTestStructure = Boolean(
        signals && (signals.testFiles.length > 0 || signals.testConfigs.length > 0)
      );
      return hasTestStructure
        ? t(`${baseKey}.missingWithStructure`)
        : t(`${baseKey}.missing`);
    }
    case "tests": {
      const hasFiles = Boolean(signals?.testFiles.length);
      const hasConfigs = Boolean(signals?.testConfigs.length);

      if (hasFiles && hasConfigs) return t(`${baseKey}.filesAndConfig`);
      if (hasFiles) return t(`${baseKey}.filesOnly`);
      if (hasConfigs) return t(`${baseKey}.configOnly`);
      return t(`${baseKey}.missing`);
    }
    default:
      return t(`${baseKey}.${check.passed ? "passed" : "missing"}`, {
        defaultValue: check.message
      });
  }
}

export function localizeReadinessIssueTitle(
  t: TFunction,
  report: ReadinessReport,
  check: ReadinessCheck
) {
  const baseKey = checkBaseKey(check);
  const signals = report.signals;

  if (check.key === "test-script") {
    const hasTestStructure = Boolean(
      signals && (signals.testFiles.length > 0 || signals.testConfigs.length > 0)
    );
    return hasTestStructure
      ? t(`${baseKey}.issueWithStructure`)
      : t(`${baseKey}.issue`);
  }

  if (check.key === "tests" && signals?.commands.test) {
    return t(`${baseKey}.issueWithScript`);
  }

  return t(`${baseKey}.issue`, {
    defaultValue: t("projectDetailsPage.readinessChecks.genericIssue", {
      label: localizeReadinessCheckLabel(t, check)
    })
  });
}

export function buildLocalizedReadinessPriorities(
  t: TFunction,
  report: ReadinessReport
) {
  return report.checks
    .filter((check) => !check.passed && ACTIONABLE_CHECK_KEYS.has(check.key))
    .map((check) => ({
      key: check.key,
      title: localizeReadinessIssueTitle(t, report, check),
      caption: localizeReadinessCheckMessage(t, report, check),
      points: check.points
    }));
}
