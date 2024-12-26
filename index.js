#!/usr/bin/env node

/**
 * git2txt - A command-line tool to convert GitHub repositories into readable text files
 *
 * This tool clones a GitHub repository, processes its text files, and combines them
 * into a single output file. It's useful for code review, analysis, and documentation
 * purposes.
 *
 * Features:
 * - Supports public GitHub repositories
 * - Filters binary and large files
 * - Customizable file size threshold
 * - Debug mode for troubleshooting
 * - Progress indicators for long operations
 *
 * @module git2txt
 */

import meow from "meow"
import ora from "ora"
import chalk from "chalk"
import { glob } from "glob"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { filesize as formatFileSize } from "filesize"
import { isBinaryFile } from "isbinaryfile"
import os from "os"
import { exec } from "child_process"
import { promisify } from "util"
import micromatch from "micromatch"
import {
  shouldExcludeFile,
  parseExclusionFile,
  getExclusionPatterns,
} from "./file-exclusion.js"
const execAsync = promisify(exec)

// CLI help text with usage instructions and examples
const helpText = `
  ${chalk.bold("Usage")}
    $ git2txt <repository-url>

  ${chalk.bold("Options")}
    --output, -o     Specify output file path
    --threshold, -t  Set file size threshold in MB (default: 0.5)
    --include-all    Include all files regardless of size or type
    --debug         Enable debug mode with verbose logging
    --help          Show help
    --version       Show version

  ${chalk.bold("Examples")}
    $ git2txt https://github.com/username/repository
    $ git2txt https://github.com/username/repository --output=output.txt
`

/**
 * Custom exit function that handles both production and test environments
 * @param {number} code - Exit code to return
 * @throws {Error} In test environment instead of exiting
 */
const exit = (code) => {
  if (process.env.NODE_ENV === "test") {
    throw new Error(`Exit called with code: ${code}`)
  } else {
    process.exit(code)
  }
}

// Initialize CLI parser with meow
export const cli = meow(helpText, {
  importMeta: import.meta,
  flags: {
    output: {
      type: "string",
      shortFlag: "o",
    },
    threshold: {
      type: "number",
      shortFlag: "t",
      default: 0.1,
    },
    includeAll: {
      type: "boolean",
      default: false,
    },
    exclude: {
      type: "string",
      shortFlag: "e",
      isMultiple: true,
      default: [],
    },
    excludeFile: {
      type: "string",
      shortFlag: "f",
      default: "",
    },
    debug: {
      type: "boolean",
      default: false,
    },
  },
})

/**
 * Loads exclusion patterns from a file
 * @param {string} filepath - Path to the file with exclusion patterns
 * @returns {Promise<string[]>} Array of exclusion patterns
 */

async function loadExclusionFile(filepath) {
  try {
    const content = await fs.readFile(filepath, "utf-8")
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  } catch (error) {
    throw new Error(`Failed to load exclusion file: ${error.message}`)
  }
}

/**
 * Normalizes various GitHub URL formats to a consistent format
 * @param {string} url - The GitHub repository URL to normalize
 * @returns {string} Normalized GitHub URL
 * @throws {Error} If URL format is invalid
 */
function normalizeGitHubUrl(url) {
  try {
    // Remove trailing slashes
    url = url.replace(/\/+$/, "")

    // Handle git@ URLs
    if (url.startsWith("git@github.com:")) {
      return url
    }

    // Handle full HTTPS URLs
    if (url.startsWith("https://github.com/")) {
      return url
    }

    // Handle short format (user/repo)
    if (url.match(/^[\w-]+\/[\w-]+$/)) {
      return `https://github.com/${url}`
    }

    throw new Error("Invalid GitHub repository URL format")
  } catch (error) {
    throw new Error(`Invalid GitHub URL: ${url}`)
  }
}

/**
 * Validates the command line input
 * @param {string[]} input - Command line arguments
 * @returns {Promise<string>} Validated repository URL
 * @throws {Error} If input is missing or invalid
 */
export async function validateInput(input) {
  if (!input || input.length === 0) {
    throw new Error("Repository URL is required")
  }

  const url = input[0]
  if (!url.includes("github.com") && !url.match(/^[\w-]+\/[\w-]+$/)) {
    throw new Error("Only GitHub repositories are supported")
  }

  return url
}

