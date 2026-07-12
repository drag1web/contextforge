import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  TaskClarification,
  TaskPackDraft,
  TaskUnderstandingResponse,
} from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface TaskUnderstandingModalProps {
  draft: TaskPackDraft;
  response: TaskUnderstandingResponse;
  answer: string;
  error: string | null;
  isSubmitting: boolean;
  onAnswerChange: (value: string) => void;
  onSubmitClarification: () => void;
  onContinue: () => void;
  onEditTask: () => void;
  onClose: () => void;
}

function ReadinessIcon({ readiness }: { readiness: string }) {
  if (readiness === "ready") {
    return <CheckCircle2 size={18} className="text-emerald-300" />;
  }

  if (readiness === "needs_clarification") {
    return <HelpCircle size={18} className="text-amber-300" />;
  }

  return <AlertTriangle size={18} className="text-amber-300" />;
}

function DetailPill({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-neutral-800 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-300">
      {children}
    </span>
  );
}

function ClarificationHistory({ items }: { items: TaskClarification[] }) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white">
        <MessageSquareText size={14} />
        {t("taskUnderstanding.clarificationHistory")}
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={`${item.question}-${index}`}
            className="rounded-xl border border-neutral-900 bg-black/40 p-3"
          >
            <p className="text-[11px] leading-5 text-neutral-500">
              {item.question}
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-200">
              {item.answer}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TaskUnderstandingModal({
  draft,
  response,
  answer,
  error,
  isSubmitting,
  onAnswerChange,
  onSubmitClarification,
  onContinue,
  onEditTask,
  onClose,
}: TaskUnderstandingModalProps) {
  const { t } = useTranslation();
  const understanding = response.taskUnderstanding;
  const needsClarification = response.interaction.action === "clarify";
  const needsReview = response.interaction.action === "review";
  const confidence = Math.round(understanding.confidence * 100);
  const confirmAllReview =
    response.interaction.reason === "confirm_all_tasks";
  const clarificationItems = draft.clarifications ?? [];
  const latestClarification =
    clarificationItems.length > 0
      ? clarificationItems[clarificationItems.length - 1]
      : null;

  return (
    <Modal
      title={
        needsClarification
          ? t("taskUnderstanding.clarificationTitle")
          : needsReview
            ? t("taskUnderstanding.reviewTitle")
            : t("taskUnderstanding.detailsTitle")
      }
      eyebrow={t("taskUnderstanding.eyebrow")}
      maxWidth="max-w-[820px]"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-neutral-600">
            {t("taskUnderstanding.sourceSummary", {
              source: understanding.source,
              confidence,
            })}
          </p>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onEditTask} disabled={isSubmitting}>
              {t("taskUnderstanding.editTask")}
            </Button>

            {needsClarification ? (
              <Button
                variant="primary"
                onClick={onSubmitClarification}
                disabled={isSubmitting || answer.trim().length < 1}
              >
                {isSubmitting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {isSubmitting
                  ? t("taskUnderstanding.checking")
                  : t("taskUnderstanding.applyClarification")}
              </Button>
            ) : (
              <Button variant="primary" onClick={onContinue} disabled={isSubmitting}>
                <CheckCircle2 size={15} />
                {needsReview
                  ? t("taskUnderstanding.continueReviewed")
                  : t("taskUnderstanding.closeDetails")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <section className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/45">
              <ReadinessIcon readiness={understanding.readiness} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DetailPill>{understanding.readiness}</DetailPill>
                <DetailPill>{understanding.action}</DetailPill>
                <DetailPill>{understanding.interpretationRisk}</DetailPill>
                <DetailPill>{understanding.changeDefinition}</DetailPill>
                <DetailPill>{`${confidence}%`}</DetailPill>
              </div>

              <h3 className="mt-3 text-base font-semibold leading-6 text-white">
                {understanding.goal}
              </h3>

              <p className="mt-2 text-xs leading-5 text-neutral-500">
                {needsClarification
                  ? t("taskUnderstanding.clarificationDescription")
                  : needsReview
                    ? confirmAllReview
                      ? t("taskUnderstanding.confirmAllReviewDescription")
                      : t("taskUnderstanding.reviewDescription")
                    : t("taskUnderstanding.readyDescription")}
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white">
              <Target size={14} />
              {t("taskUnderstanding.targetHints")}
            </div>

            <div className="flex flex-wrap gap-2">
              {understanding.targetHints.length > 0 ? (
                understanding.targetHints.map((hint) => (
                  <DetailPill key={hint}>{hint}</DetailPill>
                ))
              ) : (
                <p className="text-xs leading-5 text-neutral-600">
                  {t("taskUnderstanding.noTargetHints")}
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white">
              <ShieldCheck size={14} />
              {t("taskUnderstanding.groundedValues")}
            </div>

            <div className="space-y-2">
              {understanding.explicitValues.length > 0 ? (
                understanding.explicitValues.map((item) => (
                  <div
                    key={`${item.kind}-${item.value}`}
                    className="rounded-xl border border-neutral-900 bg-black/40 px-3 py-2"
                  >
                    <p className="text-[10px] uppercase tracking-wide text-neutral-600">
                      {item.kind}
                    </p>
                    <p className="mt-1 break-words text-xs leading-5 text-neutral-200">
                      {item.value}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs leading-5 text-neutral-600">
                  {t("taskUnderstanding.noGroundedValues")}
                </p>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("taskUnderstanding.originalTask")}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-neutral-300">
            {draft.rawTask}
          </p>
        </section>

        <ClarificationHistory items={draft.clarifications ?? []} />

        {needsClarification && (
          isSubmitting ? (
            <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-5">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/45 text-white">
                  <Loader2 size={17} className="animate-spin" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {t("taskUnderstanding.checkingClarificationTitle")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    {t("taskUnderstanding.checkingClarificationDescription")}
                  </p>

                  {latestClarification?.answer && (
                    <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/40 p-4">
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("taskUnderstanding.clarificationHistory")}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-neutral-200">
                        {latestClarification.answer}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-[1.5rem] border border-amber-300/20 bg-amber-300/[0.045] p-5">
              <div className="flex items-start gap-3">
                <HelpCircle size={18} className="mt-0.5 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {understanding.clarificationQuestion ??
                      t("taskUnderstanding.fallbackQuestion")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    {t("taskUnderstanding.answerDescription")}
                  </p>
                </div>
              </div>

              <textarea
                autoFocus
                value={answer}
                onChange={(event) => onAnswerChange(event.target.value)}
                placeholder={t("taskUnderstanding.answerPlaceholder")}
                className="mt-4 min-h-28 w-full resize-y rounded-2xl border border-neutral-800 bg-black/55 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25 focus:ring-4 focus:ring-white/5"
              />
            </section>
          )
        )}

        {error && (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.055] p-4 text-xs leading-5 text-red-100">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
