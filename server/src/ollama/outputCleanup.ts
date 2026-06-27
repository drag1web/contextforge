interface CleanupOllamaOutputOptions {
    expectedHeading?: string;
}

const LEADING_CHATTER_PATTERNS = [
    /^sure[,.!:\s-]*/i,
    /^of course[,.!:\s-]*/i,
    /^here is[^\n]*:\s*/i,
    /^here's[^\n]*:\s*/i,
    /^below is[^\n]*:\s*/i,
    /^i've improved[^\n]*:\s*/i,
    /^the improved[^\n]*:\s*/i
];

const TRAILING_CHATTER_PATTERNS = [
    /^note:\s*/i,
    /^this task pack prompt has been improved/i,
    /^this agents\.md file has been improved/i,
    /^i hope this helps/i
];

function unwrapMarkdownFence(value: string) {
    const trimmed = value.trim();

    const fenceMatch = trimmed.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);

    if (!fenceMatch) {
        return trimmed;
    }

    return fenceMatch[1].trim();
}

function removeLeadingChatter(value: string) {
    let result = value.trim();

    for (const pattern of LEADING_CHATTER_PATTERNS) {
        result = result.replace(pattern, "").trimStart();
    }

    const firstHeadingIndex = result.search(/^#\s+/m);

    if (firstHeadingIndex > 0) {
        return result.slice(firstHeadingIndex).trimStart();
    }

    return result;
}

function removeTrailingChatter(value: string) {
    const lines = value.trim().split("\n");
    const cleanedLines: string[] = [];

    for (const line of lines) {
        const trimmedLine = line.trim();

        const isTrailingChatter = TRAILING_CHATTER_PATTERNS.some((pattern) =>
            pattern.test(trimmedLine)
        );

        if (isTrailingChatter) {
            break;
        }

        cleanedLines.push(line);
    }

    return cleanedLines.join("\n").trim();
}

function sliceFromExpectedHeading(value: string, expectedHeading?: string) {
    if (!expectedHeading) {
        return value.trim();
    }

    const index = value.indexOf(expectedHeading);

    if (index === -1) {
        return value.trim();
    }

    return value.slice(index).trimStart();
}

function removeDuplicateHeadingOutline(value: string) {
    const lines = value.trim().split("\n");

    if (lines.length < 6) {
        return value.trim();
    }

    const firstLine = lines[0]?.trim();

    if (!firstLine.startsWith("# ")) {
        return value.trim();
    }

    const outlineHeadings: string[] = [];
    let cursor = 1;

    while (cursor < lines.length) {
        const line = lines[cursor].trim();

        if (!line) {
            cursor += 1;
            continue;
        }

        if (line.startsWith("## ")) {
            outlineHeadings.push(line);
            cursor += 1;
            continue;
        }

        break;
    }

    if (outlineHeadings.length < 3) {
        return value.trim();
    }

    while (cursor < lines.length && !lines[cursor].trim()) {
        cursor += 1;
    }

    const nextRealHeading = lines[cursor]?.trim();

    if (!nextRealHeading || nextRealHeading !== outlineHeadings[0]) {
        return value.trim();
    }

    return [firstLine, "", ...lines.slice(cursor)].join("\n").trim();
}

export function cleanupOllamaOutput(
    value: string,
    options: CleanupOllamaOutputOptions = {}
) {
    return removeDuplicateHeadingOutline(
        removeTrailingChatter(
            removeLeadingChatter(
                sliceFromExpectedHeading(
                    unwrapMarkdownFence(value),
                    options.expectedHeading
                )
            )
        )
    ).trim();
}

export function isUsableOllamaOutput(
    value: string,
    options: CleanupOllamaOutputOptions = {}
) {
    const cleaned = cleanupOllamaOutput(value, options);

    if (cleaned.length < 80) {
        return false;
    }

    if (options.expectedHeading && !cleaned.startsWith(options.expectedHeading)) {
        return false;
    }

    const refusalPatterns = [
        /i can('|’)t help/i,
        /i cannot help/i,
        /as an ai language model/i
    ];

    return !refusalPatterns.some((pattern) => pattern.test(cleaned));
}