/**
 * Downloads a GitHub repository to a temporary directory
 * @param {string} url - GitHub repository URL
 * @returns {Promise<Object>} Object containing temporary directory path and repository name
 * @throws {Error} If download fails
 */
export async function downloadRepository(url) {
  const spinner =
    process.env.NODE_ENV !== "test"
      ? ora("Downloading repository...").start()
      : null
  const tempDir = path.join(os.tmpdir(), `git2txt-${Date.now()}`)

  try {
    // Normalize the GitHub URL
    const normalizedUrl = normalizeGitHubUrl(url)
    const repoName = url.split("/").pop().replace(".git", "")

    if (cli.flags.debug) {
      console.log(chalk.blue("Debug: Normalized URL:"), normalizedUrl)
      console.log(chalk.blue("Debug: Temp directory:"), tempDir)
    }

    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true })

    // Clone the repository
    const cloneCommand = `git clone --depth 1 ${normalizedUrl} ${tempDir}`

    if (cli.flags.debug) {
      console.log(chalk.blue("Debug: Executing command:"), cloneCommand)
    }

    await execAsync(cloneCommand, {
      maxBuffer: 1024 * 1024 * 100, // 100MB buffer
    })

    // Verify the download
    const files = await fs.readdir(tempDir)
    if (files.length === 0) {
      throw new Error("Repository appears to be empty")
    }

    if (spinner) spinner.succeed("Repository downloaded successfully")
    return { tempDir, repoName }
  } catch (error) {
    if (spinner) spinner.fail("Failed to download repository")

    if (cli.flags.debug) {
      console.log(chalk.blue("Debug: Full error:"), error)
    }

    if (process.env.NODE_ENV !== "test") {
      console.error(
        chalk.red("Error: Could not access the repository. Please check:")
      )
      console.error(chalk.yellow("  1. The repository exists and is public"))
      console.error(chalk.yellow("  2. You have the correct repository URL"))
      console.error(chalk.yellow("  3. GitHub is accessible from your network"))
      console.error(
        chalk.yellow("  4. Git is installed and accessible from command line")
      )
    }

    await cleanup(tempDir)
    throw error
  }
}

/**
 * Processes files in the repository directory and combines them into a single text output
 * @param {string} directory - Path to the repository directory
 * @param {Object} options - Processing options
 * @param {number} options.threshold - File size threshold in MB
 * @param {boolean} options.includeAll - Whether to include all files regardless of size/type
 *@param {string[]} options.exclude - Array of exclusion patterns or file names. Supports glob patterns like '*.js', 'test/**'
 * @param {string} options.excludeFile - Path to an exclusion file containing patterns
 * @returns {Promise<string>} Combined content of all processed files
 * @throws {Error} If file processing fails
 */
// export async function processFiles(directory, options = {}) {
//   console.log("Recieved Options", options)

//   let spinner =
//     process.env.NODE_ENV !== "test" ? ora("Processing files...").start() : null
//   const thresholdBytes = options.threshold * 1024 * 1024
//   let output = ""
//   let processedFiles = 0
//   let skippedFiles = 0

//   const exclusions = {
//     patterns: [],
//     explicitNames: new Set(),
//   }

//   if (options.exclude) {
//     if (cli.flags.debug) {
//       console.log("Excluding files based on patterns: ", options.exclude)
//     }
//     exclusions.patterns = Array.isArray(options.exclude)
//       ? options.exclude
//       : [options.exclude]
//   }

//   if (options.excludeFile) {
//     if (cli.flags.debug) {
//       console.log("Loading exclusions from file: ", options.excludeFile)
//     }

//     try {
//       const filePatterns = await loadExclusionFile(options.excludeFile)
//       exclusions.patterns.push(...filePatterns)
//     } catch (error) {
//       throw new Error(`Failed to load exclusion file: ${error.message}`)
//     }
//   }

//   exclusions.explicitNames = new Set(
//     exclusions.patterns.filter((p) => !p.includes("*") && !p.includes("?"))
//   )

//   /**
//    * Check if a file should be excluded based on patterns
//    * @param {string} filePath - Path of the file to check
//    * @returns {boolean} - True if file should be excluded
//    */
//   function shouldExclude(filePath) {
//     // If no patterns, include everything
//     if (patterns.length === 0) {
//       return false
//     }

//     // Normalize path for cross-platform compatibility
//     const normalizedPath = filePath.split(path.sep).join("/")

//     let excluded = false

