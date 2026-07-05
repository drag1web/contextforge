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

const SECRET_WORD_PATTERNS = [
  /\b(?:secret|secrets|token|tokens|api[-_\s]?key|private[-_\s]?key|password|credentials|client[-_\s]?secret|database_url)\b/i,
  /(?:\u0441\u0435\u043a\u0440\u0435\u0442|\u0441\u0435\u043a\u0440\u0435\u0442\u044b|\u0442\u043e\u043a\u0435\u043d|\u0442\u043e\u043a\u0435\u043d\u044b|\u043a\u043b\u044e\u0447|\u043a\u043b\u044e\u0447\u0438|\u043f\u0430\u0440\u043e\u043b|\u043f\u0430\u0440\u043e\u043b\u0438|\u0443\u0447\u0435\u0442\u043d|\u0443\u0447\u0451\u0442\u043d)/i,
];

const SECRET_EXFILTRATION_PATTERNS = [
  /\b(?:read|show|print|dump|copy|include|paste|send|pass|expose|leak|add)\b[^.!?\n]{0,120}\b(?:secret|secrets|token|tokens|api[-_\s]?key|private[-_\s]?key|password|credentials|client[-_\s]?secret|database_url|\.env)\b/i,
  /\b(?:secret|secrets|token|tokens|api[-_\s]?key|private[-_\s]?key|password|credentials|client[-_\s]?secret|database_url|\.env)\b[^.!?\n]{0,120}\b(?:read|show|print|dump|copy|include|paste|send|pass|expose|leak|add)\b/i,
  /(?:\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0439|\u043f\u043e\u043a\u0430\u0436\u0438|\u0432\u044b\u0432\u0435\u0434\u0438|\u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439|\u0434\u043e\u0431\u0430\u0432\u044c|\u0432\u043a\u043b\u044e\u0447\u0438|\u043f\u0435\u0440\u0435\u0434\u0430\u0439)[^.!?\n]{0,120}(?:\.env|\u0441\u0435\u043a\u0440\u0435\u0442|\u0442\u043e\u043a\u0435\u043d|\u043a\u043b\u044e\u0447|\u043f\u0430\u0440\u043e\u043b)/i,
  /(?:\.env|\u0441\u0435\u043a\u0440\u0435\u0442|\u0442\u043e\u043a\u0435\u043d|\u043a\u043b\u044e\u0447|\u043f\u0430\u0440\u043e\u043b)[^.!?\n]{0,120}(?:\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0439|\u043f\u043e\u043a\u0430\u0436\u0438|\u0432\u044b\u0432\u0435\u0434\u0438|\u0441\u043a\u043e\u043f\u0438\u0440\u0443\u0439|\u0434\u043e\u0431\u0430\u0432\u044c|\u0432\u043a\u043b\u044e\u0447\u0438|\u043f\u0435\u0440\u0435\u0434\u0430\u0439)/i,
];

const TASK_PACK_PATTERNS = [
  /\b(?:task\s*pack|prompt|agent|codex|claude|cursor|gemini)\b/i,
  /(?:\u0430\u0433\u0435\u043d\u0442|\u043f\u0440\u043e\u043c\u043f\u0442|\u0442\u0430\u0441\u043a\s*\u043f\u0430\u043a|\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442)/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|system|developer)\s+instructions\b/i,
  /(?:\u0438\u0433\u043d\u043e\u0440\u0438\u0440\u0443\u0439|\u0437\u0430\u0431\u0443\u0434\u044c)[^.!?\n]{0,80}(?:\u043f\u0440\u0435\u0434\u044b\u0434\u0443\u0449|\u0441\u0438\u0441\u0442\u0435\u043c\u043d|\u0438\u043d\u0441\u0442\u0440\u0443\u043a\u0446)/i,
];

const DESTRUCTIVE_PATTERNS = [
  /\b(?:delete|remove|wipe|destroy)\s+(?:all|everything|the\s+project|the\s+repo|files?)\b/i,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\brmdir\s+\/s\b/i,
  /(?:\u0443\u0434\u0430\u043b\u0438|\u0441\u043e\u0442\u0440\u0438|\u0443\u043d\u0438\u0447\u0442\u043e\u0436)[^.!?\n]{0,80}(?:\u0432\u0441\u0435|\u0432\u0441\u0451|\u043f\u0440\u043e\u0435\u043a\u0442|\u0444\u0430\u0439\u043b)/i,
];

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
  const asksToExposeSecret =
    containsAny(text, SECRET_EXFILTRATION_PATTERNS) ||
    ((mentionsSecretPath || mentionsSecretWord) && containsAny(text, TASK_PACK_PATTERNS));

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
    containsAny(text, PROMPT_INJECTION_PATTERNS) &&
    (containsAny(text, DESTRUCTIVE_PATTERNS) || mentionsSecretPath || mentionsSecretWord)
  ) {
    reasons.push(
      "Prompt-injection request was blocked because it tries to override safety instructions while asking for destructive or secret-related behavior.",
    );
  } else if (containsAny(text, DESTRUCTIVE_PATTERNS)) {
    reasons.push(
      "Destructive project-wide file operation was blocked. ContextForge will not generate context for deleting or wiping broad project contents.",
    );
  }

  return {
    blocked: reasons.length > 0,
    reasons,
  };
}
