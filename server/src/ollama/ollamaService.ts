import { getAppSettings } from "../settings/settingsService.js";
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

interface OllamaGenerateResponse {
    response?: string;
    done?: boolean;
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

    if (!settings.defaultOllamaModel) {
        return {
            content: fallbackContent,
            mode: "template",
            model: null,
            usedFallback: true,
            message:
                "Ollama mode is enabled, but no default model is selected. Used template fallback.",
            durationMs: getDurationMs(startedAt)
        };
    }

    const cacheKey = buildGenerationCacheKey({
        model: settings.defaultOllamaModel,
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
                message: `Generated from cache with Ollama model ${cachedGeneration.model}.`,
                durationMs: getDurationMs(startedAt)
            };
        }
    }

    try {
        const response = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: settings.defaultOllamaModel,
                prompt,
                stream: false,
                options: {
                    temperature,
                    num_predict: numPredict,
                    top_p: 0.9,
                    repeat_penalty: 1.08
                }
            })
        });

        if (!response.ok) {
            return {
                content: fallbackContent,
                mode: "template",
                model: settings.defaultOllamaModel,
                usedFallback: true,
                message: `Ollama responded with status ${response.status}. Used template fallback.`,
                durationMs: getDurationMs(startedAt)
            };
        }

        const data = (await response.json()) as OllamaGenerateResponse;

        const rawGeneratedContent = String(data.response ?? "").trim();

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
                model: settings.defaultOllamaModel,
                usedFallback: true,
                message: "Ollama returned unusable content. Used template fallback.",
                durationMs: getDurationMs(startedAt)
            };
        }

        setCachedGeneration(cacheKey, {
            content: generatedContent,
            model: settings.defaultOllamaModel
        });

        return {
            content: generatedContent,
            mode: "ollama",
            model: settings.defaultOllamaModel,
            usedFallback: false,
            cached: false,
            message: `Generated with Ollama model ${settings.defaultOllamaModel}.`,
            durationMs: getDurationMs(startedAt)
        };
    } catch (error) {
        return {
            content: fallbackContent,
            mode: "template",
            model: settings.defaultOllamaModel,
            usedFallback: true,
            message:
                error instanceof Error
                    ? `Ollama generation failed: ${error.message}. Used template fallback.`
                    : "Ollama generation failed. Used template fallback.",
            durationMs: getDurationMs(startedAt)
        };
    }
}
