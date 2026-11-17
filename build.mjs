import { copyFile, mkdir, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const output = "dist";
const publicExtensions = new Set([
  ".html",
  ".txt",
  ".xml",
  ".jpg",
  ".jpeg",
  ".png",
  ".svg",
  ".webp",
  ".css",
  ".js",
]);

await mkdir(output, { recursive: true });

for (const entry of await readdir(".", { withFileTypes: true })) {
  if (!entry.isFile() || !publicExtensions.has(extname(entry.name).toLowerCase())) continue;
  await copyFile(entry.name, join(output, entry.name));
}

console.log(`Copied public site files to ${output}/`);
