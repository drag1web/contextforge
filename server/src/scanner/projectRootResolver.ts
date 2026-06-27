import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

const IGNORED_DIRECTORIES = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "out",
    "coverage",
    ".turbo",
    ".vercel"
]);

interface ProjectRootCandidate {
    localPath: string;
    score: number;
}

async function pathExists(targetPath: string) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function readJsonFile<T>(targetPath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(targetPath, "utf-8");
        return JSON.parse(content) as T;
    } catch {
        return null;
    }
}

async function scoreProjectRoot(localPath: string) {
    const packageJsonPath = path.join(localPath, "package.json");
    const packageJson = await readJsonFile<{
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    }>(packageJsonPath);

    if (!packageJson) {
        return 0;
    }

    let score = 100;

    const scripts = packageJson.scripts ?? {};
    const dependencies = {
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {})
    };

    if (scripts.dev) score += 20;
    if (scripts.build) score += 20;
    if (scripts.start) score += 10;
    if (scripts.test) score += 10;

    if (dependencies.react) score += 15;
    if (dependencies.next) score += 20;
    if (dependencies.vite) score += 15;
    if (dependencies.electron) score += 15;
    if (dependencies.typescript) score += 10;
    if (dependencies.tailwindcss) score += 10;

    if (await pathExists(path.join(localPath, "src"))) score += 10;
    if (await pathExists(path.join(localPath, "app"))) score += 10;
    if (await pathExists(path.join(localPath, "pages"))) score += 10;
    if (await pathExists(path.join(localPath, "tsconfig.json"))) score += 10;
    if (await pathExists(path.join(localPath, "README.md"))) score += 5;

    return score;
}

async function findProjectRootCandidates(
    selectedPath: string,
    maxDepth = 3
): Promise<ProjectRootCandidate[]> {
    const candidates: ProjectRootCandidate[] = [];

    async function walk(currentPath: string, depth: number) {
        if (depth > maxDepth) {
            return;
        }

        const score = await scoreProjectRoot(currentPath);

        if (score > 0) {
            candidates.push({
                localPath: currentPath,
                score
            });
        }

        let entries: Dirent<string>[];

        try {
            entries = await fs.readdir(currentPath, {
                withFileTypes: true,
                encoding: "utf8"
            });
        } catch {
            return;
        }

        for (const entry of entries) {
            const entryName = entry.name;

            if (!entry.isDirectory()) {
                continue;
            }

            if (IGNORED_DIRECTORIES.has(entryName)) {
                continue;
            }

            await walk(path.join(currentPath, entryName), depth + 1);
        }
    }

    await walk(selectedPath, 0);

    return candidates.sort((a, b) => b.score - a.score);
}

export async function resolveProjectRoot(selectedPath: string) {
    const normalizedPath = path.resolve(selectedPath);
    const directPackageJsonPath = path.join(normalizedPath, "package.json");

    if (await pathExists(directPackageJsonPath)) {
        return normalizedPath;
    }

    const candidates = await findProjectRootCandidates(normalizedPath);

    if (candidates.length === 0) {
        return normalizedPath;
    }

    return candidates[0].localPath;
}