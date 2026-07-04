import {
  getAppSettings,
  getGeminiApiKey,
  getOpenAiCompatibleApiKey,
  type AppSettings
} from "../settings/settingsService.js";

export type AiProviderId = "ollama" | "openai-compatible" | "gemini";

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

function readOpenAiContent(content: NonNullable<OpenAiChatResponse["choices"]>[number]) {
  const messageContent = content.message?.content;

  if (typeof messageContent === "string") {
    return messageContent;
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => (part.type === "text" || !part.type ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return content.text ?? "";
}

function getConfiguredModel(settings: AppSettings) {
  if (settings.aiProvider === "gemini") {
    return settings.geminiModel;
  }

  if (settings.aiProvider === "openai-compatible") {
    return settings.openAiCompatibleModel;
  }

  return settings.defaultOllamaModel;
}

async function getGeminiUrl(settings: AppSettings) {
  return normalizeUrl(settings.geminiBaseUrl);
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

async function getOpenAiHeaders() {
  const apiKey = await getOpenAiCompatibleApiKey();

  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  };
}

export async function getAiProviderStatus(
  settingsInput?: AppSettings
): Promise<AiProviderStatus> {
  const settings = settingsInput ?? (await getAppSettings());

  if (settings.aiProvider === "openai-compatible") {
    const url = normalizeUrl(settings.openAiCompatibleBaseUrl);
    const apiKey = await getOpenAiCompatibleApiKey();

    try {
      const response = await fetch(`${url}/models`, {
        headers: await getOpenAiHeaders()
      });

      return {
        provider: "openai-compatible",
        online: response.ok,
        url,
        model: settings.openAiCompatibleModel,
        apiKeyConfigured: Boolean(apiKey),
        message: response.ok
          ? "OpenAI-compatible endpoint is available."
          : `OpenAI-compatible endpoint responded with status ${response.status}.`
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
            : "OpenAI-compatible endpoint is not available."
      };
    }
  }

  if (settings.aiProvider === "gemini") {
    const url = await getGeminiUrl(settings);
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return {
        provider: "gemini",
        online: false,
        url,
        model: settings.geminiModel,
        apiKeyConfigured: false,
        message: "Gemini API key is not configured."
      };
    }

    try {
      const response = await fetch(`${url}/models?key=${encodeURIComponent(apiKey)}`);

      return {
        provider: "gemini",
        online: response.ok,
        url,
        model: settings.geminiModel,
        apiKeyConfigured: true,
        message: response.ok
          ? "Gemini API is available."
          : `Gemini API responded with status ${response.status}.`
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
            : "Gemini API is not available."
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
        : `Ollama responded with status ${response.status}.`
    };
  } catch (error) {
    return {
      provider: "ollama",
      online: false,
      url,
      model: settings.defaultOllamaModel,
      apiKeyConfigured: false,
      message:
        error instanceof Error ? error.message : "Ollama is not available."
    };
  }
}

export async function listAiProviderModels(
  settingsInput?: AppSettings
): Promise<AiProviderModel[]> {
  const settings = settingsInput ?? (await getAppSettings());

  if (settings.aiProvider === "openai-compatible") {
    const url = normalizeUrl(settings.openAiCompatibleBaseUrl);

    try {
      const response = await fetch(`${url}/models`, {
        headers: await getOpenAiHeaders()
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
          provider: "openai-compatible" as const
        }));
    } catch {
      return [];
    }
  }

  if (settings.aiProvider === "gemini") {
    const url = await getGeminiUrl(settings);
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch(`${url}/models?key=${encodeURIComponent(apiKey)}`);

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as GeminiModelsResponse;

      return (Array.isArray(data.models) ? data.models : [])
        .filter((model) =>
          (model.supportedGenerationMethods ?? []).some(
            (method) => method === "generateContent"
          )
        )
        .map((model) => {
          const rawName = model.name ?? "";
          const name = getGeminiModelId(rawName);

          return {
            id: name,
            name,
            provider: "gemini" as const,
            description: model.displayName ?? model.description
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
          description: model.model
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
  numPredict = 1600
}: AiGenerateInput): Promise<AiGenerateResult> {
  const settings = await getAppSettings();
  const model = getConfiguredModel(settings);

  if (!model) {
    throw new Error("No AI model is selected.");
  }

  if (settings.aiProvider === "openai-compatible") {
    const url = normalizeUrl(settings.openAiCompatibleBaseUrl);
    const response = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: await getOpenAiHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature,
        max_tokens: numPredict
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI-compatible endpoint responded with status ${response.status}.`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    const content = readOpenAiContent(data.choices?.[0] ?? {}).trim();

    if (!content) {
      throw new Error("OpenAI-compatible endpoint returned an empty response.");
    }

    return {
      content,
      provider: "openai-compatible",
      model
    };
  }

  if (settings.aiProvider === "gemini") {
    const apiKey = await getGeminiApiKey();

    if (!apiKey) {
      throw new Error("Gemini API key is not configured.");
    }

    const url = await getGeminiUrl(settings);
    const modelPath = getGeminiModelPath(model);
    const response = await fetch(
      `${url}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            temperature,
            maxOutputTokens: numPredict
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Gemini API responded with status ${response.status}.`);
    }

    const data = (await response.json()) as GeminiGenerateResponse;
    const content = readGeminiContent(data);

    if (!content) {
      throw new Error("Gemini API returned an empty response.");
    }

    return {
      content,
      provider: "gemini",
      model
    };
  }

  const url = normalizeUrl(settings.ollamaUrl);
  const response = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
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
    throw new Error(`Ollama responded with status ${response.status}.`);
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  const content = String(data.response ?? "").trim();

  if (!content) {
    throw new Error("Ollama returned an empty response.");
  }

  return {
    content,
    provider: "ollama",
    model
  };
}
