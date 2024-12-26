import test from "ava"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath } from "url"

import { cli, processFiles } from "../index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function createTestFiles(baseDir, files) {
  for (const [filepath, content] of Object.entries(files)) {
    const fullPath = path.join(baseDir, filepath)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content || "test content")
  }
}

async function writeTestOutput(testDir, output) {
  const outputFilePath = path.join(testDir, "output.txt")
  await fs.writeFile(outputFilePath, output)
}

let testCounter = 0

function getUniqueTestDir() {
  const dirName = `test-${testCounter++}`
  return path.join(__dirname, dirName)
}

test.beforeEach(async (t) => {
  process.env.NODE_ENV = "test"
  t.context.originalArgv = process.argv
  t.context.originalInput = cli.input
  t.context.originalEnv = process.env.NODE_ENV
  t.context.testCount = testCounter + 1

  const testFiles = {
    "src/index.js": 'console.log("Hello");',
    "src/components/Button.js": "export const Button = () => {};",
    "src/components/Button.test.js": 'test("button", () => {});',
    "tailwind.config.js": "module.exports = {};",
    "components.json": '{ "version": 1 }',
    "README.md": "# Test Project",
    "test/helper.js": "export const helper = {};",
    ".env": "SECRET=123",
    "dist/bundle.js": 'console.log("bundled");',
  }

  const testDir = getUniqueTestDir()
  await fs.mkdir(testDir, { recursive: true })
  await createTestFiles(testDir, testFiles)

  t.context.testDir = testDir
})

test.afterEach.always(async (t) => {
  process.argv = t.context.originalArgv
  cli.input = t.context.originalInput
  process.env.NODE_ENV = t.context.originalEnv

  if (t.context.testDir) {
    await fs
      .rm(t.context.testDir, { recursive: true, force: true })
      .catch(() => {})
  }
})

test("excludes specific files by exact name", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["tailwind.config.js", "components.json"],
  })

  t.false(
    output.includes("tailwind.config.js"),
    "Should not include tailwind.config.js"
  )
  t.false(
    output.includes("components.json"),
    "Should not include components.json"
  )
  t.true(output.includes("src/index.js"), "Should include non-excluded files")
})

test("excludes files matching glob patterns", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["**/*.test.js", "dist/**"],
  })

  t.false(output.includes("Button.test.js"), "Should not include test files")
  t.false(
    output.includes("dist/bundle.js"),
    "Should not include files in dist directory"
  )
  t.true(
    output.includes("src/components/Button.js"),
    "Should include non-test files"
  )
})

test("handles multiple exclusion patterns", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["*.json", "*.js", "!src/**"],
  })

  t.true(output.includes("src/index.js"), "Should include JS files in src")
  t.true(
    output.includes("src/components/Button.js"),
    "Should include JS files in src/components"
  )
  t.false(
    output.includes("tailwind.config.js"),
    "Should exclude JS files in root"
  )
  t.false(output.includes("components.json"), "Should exclude JSON files")
})

test("loads exclusions from file", async (t) => {
  const exclusionPath = path.join(t.context.testDir, ".gitignore")
  const exclusions = [
    "*.test.js",
    "dist/*",
    "dist/",
    "tailwind.config.js",
    "# This is a comment",
    "",
    "components.json",
  ].join("\n")

  await fs.writeFile(exclusionPath, exclusions)

  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    excludeFile: exclusionPath,
  })

  t.false(output.includes("Button.test.js"), "Should not include test files")
  t.false(output.includes("dist/bundle.js"), "Should not include files in dist")
  t.false(
    output.includes("tailwind.config.js"),
    "Should not include explicitly excluded files"
  )
  t.true(output.includes("src/index.js"), "Should include non-excluded files")
})

test("handles dot file exclusions", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: [".*"],
  })

  t.false(output.includes(".env"), "Should not include dot files")
  t.true(output.includes("README.md"), "Should include non-dot files")
})

test("excludes entire directories", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["src/**"],
  })

  t.false(output.includes("src/index.js"), "Should not include files in src")
  t.false(
    output.includes("src/components/Button.js"),
    "Should not include files in src subdirectories"
  )
  t.true(output.includes("README.md"), "Should include files outside src")
})

test("combines file and pattern exclusions", async (t) => {
  const exclusionPath = path.join(t.context.testDir, ".excludes")
  await fs.writeFile(exclusionPath, "*.test.js\ndist/*")

  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["tailwind.config.js"],
    excludeFile: exclusionPath,
  })

  await writeTestOutput(t.context.testDir, output)

  // console.log({ output, t: t.context.testCount })

  t.false(
    output.includes("Button.test.js"),
    "Should not include test files from exclusion file"
  )
  t.false(
    output.includes("dist/bundle.js"),
    "Should not include dist files from exclusion file"
  )
  t.false(
    output.includes("tailwind.config.js"),
    "Should not include explicitly excluded files"
  )
  t.true(output.includes("src/index.js"), "Should include non-excluded files")
})

test("handles invalid exclusion patterns gracefully", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["[invalid pattern"],
  })

  t.true(
    output.includes("src/index.js"),
    "Should process files when pattern is invalid"
  )
})

test("processes all files when no exclusions specified", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: [],
  })

  t.true(
    output.includes("src/index.js"),
    "Should include all files when no exclusions"
  )
  t.true(
    output.includes("tailwind.config.js"),
    "Should include config files when no exclusions"
  )
})

test("handles missing exclusion file gracefully", async (t) => {
  await t.throwsAsync(
    processFiles(t.context.testDir, {
      threshold: 1,
      excludeFile: "nonexistent-file",
    }),
    { message: /Failed to load exclusion file/ }
  )
})

test("handles nested pattern matching correctly", async (t) => {
  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["src/**/test.js", "**/dist/**"],
  })

  t.false(
    output.includes("src/components/test.js"),
    "Should exclude nested test files"
  )
  t.false(
    output.includes("dist/"),
    "Should exclude all files in dist directory"
  )
  t.true(
    output.includes("src/components/Button.js"),
    "Should include non-matching nested files"
  )
})

test("handles case sensitivity in patterns", async (t) => {
  await createTestFiles(t.context.testDir, {
    "src/TEST.js": "test content",
    "src/what.js": "test content",
  })

  const output = await processFiles(t.context.testDir, {
    threshold: 1,
    exclude: ["**/TEST.js", "**/WHAT.js"],
  })

  await writeTestOutput(t.context.testDir, output)

  t.false(output.includes("src/TEST.js"), "Should exclude exact case match")
  t.true(output.includes("src/what.js"), "Should not exclude different case")
})
