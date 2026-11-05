import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root, found by walking up to pnpm-workspace.yaml so CLI paths work from any cwd. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error("could not find repo root (pnpm-workspace.yaml)");
    dir = up;
  }
}

export const fromRoot = (...parts: string[]): string => resolve(repoRoot(), ...parts);

export const PATHS = {
  devFixtures: () => fromRoot("fixtures", "dev"),
  privateRoot: () => fromRoot("fixtures", "private"),
  assessmentFixtures: () => fromRoot("fixtures", "private", "assessment"),
  releasedAssessment: () => fromRoot("fixtures", "released-assessment"),
  evidence: () => fromRoot("evidence"),
};
