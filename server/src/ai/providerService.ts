import {
  getAnthropicApiKey,
  getAppSettings,
  getGeminiApiKey,
  getOpenAiCompatibleApiKey,
  type AppSettings,
} from "../settings/settingsService.js";
import {
  beginPerformanceAiCall,
  finishPerformanceAiCall,
} from "../performance/performanceTrace.js";

export type AiProviderId =
  "ollama" | "openai-compatible" | "anthropic" | "gemini";

export interface AiProviderStatus {
  provider: AiProviderId;
  online: boolean;
  url: string;
  model: string | null;
  apiKeyConfigured: boolean;
  message: string;
}

export interface AiProviderModel {
  id: string;
  name: string;
  provider: AiProviderId;
  size?: number;
  modifiedAt?: string;
  description?: string;
}

export interface AiGenerateInput {
  prompt: string;
  temperature?: number;
  numPredict?: number;
  responseFormat?: "text" | "json";
  timeoutMs?: number;
  purpose?: string;
}

export interface AiGenerateResult {
  content: string;
  provider: AiProviderId;
  model: string;
}

interface OllamaModelResponse {
  models?: Array<{
    name?: string;
    model?: string;
    modified_at?: string;
    size?: number;
  }>;
}

interface OllamaGenerateResponse {
  response?: string;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OpenAiModelsResponse {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    text?: string;
  }>;
}

interface AnthropicModelsResponse {
  data?: Array<{
    id?: string;
    display_name?: string;
    created_at?: string;
  }>;
}

interface AnthropicMessagesResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
}

interface GeminiModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeUrl(value: string) {
  return trimTrailingSlash(value.trim());
}

function readOpenAiContent(
  content: NonNullable<OpenAiChatResponse["choices"]>[number],
) {
  const messageContent = content.message?.content;

  if (typeof messageContent === "string") {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) =>
        part.type === "text" || !part.type ? (part.text ?? "") : "",
      )
      .join("")
      .trim();
  }

  return content.text ?? "";
}

function getConfiguredModel(settings: AppSettings) {
  if (settings.aiProvider === "gemini") {
    return settings.geminiModel;
  }

  if (settings.aiProvider === "anthropic") {
    return settings.anthropicModel;
  }

  if (settings.aiProvider === "openai-compatible") {
    return settings.openAiCompatibleModel;
  }

  return settings.defaultOllamaModel;
}

function getGeminiUrl(settings: AppSettings) {
  return normalizeUrl(settings.geminiBaseUrl);
}

function getAnthropicUrl(settings: AppSettings) {
  return normalizeUrl(settings.anthropicBaseUrl);
}