//     // Process patterns in order
//     for (const pattern of patterns) {
//       try {
//         // Handle negation patterns
//         if (pattern.startsWith("!")) {
//           if (
//             micromatch.isMatch(normalizedPath, pattern.slice(1), { dot: true })
//           ) {
//             return false // Explicitly included
//           }
//         } else {
//           // Regular pattern
//           if (micromatch.isMatch(normalizedPath, pattern, { dot: true })) {
//             excluded = true
//           }
//         }
//       } catch (error) {
//         console.warn(`Invalid pattern ${pattern}:`, error.message)
//       }
//     }

//     return excluded
//   }

//   /**
//    * Recursively processes files in a directory
//    * @param {string} dir - Directory to process
//    */
//   async function processDirectory(dir) {
//     const entries = await fs.readdir(dir, { withFileTypes: true })

//     for (const entry of entries) {
//       const fullPath = path.join(dir, entry.name)
//       const relativePath = path.relative(directory, fullPath)

//       if (entry.isDirectory()) {
//         if (entry.name === "node_modules" || entry.name === ".git") {
//           continue
//         }

//         await processDirectory(fullPath)
//         continue
//       }

//       if (!entry.isFile()) continue

//       try {
//         if (await shouldExcludeFile(fullPath, relativePath, exclusions)) {
//           excludedFiles++
//           continue
//         }

//         const stats = await fs.stat(fullPath)

//         // Skip if file is too large and we're not including all files
//         if (!options.includeAll && stats.size > thresholdBytes) {
//           if (process.env.DEBUG)
//             console.log(`Skipping large file: ${entry.name}`)
//           skippedFiles++
//           continue
//         }

//         // Skip binary files unless includeAll is true
//         if (!options.includeAll) {
//           if (await isBinaryFile(fullPath)) {
//             if (process.env.DEBUG)
//               console.log(`Skipping binary file: ${entry.name}`)
//             skippedFiles++
//             continue
//           }
//         }

//         const content = await fs.readFile(fullPath, "utf8")

//         // Convert to forward slashes for platform independence
//         const relativePath = path
//           .relative(directory, fullPath)
//           .split(path.sep)
//           .join("/")

//         output += `\n${"=".repeat(80)}\n`
//         output += `File: ${relativePath}\n`
//         output += `Size: ${formatFileSize(stats.size)}\n`
//         output += `${"=".repeat(80)}\n\n`
//         output += `${content}\n`

//         processedFiles++

//         if (process.env.DEBUG) {
//           console.log(`Processed file: ${relativePath}`)
//         }
//       } catch (error) {
//         if (process.env.DEBUG) {
//           console.error(`Error processing ${entry.name}:`, error)
//         }
//         skippedFiles++
//       }
//     }
//   }

//   try {
//     // Process the entire directory tree
//     await processDirectory(directory)

//     if (spinner) {
//       spinner.succeed(
//         `Processed ${processedFiles} files successfully (${skippedFiles} skipped)`
//       )
//     }

//     if (processedFiles === 0 && process.env.DEBUG) {
//       console.warn("Warning: No files were processed")
//     }

//     return output
//   } catch (error) {
//     if (spinner) {
//       spinner.fail("Failed to process files")
//     }
//     throw error
//   }
// }

// /**
//  * Processes files in the repository directory with exclusion support
//  * @param {string} directory - Directory to process
//  * @param {Object} options - Processing options
//  * @param {number} options.threshold - File size threshold in MB
//  * @param {boolean} options.includeAll - Whether to include all files
//  * @param {string[]} [options.exclude] - Exclusion patterns
//  * @param {string} [options.excludeFile] - Path to exclusion file
//  * @returns {Promise<string>} Combined content of processed files
//  */
// export async function processFiles(directory, options = {}) {
//   let output = ""
//   let processedFiles = 0
//   let skippedFiles = 0

//   // Initialize exclusion patterns
//   let patterns = []

//   // Add patterns from options.exclude
//   if (options.exclude) {
//     patterns = patterns.concat(options.exclude)
//   }

//   // Add patterns from excludeFile if specified
//   if (options.excludeFile) {
//     try {
//       const fileContent = await fs.readFile(options.excludeFile, "utf-8")
//       const filePatterns = fileContent
//         .split("\n")
//         .map((line) => line.trim())
//         .filter((line) => line && !line.startsWith("#"))
//       patterns = patterns.concat(filePatterns)
//     } catch (error) {
//       throw new Error(`Failed to load exclusion file: ${error.message}`)
//     }
//   }

