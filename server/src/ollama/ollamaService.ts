import { getAppSettings } from "../settings/settingsService.js";
import { generateWithConfiguredAi } from "../ai/providerService.js";
import { cleanupOllamaOutput, isUsableOllamaOutput } from "./outputCleanup.js";

import {
    buildGenerationCacheKey,
    getCachedGeneration,
    setCachedGeneration
} from "./generationCache.js";

export interface AssistedGenerationResult {
    content: string;
    mode: "template" | "ollama";
    model: string | null;
    usedFallback: boolean;
    message: string;
    durationMs: number;
    cached?: boolean;
}

interface GenerateWithOllamaInput {
    prompt: string;
    fallbackContent: string;
    temperature?: number;
    numPredict?: number;
    expectedHeading?: string;
    bypassCache?: boolean;
}

function getDurationMs(startedAt: number) {
    return Date.now() - startedAt;
}

export async function generateWithConfiguredOllama({
    prompt,
    fallbackContent,
    temperature = 0.1,
    numPredict = 1600,
    expectedHeading,
    bypassCache = false
}: GenerateWithOllamaInput): Promise<AssistedGenerationResult> {
    const startedAt = Date.now();
    const settings = await getAppSettings();

    if (settings.generationMode !== "ollama") {
        return {
            content: fallbackContent,
            mode: "template",
            model: null,
            usedFallback: false,
            message: "Generated with template mode.",
            durationMs: getDurationMs(startedAt)
        };
    }

    const configuredModel =
        settings.aiProvider === "openai-compatible"
            ? settings.openAiCompatibleModel
            : settings.defaultOllamaModel;

    const providerLabel =
        settings.aiProvider === "openai-compatible"
            ? "OpenAI-compatible"
            : "Ollama";

    if (!configuredModel) {
        return {
            content: fallbackContent,
            mode: "template",
            model: null,
            usedFallback: true,
            message:
                `${providerLabel} mode is enabled, but no default model is selected. Used template fallback.`,
            durationMs: getDurationMs(startedAt)
        };
    }

    const cacheKey = buildGenerationCacheKey({
        model: `${settings.aiProvider}:${configuredModel}`,
        prompt,
        expectedHeading,
        numPredict,
        temperature
    });

    if (!bypassCache) {
        const cachedGeneration = getCachedGeneration(cacheKey);

        if (cachedGeneration) {
            return {
                content: cachedGeneration.content,
                mode: "ollama",
                model: cachedGeneration.model,
                usedFallback: false,
                cached: true,
                message: `Generated from cache with ${providerLabel} model ${cachedGeneration.model}.`,
                durationMs: getDurationMs(startedAt)
            };
        }
    }

    try {
        const aiResult = await generateWithConfiguredAi({
            prompt,
            temperature,
            numPredict
        });

        const rawGeneratedContent = aiResult.content.trim();

        const generatedContent = cleanupOllamaOutput(rawGeneratedContent, {
            expectedHeading
        });

        if (
            !generatedContent ||
            !isUsableOllamaOutput(generatedContent, { expectedHeading })
        ) {
            return {
                content: fallbackContent,
                mode: "template",
                model: configuredModel,
                usedFallback: true,
                message: `${providerLabel} returned unusable content. Used template fallback.`,
                durationMs: getDurationMs(startedAt)
            };
        }

        setCachedGeneration(cacheKey, {
            content: generatedContent,
            model: aiResult.model
        });

        return {
            content: generatedContent,
            mode: "ollama",
            model: aiResult.model,
            usedFallback: false,
            cached: false,
            message: `Generated with ${providerLabel} model ${aiResult.model}.`,
            durationMs: getDurationMs(startedAt)
        };
    } catch (error) {
        return {
            content: fallbackContent,
            mode: "template",
            model: configuredModel,
            usedFallback: true,
            message:
                error instanceof Error
                    ? `${providerLabel} generation failed: ${error.message}. Used template fallback.`
                    : `${providerLabel} generation failed. Used template fallback.`,
            durationMs: getDurationMs(startedAt)
        };
    }
}