function getGeminiModelPath(model: string) {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function getGeminiModelId(name: string) {
  return name.replace(/^models\//, "");
}

function readGeminiContent(data: GeminiGenerateResponse) {
  return (data.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

function readAnthropicContent(data: AnthropicMessagesResponse) {
  return (data.content ?? [])
    .filter((part) => part.type === "text" || !part.type)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

async function getOpenAiHeaders() {
  const apiKey = await getOpenAiCompatibleApiKey();

  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function getAnthropicHeaders() {
  const apiKey = await getAnthropicApiKey();

  return {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

export async function getAiProviderStatus(
  settingsInput?: AppSettings,
): Promise<AiProviderStatus> {
  const settings = settingsInput ?? (await getAppSettings());

  if (settings.aiProvider === "openai-compatible") {
    const url = normalizeUrl(settings.openAiCompatibleBaseUrl);
    const apiKey = await getOpenAiCompatibleApiKey();

    try {
      const response = await fetch(`${url}/models`, {
        headers: await getOpenAiHeaders(),
      });

      return {
        provider: "openai-compatible",
        online: response.ok,
        url,
        model: settings.openAiCompatibleModel,
        apiKeyConfigured: Boolean(apiKey),
        message: response.ok
          ? "OpenAI-compatible endpoint is available."
          : `OpenAI-compatible endpoint responded with status ${response.status}.`,
      };
    } catch (error) {
      return {
        provider: "openai-compatible",
        online: false,
        url,
        model: settings.openAiCompatibleModel,
        apiKeyConfigured: Boolean(apiKey),
        message:
          error instanceof Error
            ? error.message
            : "OpenAI-compatible endpoint is not available.",
      };
    }
  }

  if (settings.aiProvider === "anthropic") {
    const url = getAnthropicUrl(settings);
    const apiKey = await getAnthropicApiKey();

    if (!apiKey) {
      return {
        provider: "anthropic",
        online: false,
        url,
        model: settings.anthropicModel,
        apiKeyConfigured: false,
        message: "Claude API key is not configured.",
      };
    }

    try {
      const response = await fetch(`${url}/models`, {
        headers: await getAnthropicHeaders(),
      });

      return {
        provider: "anthropic",
        online: response.ok,
        url,
        model: settings.anthropicModel,
        apiKeyConfigured: true,
        message: response.ok
          ? "Claude API is available."
          : `Claude API responded with status ${response.status}.`,
      };
    } catch (error) {
      return {
        provider: "anthropic",
        online: false,
        url,
        model: settings.anthropicModel,
        apiKeyConfigured: true,
        message:
          error instanceof Error
            ? error.message
            : "Claude API is not available.",
      };
    }
  }

  if (settings.aiProvider === "gemini") {
    const url = getGeminiUrl(settings);
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return {
        provider: "gemini",
        online: false,
        url,
        model: settings.geminiModel,
        apiKeyConfigured: false,
        message: "Gemini API key is not configured.",
      };
    }

    try {
      const response = await fetch(
        `${url}/models?key=${encodeURIComponent(apiKey)}`,
      );

      return {
        provider: "gemini",
        online: response.ok,
        url,
        model: settings.geminiModel,
        apiKeyConfigured: true,
        message: response.ok
          ? "Gemini API is available."
          : `Gemini API responded with status ${response.status}.`,
      };
    } catch (error) {
      return {
        provider: "gemini",
        online: false,
        url,
        model: settings.geminiModel,
        apiKeyConfigured: true,
        message:
          error instanceof Error
            ? error.message
            : "Gemini API is not available.",
      };
    }
  }

  const url = normalizeUrl(settings.ollamaUrl);

  try {
    const response = await fetch(`${url}/api/tags`);

    return {
      provider: "ollama",
      online: response.ok,
      url,
      model: settings.defaultOllamaModel,
      apiKeyConfigured: false,
      message: response.ok
        ? "Ollama is available."
        : `Ollama responded with status ${response.status}.`,
    };
  } catch (error) {
    return {
      provider: "ollama",
      online: false,
      url,
      model: settings.defaultOllamaModel,
      apiKeyConfigured: false,
      message:
        error instanceof Error ? error.message : "Ollama is not available.",
    };
  }
}

export async function listAiProviderModels(
  settingsInput?: AppSettings,
): Promise<AiProviderModel[]> {
  const settings = settingsInput ?? (await getAppSettings());

  if (settings.aiProvider === "openai-compatible") {
    const url = normalizeUrl(settings.openAiCompatibleBaseUrl);

    try {
      const response = await fetch(`${url}/models`, {
        headers: await getOpenAiHeaders(),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as OpenAiModelsResponse;

      return (Array.isArray(data.data) ? data.data : [])
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id))
        .map((id) => ({
          id,
          name: id,
          provider: "openai-compatible" as const,
        }));
    } catch {
      return [];
    }
  }

  if (settings.aiProvider === "anthropic") {
    const url = getAnthropicUrl(settings);
    const apiKey = await getAnthropicApiKey();

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch(`${url}/models`, {
        headers: await getAnthropicHeaders(),
      });

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as AnthropicModelsResponse;

      return (Array.isArray(data.data) ? data.data : [])
        .filter(
          (
            model,
          ): model is {
            id: string;
            display_name?: string;
            created_at?: string;
          } => Boolean(model.id),
        )
        .map((model) => ({
          id: model.id,
          name: model.id,
          provider: "anthropic" as const,
          description: model.display_name,
          modifiedAt: model.created_at,
        }));
    } catch {
      return [];
    }
  }

  if (settings.aiProvider === "gemini") {
    const url = getGeminiUrl(settings);
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch(
        `${url}/models?key=${encodeURIComponent(apiKey)}`,
      );

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as GeminiModelsResponse;

      return (Array.isArray(data.models) ? data.models : [])
        .filter((model) =>
          (model.supportedGenerationMethods ?? []).some(
            (method) => method === "generateContent",
          ),
        )
        .map((model) => {
          const rawName = model.name ?? "";
          const name = getGeminiModelId(rawName);

          return {
            id: name,
            name,
            provider: "gemini" as const,
            description: model.displayName ?? model.description,
          };
        })
        .filter((model) => Boolean(model.name));
    } catch {
      return [];
    }
  }

  const url = normalizeUrl(settings.ollamaUrl);

  try {
    const response = await fetch(`${url}/api/tags`);

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as OllamaModelResponse;

    const models: AiProviderModel[] = [];

    for (const model of Array.isArray(data.models) ? data.models : []) {
      const name = model.name ?? model.model;

      if (!name) {
        continue;
      }

      models.push({
        id: name,
        name,
        provider: "ollama",
        size: model.size,
        modifiedAt: model.modified_at,
        description: model.model,
      });
    }

    return models;
  } catch {
    return [];
  }
}

export async function generateWithConfiguredAi({
  prompt,
  temperature = 0.1,
  numPredict = 1600,
  responseFormat = "text",
  timeoutMs = 120_000,
  purpose = "configured_ai_generation",
}: AiGenerateInput): Promise<AiGenerateResult> {
  const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
  const settings = await getAppSettings();
  const model = getConfiguredModel(settings);

  if (!model) {
    throw new Error("No AI model is selected.");
  }

  const aiCall = beginPerformanceAiCall({
    purpose,
    provider: settings.aiProvider,
    model,
    promptChars: prompt.length,
    responseFormat,
    numPredict,
  });

  const finishSuccess = (input: {
    content: string;
    httpStatus?: number | null;
    modelLoadMs?: number | null;
    promptEvalMs?: number | null;
    generationMs?: number | null;
    promptTokens?: number | null;
    responseTokens?: number | null;
  }) => {
    finishPerformanceAiCall(aiCall, {
      success: true,
      responseChars: input.content.length,
      httpStatus: input.httpStatus ?? 200,
      modelLoadMs: input.modelLoadMs,
      promptEvalMs: input.promptEvalMs,
      generationMs: input.generationMs,
      promptTokens: input.promptTokens,
      responseTokens: input.responseTokens,
    });
  };

  const finishFailure = (errorCode: string, httpStatus?: number | null) => {
    finishPerformanceAiCall(aiCall, {
      success: false,
      responseChars: 0,
      httpStatus: httpStatus ?? null,
      errorCode,
    });
  };

  try {
  if (settings.aiProvider === "openai-compatible") {
    const url = normalizeUrl(settings.openAiCompatibleBaseUrl);
    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: await getOpenAiHeaders(),
      signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature,
        max_tokens: numPredict,
        ...(responseFormat === "json"
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
    });

    if (!response.ok) {
      finishFailure("http_error", response.status);
      throw new Error(
        `OpenAI-compatible endpoint responded with status ${response.status}.`,
      );
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const content = readOpenAiContent(data.choices?.[0] ?? {}).trim();

    if (!content) {
      finishFailure("empty_response", response.status);
      throw new Error("OpenAI-compatible endpoint returned an empty response.");
    }

    finishSuccess({ content, httpStatus: response.status });
    return {
      content,
      provider: "openai-compatible",
      model,
    };
  }

  if (settings.aiProvider === "anthropic") {
    const apiKey = await getAnthropicApiKey();

    if (!apiKey) {
      finishFailure("api_key_missing");
      throw new Error("Claude API key is not configured.");
    }

    const url = getAnthropicUrl(settings);
    const response = await fetch(`${url}/messages`, {
      method: "POST",
      headers: await getAnthropicHeaders(),
      signal,
      body: JSON.stringify({
        model,
        max_tokens: numPredict,
        temperature,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      finishFailure("http_error", response.status);
      throw new Error(`Claude API responded with status ${response.status}.`);
    }

    const data = (await response.json()) as AnthropicMessagesResponse;
    const content = readAnthropicContent(data);

    if (!content) {
      finishFailure("empty_response", response.status);
      throw new Error("Claude API returned an empty response.");
    }

    finishSuccess({ content, httpStatus: response.status });
    return {
      content,
      provider: "anthropic",
      model,
    };
  }

  if (settings.aiProvider === "gemini") {
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      finishFailure("api_key_missing");
      throw new Error("Gemini API key is not configured.");
    }

    const url = getGeminiUrl(settings);
    const modelPath = getGeminiModelPath(model);
    const response = await fetch(
      `${url}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: numPredict,
            ...(responseFormat === "json"
              ? { responseMimeType: "application/json" }
              : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      finishFailure("http_error", response.status);
      throw new Error(`Gemini API responded with status ${response.status}.`);
    }

    const data = (await response.json()) as GeminiGenerateResponse;
    const content = readGeminiContent(data);

    if (!content) {
      finishFailure("empty_response", response.status);
      throw new Error("Gemini API returned an empty response.");
    }

    finishSuccess({ content, httpStatus: response.status });
    return {
      content,
      provider: "gemini",
      model,
    };
  }

  const url = normalizeUrl(settings.ollamaUrl);
  const response = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      ...(responseFormat === "json" ? { format: "json" } : {}),
      options: {
        temperature,
        num_predict: numPredict,
        top_p: 0.9,
        repeat_penalty: 1.08,
      },
    }),
  });

  if (!response.ok) {
    finishFailure("http_error", response.status);
    throw new Error(`Ollama responded with status ${response.status}.`);
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  const content = String(data.response ?? "").trim();

  if (!content) {
    finishFailure("empty_response", response.status);
    throw new Error("Ollama returned an empty response.");
  }

  const nsToMs = (value: number | undefined) =>
    typeof value === "number" ? value / 1_000_000 : null;

  finishSuccess({
    content,
    httpStatus: response.status,
    modelLoadMs: nsToMs(data.load_duration),
    promptEvalMs: nsToMs(data.prompt_eval_duration),
    generationMs: nsToMs(data.eval_duration),
    promptTokens: data.prompt_eval_count ?? null,
    responseTokens: data.eval_count ?? null,
  });

  return {
    content,
    provider: "ollama",
    model,
  };
  } catch (error) {
    finishFailure(
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "request_error",
    );
    throw error;
  }
}