//   /**
//    * Check if a file should be excluded based on patterns
//    * @param {string} filePath - Path of the file to check
//    * @returns {boolean} - True if file should be excluded
//    */
//   function shouldExclude(filePath) {
//     // If no patterns, include everything
//     if (patterns.length === 0) {
//       return false
//     }

//     // Normalize path for cross-platform compatibility
//     const normalizedPath = filePath.split(path.sep).join("/")

//     let excluded = false

//     // Process patterns in order
//     for (const pattern of patterns) {
//       try {
//         // Handle negation patterns
//         if (pattern.startsWith("!")) {
//           if (
//             micromatch.isMatch(normalizedPath, pattern.slice(1), { dot: true })
//           ) {
//             return false // Explicitly included
//           }
//         } else {
//           // Regular pattern
//           if (micromatch.isMatch(normalizedPath, pattern, { dot: true })) {
//             excluded = true
//           }
//         }
//       } catch (error) {
//         console.warn(`Invalid pattern ${pattern}:`, error.message)
//       }
//     }

//     return excluded
//   }

//   /**
//    * Process a directory recursively
//    * @param {string} dir - Directory to process
//    */
//   async function processDirectory(dir) {
//     const entries = await fs.readdir(dir, { withFileTypes: true })

//     for (const entry of entries) {
//       const fullPath = path.join(dir, entry.name)

//       // Skip node_modules and .git directories
//       if (entry.isDirectory()) {
//         if (entry.name === "node_modules" || entry.name === ".git") {
//           continue
//         }
//         await processDirectory(fullPath)
//         continue
//       }

//       if (!entry.isFile()) {
//         continue
//       }

//       try {
//         const relativePath = path.relative(directory, fullPath)

//         // Check if file should be excluded
//         if (shouldExclude(relativePath)) {
//           skippedFiles++
//           continue
//         }

//         const stats = await fs.stat(fullPath)

//         // Skip large files unless includeAll is true
//         if (
//           !options.includeAll &&
//           stats.size > options.threshold * 1024 * 1024
//         ) {
//           skippedFiles++
//           continue
//         }

//         // Skip binary files unless includeAll is true
//         if (!options.includeAll && (await isBinaryFile(fullPath))) {
//           skippedFiles++
//           continue
//         }

//         // Read and add file content
//         const content = await fs.readFile(fullPath, "utf8")
//         const normalizedPath = relativePath.split(path.sep).join("/")

//         output += `\n${"=".repeat(80)}\n`
//         output += `File: ${normalizedPath}\n`
//         output += `Size: ${formatFileSize(stats.size)}\n`
//         output += `${"=".repeat(80)}\n\n`
//         output += `${content}\n`

//         processedFiles++
//       } catch (error) {
//         if (cli.flags.debug) {
//           console.error(`Error processing ${entry.name}:`, error)
//         }
//         skippedFiles++
//       }
//     }
//   }

//   await processDirectory(directory)
//   return output
// }

/**
 * Writes the processed content to an output file
 * @param {string} content - Content to write
 * @param {string} outputPath - Path to the output file
 * @returns {Promise<void>}
 * @throws {Error} If writing fails
 */
export async function writeOutput(content, outputPath) {
  let spinner =
    process.env.NODE_ENV !== "test"
      ? ora("Writing output file...").start()
      : null

  try {
    await fs.writeFile(outputPath, content)
    if (spinner) spinner.succeed(`Output saved to ${chalk.green(outputPath)}`)
  } catch (error) {
    if (spinner) spinner.fail("Failed to write output file")
    if (process.env.NODE_ENV !== "test") {
      console.error(chalk.red("Write error:"), error)
    }
    throw error
  }
}

/**
 * Cleans up temporary files and directories
 * @param {string} directory - Directory to clean up
 * @returns {Promise<void>}
 */
export async function cleanup(directory) {
  try {
    await fs.rm(directory, { recursive: true, force: true })
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error(chalk.yellow("Warning: Failed to clean up temporary files"))
    }
  }
}

