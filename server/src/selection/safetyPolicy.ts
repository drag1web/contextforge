import { extractClassifiedFileMentions } from "./explicitFileMentions.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").trim();
}

function normalizeText(value: string) {
  return normalizePath(value).toLowerCase();
}

function basename(pathValue: string) {
  const normalized = normalizeText(pathValue).replace(/[?#].*$/, "");
  return normalized.split("/").pop() ?? normalized;
}

function isSafeSecretExampleName(name: string) {
  return (
    name === ".env.example" ||
    name === ".env.sample" ||
    name === ".env.template" ||
    name === "env.example" ||
    name === "example.env" ||
    name === "sample.env" ||
    name.endsWith(".example") ||
    name.endsWith(".sample") ||
    name.endsWith(".template")
  );
}

export function isSecretLikePath(pathValue: string) {
  const normalized = normalizeText(pathValue);
  const name = basename(normalized);

  if (!name) return false;
  if (isSafeSecretExampleName(name)) return false;

  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name === ".npmrc" || name === ".pypirc" || name === ".netrc")
    return true;
  if (
    name === "id_rsa" ||
    name === "id_dsa" ||
    name === "id_ed25519" ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".pfx")
  )
    return true;
  if (
    name === "credentials.json" ||
    name === "service-account.json" ||
    name === "service_account.json" ||
    name.includes("service-account") ||
    name.includes("service_account")
  )
    return true;

  return normalized
    .split("/")
    .some((segment) => segment === "secrets" || segment === ".secrets");
}

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const SECRET_PATH_PATTERNS = [
  /(^|[\s"'`([{])\.env(?:\.[a-z0-9_-]+)?(?=$|[\s"'`)\]},;:!?])/i,
  /\b(?:id_rsa|id_dsa|id_ed25519|credentials\.json|service[-_]account\.json)\b/i,
  /\b[a-z0-9_.-]+\.(?:pem|key|p12|pfx)\b/i,
];

const SAFE_SECRET_EXAMPLE_PATH_PATTERN =
  /(^|[\s"'`([{])(?:\.env\.(?:example|sample|template)|env\.example|example\.env|sample\.env)(?=$|[\s"'`)\]},;:!?])/giu;

const SECRET_WORD_PATTERNS = [
  /\b(?:secret|secrets|token|tokens|api[-_\s]?key|private[-_\s]?key|password|credentials|client[-_\s]?secret|database_url)\b/i,
  /(?:^|[^\p{L}\p{N}_])(?:секрет[\p{L}\p{N}_-]*|токен[\p{L}\p{N}_-]*|ключ(?:и|а|ей|ом|у|ами|ах)?|парол[\p{L}\p{N}_-]*|уч[её]тн[\p{L}\p{N}_-]*)(?=$|[^\p{L}\p{N}_])/iu,
];

const SECRET_EXFILTRATION_PATTERNS = [
  /\b(?:read|show|print|dump|copy|include|paste|send|pass|expose|leak|add)\b[^.!?\n]{0,120}\b(?:secret|secrets|token|tokens|api[-_\s]?key|private[-_\s]?key|password|credentials|client[-_\s]?secret|database_url|\.env)\b/i,
  /\b(?:secret|secrets|token|tokens|api[-_\s]?key|private[-_\s]?key|password|credentials|client[-_\s]?secret|database_url|\.env)\b[^.!?\n]{0,120}\b(?:read|show|print|dump|copy|include|paste|send|pass|expose|leak|add)\b/i,
  /(?:\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0439|\u043f\u043e\u043a\u0430\u0436\u0438|\u0432\u044b\u0432\u0435\u0434\u0438|\u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439|\u0434\u043e\u0431\u0430\u0432\u044c|\u0432\u043a\u043b\u044e\u0447\u0438|\u043f\u0435\u0440\u0435\u0434\u0430\u0439)[^.!?\n]{0,120}(?:\.env|\u0441\u0435\u043a\u0440\u0435\u0442|\u0442\u043e\u043a\u0435\u043d|\u043a\u043b\u044e\u0447|\u043f\u0430\u0440\u043e\u043b)/i,
  /(?:\.env|\u0441\u0435\u043a\u0440\u0435\u0442|\u0442\u043e\u043a\u0435\u043d|\u043a\u043b\u044e\u0447|\u043f\u0430\u0440\u043e\u043b)[^.!?\n]{0,120}(?:\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0439|\u043f\u043e\u043a\u0430\u0436\u0438|\u0432\u044b\u0432\u0435\u0434\u0438|\u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439|\u0434\u043e\u0431\u0430\u0432\u044c|\u0432\u043a\u043b\u044e\u0447\u0438|\u043f\u0435\u0440\u0435\u0434\u0430\u0439)/i,
];

const SECRET_ACTION_PATTERNS = [
  /\b(?:read|show|print|dump|copy|include|paste|send|pass|expose|leak|add|store|save|write|commit)\b/i,
  /(?:\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0439|\u043f\u043e\u043a\u0430\u0436\u0438|\u0432\u044b\u0432\u0435\u0434\u0438|\u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439|\u0434\u043e\u0431\u0430\u0432\u044c|\u0432\u043a\u043b\u044e\u0447\u0438|\u043f\u0435\u0440\u0435\u0434\u0430\u0439|\u0441\u043e\u0445\u0440\u0430\u043d\u0438|\u0437\u0430\u043f\u0438\u0448\u0438|\u0437\u0430\u043a\u043e\u043c\u043c\u0438\u0442\u044c)/i,
];

const SECRET_SAFETY_VALIDATION_PATTERNS = [
  /\b(?:mask|masking|redact|redaction|sanitize|sanitise|scrub|detect|prevent|block|validate|test|assert)[a-z]*\b[^.!?\n]{0,100}\b(?:secret|token|api[-_\s]?key|private[-_\s]?key|password|credential)/i,
  /\b(?:secret|token|api[-_\s]?key|private[-_\s]?key|password|credential)[a-z]*\b[^.!?\n]{0,100}\b(?:mask|redact|sanitize|sanitise|scrub|detect|prevent|block|validate|test|assert)/i,
  /(?:маскир|редактир|санитиз|скрыт|обезлич|провер|тестир|блокир)[^.!?\n]{0,100}(?:секрет|токен|ключ|парол|уч[её]тн)/iu,
  /(?:секрет|токен|ключ|парол|уч[её]тн)[^.!?\n]{0,100}(?:маскир|редактир|санитиз|скрыт|обезлич|провер|тестир|блокир)/iu,
];

const AUTH_TOKEN_BEHAVIOR_PATTERNS = [
  /\b(?:auth|authentication|session|jwt|bearer)\b[^.!?\n]{0,100}\b(?:token|tokens)\b/i,
  /\b(?:token|tokens)\b[^.!?\n]{0,100}\b(?:expiry|expiration|validation|verify|verification|refresh|rotate|revocation|session|jwt|auth)\b/i,
  /(?:авторизац|аутентификац|сесси|jwt)[^.!?\n]{0,100}(?:токен)/iu,
  /(?:токен)[^.!?\n]{0,100}(?:срок|истеч|провер|валидац|обнов|отзыв|сесси|авторизац|jwt)/iu,
];

const NEGATED_SECRET_CONSTRAINT_PATTERNS = [
  /\b(?:do\s+not|don't|never|must\s+not|should\s+not)\s+(?:read|show|print|dump|copy|include|paste|send|pass|expose|leak|add|store|save|write|commit)\b/i,
  /\bwithout\s+(?:adding|including|reading|showing|printing|copying|sending|passing|exposing|leaking|storing|saving|writing|committing)?[^.!?;,:\n]{0,40}\b(?:secret|secrets|token|tokens|api[-_\s]?key|private[-_\s]?key|password|credentials|client[-_\s]?secret|database_url|\.env)\b/i,
  /(?:\u043d\u0435|\u043d\u0438\u043a\u043e\u0433\u0434\u0430\s+\u043d\u0435|\u043d\u0435\u043b\u044c\u0437\u044f)\s+(?:\u0447\u0438\u0442\u0430\u0442\u044c|\u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c|\u0432\u044b\u0432\u043e\u0434\u0438\u0442\u044c|\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c|\u0432\u043a\u043b\u044e\u0447\u0430\u0442\u044c|\u043f\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0442\u044c|\u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0442\u044c|\u0437\u0430\u043f\u0438\u0441\u044b\u0432\u0430\u0442\u044c|\u043a\u043e\u043c\u043c\u0438\u0442\u0438\u0442\u044c)/i,
  /(?:\u0441\u0435\u043a\u0440\u0435\u0442\u044b?|\u0442\u043e\u043a\u0435\u043d\u044b?|\u043a\u043b\u044e\u0447\u0438?|\u043f\u0430\u0440\u043e\u043b\u0438?|\u0443\u0447[\u0435\u0451]\u0442\u043d[^.!?;,:\n]*|\.env)[^.!?;,:\n]{0,60}(?:\u043d\u0435\s+(?:\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c|\u0432\u043a\u043b\u044e\u0447\u0430\u0442\u044c|\u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c|\u0432\u044b\u0432\u043e\u0434\u0438\u0442\u044c|\u043f\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0442\u044c|\u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0442\u044c|\u0437\u0430\u043f\u0438\u0441\u044b\u0432\u0430\u0442\u044c|\u043a\u043e\u043c\u043c\u0438\u0442\u0438\u0442\u044c)|\u043d\u0435\u043b\u044c\u0437\u044f\s+(?:\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c|\u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c|\u043f\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0442\u044c))/i,
  /(?:\u0431\u0435\u0437\s+(?:\u0441\u0435\u043a\u0440\u0435\u0442\u043e\u0432|\u0442\u043e\u043a\u0435\u043d\u043e\u0432|\u043a\u043b\u044e\u0447\u0435\u0439|\u043f\u0430\u0440\u043e\u043b\u0435\u0439|\u0443\u0447[\u0435\u0451]\u0442\u043d\u044b\u0445\s+\u0434\u0430\u043d\u043d\u044b\u0445))/i,
];

function splitSafetyClauses(text: string) {
  return text
    .split(/(?:[!?;,\n]+|\.(?=\s|$)|:(?=\s)|\b(?:and|but|however)\b|\s+(?:\u0438|\u043d\u043e|\u043e\u0434\u043d\u0430\u043a\u043e)\s+)/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function asksToExposeSecretContent(text: string) {
  return splitSafetyClauses(text).some((clause) => {
    const secretComparableClause = clause.replace(
      SAFE_SECRET_EXAMPLE_PATH_PATTERN,
      "$1safe-env-example",
    );
    const mentionsSecret =
      containsAny(secretComparableClause, SECRET_PATH_PATTERNS) ||
      containsAny(secretComparableClause, SECRET_WORD_PATTERNS);

    if (!mentionsSecret) return false;
    if (containsAny(secretComparableClause, NEGATED_SECRET_CONSTRAINT_PATTERNS))
      return false;
    if (
      containsAny(secretComparableClause, SECRET_SAFETY_VALIDATION_PATTERNS) &&
      !containsAny(secretComparableClause, SECRET_PATH_PATTERNS)
    ) return false;
    if (
      containsAny(secretComparableClause, AUTH_TOKEN_BEHAVIOR_PATTERNS) &&
      !containsAny(secretComparableClause, SECRET_PATH_PATTERNS) &&
      !/\b(?:show|print|dump|copy|paste|send|expose|leak)\b/i.test(
        secretComparableClause,
      )
    ) return false;

    return (
      containsAny(secretComparableClause, SECRET_EXFILTRATION_PATTERNS) ||
      containsAny(secretComparableClause, SECRET_ACTION_PATTERNS) ||
      containsAny(secretComparableClause, TASK_PACK_PATTERNS)
    );
  });
}

const TASK_PACK_PATTERNS = [
  /\b(?:task\s*pack|prompt|agent|codex|claude|cursor|gemini)\b/i,
  /(?:\u0430\u0433\u0435\u043d\u0442|\u043f\u0440\u043e\u043c\u043f\u0442|\u0442\u0430\u0441\u043a\s*\u043f\u0430\u043a|\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442)/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system|developer|user(?:'s)?)\s+instructions\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|system|developer|user(?:'s)?)\s+instructions\b/i,
  /\b(?:follow|obey|execute|apply)\s+(?:any|all|the)\s+instructions?\s+(?:found|written|inside|in|from)\s+(?:the\s+)?(?:readme|docs?|documentation|repository|repo|code|comments?|files?)\b/i,
  /\beven\s+if\s+(?:it|they|the\s+file|the\s+readme)\s+(?:says?|tells?\s+you)\s+to\s+ignore\b/i,
  /(?:\u0438\u0433\u043d\u043e\u0440\u0438\u0440\u0443\u0439|\u0437\u0430\u0431\u0443\u0434\u044c)[^.!?\n]{0,80}(?:\u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449|\u0441\u0438\u0441\u0442\u0435\u043c\u043d|\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b|\u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0446)/i,
  /(?:\u0441\u043b\u0435\u0434\u0443\u0439|\u0432\u044b\u043f\u043e\u043b\u043d\u0438|\u043f\u0440\u0438\u043c\u0435\u043d\u0438)[^.!?\n]{0,100}(?:\u043b\u044e\u0431\u044b\u0435|\u0432\u0441\u0435|\u0432\u0441\u0435\u043c)\s+\u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0446[^.!?\n]{0,80}(?:readme|\u0440\u0438\u0434\u043c\u0438|\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442|\u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440|\u0444\u0430\u0439\u043b)/i,
];

const PROMPT_INJECTION_SAFETY_VALIDATION_PATTERNS = [
  /\b(?:detect|prevent|block|test|validate|sanitize|redact)\b[^.!?\n]{0,100}\bprompt[-\s]?injection\b/i,
  /\bprompt[-\s]?injection\b[^.!?\n]{0,100}\b(?:detect|prevent|block|test|validate|sanitize|redact)\b/i,
  /(?:\u043f\u0440\u043e\u043c\u043f\u0442[-\s]?\u0438\u043d\u044a\u0435\u043a\u0446|prompt[-\s]?injection)[^.!?\n]{0,100}(?:\u043f\u0440\u043e\u0432\u0435\u0440|\u0442\u0435\u0441\u0442|\u0431\u043b\u043e\u043a\u0438\u0440|\u0437\u0430\u0449\u0438\u0442)/iu,
];

const DESTRUCTIVE_PATTERNS = [
  /\b(?:delete|remove|wipe|destroy)\s+(?:all|everything|the\s+project|the\s+repo|files?)\b/i,
  /\b(?:delete|remove|wipe|destroy)\b[^.!?\n]{0,80}\b(?:project|repo|repository|workspace|server|backend|frontend|source|src|files?|folders?|directories)\b/i,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\brmdir\s+\/s\b/i,
  /(?:\u0443\u0434\u0430\u043b\u0438|\u0441\u043e\u0442\u0440\u0438|\u0443\u043d\u0438\u0447\u0442\u043e\u0436)[^.!?\n]{0,80}(?:\u0432\u0441\u0435|\u0432\u0441\u0451|\u043f\u0440\u043e\u0435\u043a\u0442|\u0444\u0430\u0439\u043b)/i,
  /(?:\u0443\u0434\u0430\u043b\u0438|\u0441\u043e\u0442\u0440\u0438|\u0443\u043d\u0438\u0447\u0442\u043e\u0436)[^.!?\n]{0,80}\b(?:project|repo|repository|workspace|server|backend|frontend|source|src|files?|folders?|directories)\b/i,
  /\b(?:delete|remove|wipe|destroy)\b[^.!?\n]{0,80}(?:\u043f\u0440\u043e\u0435\u043a\u0442|\u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440|\u0441\u0435\u0440\u0432\u0435\u0440|\u0431\u044d\u043a\u0435\u043d\u0434|\u0444\u0440\u043e\u043d\u0442\u0435\u043d\u0434|\u0444\u0430\u0439\u043b|\u043f\u0430\u043f\u043a|\u0434\u0438\u0440\u0435\u043a\u0442\u043e\u0440)/i,
];

const DELETE_ACTION_PATTERN =
  /\b(?:delete|remove|wipe|destroy)\b|(?:удал(?:и|ить|яй|ять)|убер(?:и|ать)|сотр(?:и|еть)|уничтож(?:ь|ить))/iu;

const BROAD_DELETE_SCOPE_PATTERN =
  /(?:\b(?:delete|remove|wipe|destroy)\b|(?:удал|убер|сотр|уничтож))[^{.!?\n}]{0,100}(?:\b(?:all|everything|project|repo|repository|workspace|server|backend|frontend|source|src|files?|folders?|directories)\b|(?:все|всё|целиком|полностью|проект|репозитор|сервер|бэкенд|бекенд|фронтенд|исходник|файл(?:ы|ов)?|папк|директор))/iu;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A single user-named file is a bounded target, not a project-wide wipe. The
 * inventory/selection layers still have to prove that the path is real and
 * safe; this function only prevents the broad destructive text guard from
 * misclassifying a narrow deletion request because the path contains `src`.
 */
function isBoundedSingleFileDeletion(rawTask: string) {
  if (!DELETE_ACTION_PATTERN.test(rawTask)) return false;
  if (/\brm\s+-rf\b|\bdel\s+\/[sq]\b|\brmdir\s+\/s\b|[*?{}]/iu.test(rawTask))
    return false;

  const targets = extractClassifiedFileMentions(rawTask).filter(
    (mention) => mention.role !== "artifact-reference",
  );
  if (targets.length !== 1) return false;

  const scrubbed = rawTask.replace(
    new RegExp(escapeRegExp(targets[0]!.path), "giu"),
    " <target> ",
  );
  return !BROAD_DELETE_SCOPE_PATTERN.test(scrubbed);
}

const PROTECTED_GENERATED_PATH_PATTERNS = [
  /(?:^|[\s"'`([{])(?:node_modules|\.next|dist|build|coverage|out)[/\\][^\s"'`)\]},;:!?]+/i,
  /(?:^|[\s"'`([{])(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)(?=$|[\s"'`)\]},;:!?])/i,
];

const PROTECTED_PATH_ACTION_PATTERNS = [
  /\b(?:fix|change|edit|modify|patch|update|create|write|add|delete|remove|read|include|touch)\b/i,
  /(?:\u043f\u043e\u0447\u0438\u043d|\u0438\u0441\u043f\u0440\u0430\u0432|\u0438\u0437\u043c\u0435\u043d|\u043e\u0431\u043d\u043e\u0432|\u0441\u043e\u0437\u0434|\u0437\u0430\u043f\u0438\u0448|\u0434\u043e\u0431\u0430\u0432|\u0443\u0434\u0430\u043b|\u043f\u0440\u043e\u0447\u0438\u0442|\u0432\u043a\u043b\u044e\u0447)/i,
];

const DOCUMENTATION_CONTEXT_PATTERNS = [
  /\b(?:readme|docs|documentation|document|explain|mention|describe|gitignore)\b/i,
  /(?:\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442|\u0440\u0438\u0434\u043c\u0438|readme|\u043e\u043f\u0438\u0448|\u0443\u043f\u043e\u043c\u044f\u043d|\u043e\u0431\u044a\u044f\u0441\u043d|\u0433\u0438\u0442\u0438\u0433\u043d\u043e\u0440|gitignore)/i,
];

export interface HardTaskSafetyIssue {
  blocked: boolean;
  reasons: string[];
}

export function detectHardTaskSafetyIssue(rawTask: string): HardTaskSafetyIssue {
  const text = normalizeText(rawTask);
  const reasons: string[] = [];
  const mentionsSecretPath = containsAny(text, SECRET_PATH_PATTERNS);
  const mentionsSecretWord = containsAny(text, SECRET_WORD_PATTERNS);
  const asksForProtectedGeneratedPath =
    containsAny(text, PROTECTED_GENERATED_PATH_PATTERNS) &&
    containsAny(text, PROTECTED_PATH_ACTION_PATTERNS) &&
    !containsAny(text, DOCUMENTATION_CONTEXT_PATTERNS);
  const asksToExposeSecret = asksToExposeSecretContent(text);
  const destructiveMatch = containsAny(text, DESTRUCTIVE_PATTERNS);
  const destructiveActionMatch = DELETE_ACTION_PATTERN.test(text);
  const promptInjectionMatch =
    containsAny(text, PROMPT_INJECTION_PATTERNS) &&
    !containsAny(text, PROMPT_INJECTION_SAFETY_VALIDATION_PATTERNS);
  const boundedSingleFileDeletion = isBoundedSingleFileDeletion(rawTask);

  if (asksToExposeSecret) {
    reasons.push(
      "Secret or .env content request was blocked. ContextForge will not read, include, print, or pass real secrets to an agent; use .env.example with placeholder names instead.",
    );
  }

  if (asksForProtectedGeneratedPath) {
    reasons.push(
      "Generated, dependency, or build-output path request was blocked. ContextForge will not create, edit, read, or include files from node_modules, dist/build outputs, coverage, or lockfiles as task context.",
    );
  }

  if (
    promptInjectionMatch &&
    (destructiveActionMatch || asksToExposeSecret || asksForProtectedGeneratedPath)
  ) {
    reasons.push(
      "Prompt-injection request was blocked because it tries to override safety instructions while asking for destructive or secret-related behavior.",
    );
  } else if (destructiveMatch && !boundedSingleFileDeletion) {
    reasons.push(
      "Destructive project-wide file operation was blocked. ContextForge will not generate context for deleting or wiping broad project contents.",
    );
  }

  return {
    blocked: reasons.length > 0,
    reasons,
  };
}
