import micromatch from "micromatch"
import path from "path"
import fs from "fs/promises"

/**
 * Determines if a file should be excluded based on exclusion patterns
 * @param {string} filepath - Relative path of the file to check
 * @param {string[]} patterns - Array of exclusion patterns (glob patterns)
 * @returns {boolean} - True if file should be excluded, false otherwise
 */
export function shouldExcludeFile(filepath, patterns) {
  if (!patterns || patterns.length === 0) {
    return false
  }

  const normalizedPath = filepath.split(path.sep).join("/")

  // Convert simple patterns like *.js to **/*.js to match nested files
  const expandedPatterns = patterns.map((pattern) => {
    if (pattern.startsWith("!")) {
      // Handle negative patterns
      const basePattern = pattern.slice(1)
      return (
        "!" + (basePattern.includes("/") ? basePattern : `**/${basePattern}`)
      )
    }
    // Handle positive patterns
    return pattern.includes("/") ? pattern : `**/${pattern}`
  })

  // Split into positive and negative patterns
  const negativePatterns = expandedPatterns
    .filter((p) => p.startsWith("!"))
    .map((p) => p.slice(1))
  const positivePatterns = expandedPatterns.filter((p) => !p.startsWith("!"))

  // If there are only negative patterns, don't exclude by default
  if (positivePatterns.length === 0) {
    return false
  }

  // Check if file matches any positive pattern
  const matches =
    micromatch([normalizedPath], positivePatterns, { nocase: false }).length > 0

  // If it matches a positive pattern, check negative patterns
  if (matches && negativePatterns.length > 0) {
    // If file matches any negative pattern, don't exclude it
    const negativeMatches =
      micromatch([normalizedPath], negativePatterns, { nocase: false }).length >
      0
    return !negativeMatches
  }

  return matches
}

/**
 * Load and parse exclusion patterns from a file
 * @param {string} content - Content of the exclusion file
 * @returns {string[]} Array of valid exclusion patterns
 */
export function parseExclusionFile(content) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
}

const DEFAULT_EXCLUSION_FILES = [".excludes", "excludes.txt"]

/**
 *
 * @param {string} directory - Directory to load exclusions from
 * @param {boolean} debug  - Whether to enable debug mode
 * @returns {Promise<string[]>} Array of exclusion patterns
 */

export async function loadDefaultExclusions(directory, debug = false) {
  let patterns = []

  for (const file of DEFAULT_EXCLUSION_FILES) {
    try {
      const filePath = path.join(directory, file)

      const content = await fs.readFile(filePath, "utf-8")

      patterns = parseExclusionFile(content)

      if (debug) {
        console.log(
          `Loaded ${patterns.length} exclusion patterns from ${filePath}`
        )
      }

      break
    } catch (error) {
      if (debug) {
        if (error.code === "ENOENT") {
          console.log(`No ${file} file found in ${directory}`)
        }

        console.error(`Error loading ${file} file:`, error)
      }
    }
  }

  return patterns
}

/**
 *
 * @param {string} directory directory to load exclusions from
 * @param {string[]} explicitPatterns explicit patterns provided from the cli
 * @param {string} excludeFile path to exclusion file
 * @param {boolean} debug whether to enable debug mode
 */
export async function getExclusionPatterns(
  directory,
  explicitPatterns = [],
  excludeFile = "",
  debug = false
) {
  let patterns = new Set(explicitPatterns)

  if (excludeFile) {
    try {
      const fileContent = await fs.readFile(excludeFile, "utf-8")
      parseExclusionFile(fileContent).forEach((p) => patterns.add(p))

      if (debug) {
        console.log(
          `Loaded ${patterns.size} exclusion patterns from ${excludeFile}`
        )
      }
    } catch (error) {
      throw new Error(`Failed to load exclusion file: ${error.message}`)
    }
  }

  const defaultPatterns = await loadDefaultExclusions(directory, debug)
  console.log({ defaultPatterns })
  defaultPatterns.forEach((p) => patterns.add(p))

  return Array.from(patterns)
}
