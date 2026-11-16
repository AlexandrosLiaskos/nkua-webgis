// Syntax check of every JavaScript file in the repository.
//
// Each file is parsed with `node --check`. A file that does not parse as a
// classic script is parsed again as an ES module, from a temporary copy with
// the extension .mjs, because the pages load most of their scripts as modules.
//
// Run from the root of the repository: node tools/checks/check_js.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const files = execFileSync("git", ["ls-files", "-z", "--", "*.js", "*.mjs", "*.cjs"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

function parseError(path) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  return result.status === 0 ? null : (result.stderr || result.stdout).trim();
}

const temporary = mkdtempSync(join(tmpdir(), "check-js-"));
let failures = 0;
let modules = 0;
try {
  files.forEach((file, index) => {
    let error = parseError(file);
    if (error !== null && file.endsWith(".js")) {
      const copy = join(temporary, `${index}.mjs`);
      copyFileSync(file, copy);
      const moduleError = parseError(copy);
      if (moduleError === null) {
        error = null;
        modules += 1;
      } else {
        error = `${error}\nAs an ES module: ${moduleError}`;
      }
    }
    if (error !== null) {
      failures += 1;
      console.error(`FAIL ${file}\n${error}\n`);
    }
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(
  `${files.length - failures} of ${files.length} JavaScript files parse ` +
    `(${modules} of them only as ES modules).`,
);
process.exit(failures === 0 ? 0 : 1);
