import type { TaskAwareProjectContext } from "../scanner/taskAwareContextScanner.js";

function buildRelevantFilesSection(projectContext: TaskAwareProjectContext) {
  const relevantFiles =
    projectContext.relevantFiles.length > 0
      ? projectContext.relevantFiles.map((file) => `- ${file}`).join("\n")
      : "- No relevant file candidates were detected. Inspect the project manually before editing.";

  return `
## Relevant File Candidates

Inspect these files before modifying code:

${relevantFiles}
`.trim();
}

function buildCodeSnippetsSection(projectContext: TaskAwareProjectContext) {
  const snippets =
    projectContext.fileSnippets.length > 0
      ? projectContext.fileSnippets
          .map((snippet) => {
            const truncatedNote = snippet.truncated
              ? "\n\n<!-- Snippet truncated. Inspect the full file before editing. -->"
              : "";

            return [
              `### ${snippet.relativePath}`,
              "",
              `\`\`\`${snippet.language}`,
              snippet.content,
              truncatedNote,
              "```"
            ].join("\n");
          })
          .join("\n\n")
      : "No code snippets were collected.";

  return `
## Code Context Snippets

These snippets are partial context only. Inspect full files before editing.

${snippets}
`.trim();
}

function buildNotesSection(projectContext: TaskAwareProjectContext) {
  const notes =
    projectContext.notes.length > 0
      ? projectContext.notes.map((note) => `- ${note}`).join("\n")
      : "- No additional project structure notes were detected.";

  return `
## ContextForge Assisted Notes

${notes}
`.trim();
}

function normalizeMarkdownSeparators(markdown: string) {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:\n---\s*){2,}/g, "\n---\n\n")
    .replace(/\n---\n\n---\n/g, "\n---\n")
    .trim();
}

function insertBeforeSection(markdown: string, sectionHeading: string, contentToInsert: string) {
  if (markdown.includes(contentToInsert.split("\n")[0])) {
    return markdown;
  }

  const marker = `\n${sectionHeading}`;

  if (!markdown.includes(marker)) {
    return `${markdown}\n\n---\n\n${contentToInsert}`;
  }

  return markdown.replace(marker, `\n${contentToInsert}\n\n---\n\n${sectionHeading}`);
}

export function postProcessTaskPackPrompt(
  markdown: string,
  projectContext: TaskAwareProjectContext
) {
  let result = markdown.trim();

  const relevantFilesSection = buildRelevantFilesSection(projectContext);
  const codeSnippetsSection = buildCodeSnippetsSection(projectContext);
  const notesSection = buildNotesSection(projectContext);

  result = insertBeforeSection(result, "## Agent Instructions", relevantFilesSection);
  result = insertBeforeSection(result, "## Agent Instructions", codeSnippetsSection);
  result = insertBeforeSection(result, "## Expected Final Response", notesSection);

  return normalizeMarkdownSeparators(result);
}