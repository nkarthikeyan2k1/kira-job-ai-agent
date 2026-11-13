import { fileURLToPath } from "node:url";

const dataFile = (name: string) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));

// Personal files. Everything under apps/agent/data/ is gitignored and stays on this machine.
export const PATHS = {
  profileJson: dataFile("profile.json"),
  resumeTex: dataFile("resume/main.tex"), // Overleaf source: the master resume
  resumePdf: dataFile("resume.pdf"), // fallback when there is no LaTeX source
} as const;