/**
 * Processes files in the repository directory and combines them into a single text output
 * @param {string} directory - Path to the repository directory
 * @param {Object} options - Processing options
 * @param {number} options.threshold - File size threshold in MB
 * @param {boolean} options.includeAll - Whether to include all files regardless of size/type
 * @param {string[]} options.exclude - Array of exclusion patterns
 * @param {string} options.excludeFile - Path to an exclusion file containing patterns
 * @returns {Promise<string>} Combined content of all processed files
 * @throws {Error} If file processing fails
 */
export async function processFiles(directory, options = {}) {
  const spinner =
    process.env.NODE_ENV !== "test" ? ora("Processing files...").start() : null
  const thresholdBytes = options.threshold * 1024 * 1024
  let output = ""
  let processedFiles = 0
  let skippedFiles = 0
  let exclusionPatterns = []

  try {
    exclusionPatterns = await getExclusionPatterns(
      directory,
      options.exclude || [],
      options.excludeFile,
      cli.flags.debug
    )
    console.log({ exclusionPatterns })
  } catch (error) {
    throw new Error(`Failed to load exclusion patterns: ${error.message}`)
  }

  async function processDirectory(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      // Skip dot directories (e.g. .next)
      if (entry.isDirectory() && entry.name.startsWith(".")) continue

      // Skip node_modules and .git directories
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          await processDirectory(fullPath)
        }
        continue
      }

      if (!entry.isFile()) continue

      // skip dot files
      if (entry.isFile() && entry.name.startsWith(".")) continue

      try {
        const relativePath = path
          .relative(directory, fullPath)
          .split(path.sep)
          .join("/")

        if (shouldExcludeFile(relativePath, exclusionPatterns)) {
          if (cli.flags.debug) {
            console.log(`Excluded file: ${relativePath}`)
          }
          skippedFiles++
          continue
        }

        const stats = await fs.stat(fullPath)

        // Skip large files unless includeAll is true
        if (!options.includeAll && stats.size > thresholdBytes) {
          if (cli.flags.debug) {
            console.log(`Skipping large file: ${relativePath}`)
          }
          skippedFiles++
          continue
        }

        // Skip binary files unless includeAll is true
        if (!options.includeAll && (await isBinaryFile(fullPath))) {
          if (cli.flags.debug) {
            console.log(`Skipping binary file: ${relativePath}`)
          }
          skippedFiles++
          continue
        }

        // Read and append file content
        const content = await fs.readFile(fullPath, "utf8")
        output += `\n${"=".repeat(80)}\n`
        output += `File: ${relativePath}\n`
        output += `Size: ${formatFileSize(stats.size)}\n`
        output += `${"=".repeat(80)}\n\n`
        output += `${content}\n`

        processedFiles++

        if (cli.flags.debug) {
          console.log(`Processed file: ${relativePath}`)
        }
      } catch (error) {
        if (cli.flags.debug) {
          console.error(`Error processing ${entry.name}:`, error)
        }
        skippedFiles++
      }
    }
  }

  try {
    await processDirectory(directory)

    if (spinner) {
      spinner.succeed(
        `Processed ${processedFiles} files successfully (${skippedFiles} skipped)`
      )
    }

    if (processedFiles === 0) {
      if (cli.flags.debug) {
        console.warn("Warning: No files were processed")
      }
      if (spinner) {
        spinner.warn("No files were processed")
      }
    }

    return output
  } catch (error) {
    if (spinner) {
      spinner.fail("Failed to process files")
    }
    throw error
  }
}

/**
 * Main application function that orchestrates the entire process
 * @returns {Promise<void>}
 */
export async function main() {
  let tempDir
  try {
    const url = await validateInput(cli.input)
    if (process.env.NODE_ENV !== "test") {
      const result = await downloadRepository(url)
      tempDir = result.tempDir

      const outputPath = cli.flags.output || `${result.repoName}.txt`
      const content = await processFiles(tempDir, {
        threshold: cli.flags.threshold,
        includeAll: cli.flags.includeAll,
      })

      if (!content) {
        throw new Error("No content was generated from the repository")
      }

      await writeOutput(content, outputPath)
    }
  } catch (error) {
    if (process.env.NODE_ENV === "test") {
      throw error
    } else {
      console.error(chalk.red("\nAn unexpected error occurred:"))
      console.error(error.message || error)
      exit(1)
    }
  } finally {
    if (tempDir) {
      await cleanup(tempDir)
    }
  }
}

// Only run main if not in test environment
if (process.env.NODE_ENV !== "test") {
  main()
}
