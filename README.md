# git2txt

Convert GitHub repositories to text files with ease. This CLI tool downloads a repository and concatenates its contents into a single text file, making it perfect for analysis, documentation, or AI training purposes.

![Screenshot](https://github.com/user-attachments/assets/846fcec4-5919-44c7-956d-ca0ee6384c77)

## Features

- 📥 Download any public GitHub repository
- 📝 Convert repository contents to a single text file
- ⚡ Automatic binary file exclusion
- 🔧 Configurable file size threshold
- 💻 Cross-platform support (Windows, macOS, Linux)

## Installation

```bash
npm install -g git2txt
```

## Usage

You can specify the repository in several formats:

```bash
# Full HTTPS URL
git2txt https://github.com/username/repository

# Short format (username/repository)
git2txt username/repository

# SSH format
git2txt git@github.com:username/repository
```

### URL Format Support

The tool accepts these GitHub repository URL formats:

- HTTPS URLs: `https://github.com/username/repository`
- Short format: `username/repository`
- SSH URLs: `git@github.com:username/repository`
- URLs with or without `.git` suffix
- URLs with or without trailing slashes

### Options

```
--output, -o     Specify output file path (default: repo-name.txt)
--threshold, -t  Set file size threshold in MB (default: 0.1)
--include-all    Include all files regardless of size or type
--debug         Enable debug mode with verbose logging
--help          Show help
--version       Show version
```

### Examples

Download and convert a repository using different formats:

```bash
# Using HTTPS URL
git2txt https://github.com/username/repository

# Using short format
git2txt username/repository

# Using SSH URL
git2txt git@github.com:username/repository

# With custom output file
git2txt username/repository --output=output.txt

# With custom file size threshold (2MB)
git2txt username/repository --threshold=2

# Include all files (no size/type filtering)
git2txt username/repository --include-all

# Enable debug output
git2txt username/repository --debug
```

## Default Behavior

- Files larger than 100KB are excluded by default
- Binary files are automatically excluded
- The output file is created in the current directory named after the repository
- Files are processed recursively through all subdirectories (excluding node_modules and .git)
- File paths and contents are separated by clear markers
- Relative paths are preserved in the output

## Output Format

The tool generates a text file with this format:

```
================================================================================
File: path/to/file.txt
Size: 1.2 KB
================================================================================

[File contents here]

================================================================================
File: another/file.js
Size: 4.5 KB
================================================================================

[File contents here]
```

## File Exclusions

You can exclude files and directories using patterns or explicit names:

```bash
# Exclude files by pattern
git2txt username/repository --exclude="*.log" --exclude="test/**"

# Exclude using a file containing patterns
git2txt username/repository --exclude-file=.gitignore

# Combine multiple exclusion methods
git2txt username/repository --exclude="*.tmp" --exclude-file=.gitignore
```

### Exclusion File Format

The exclusion file should contain one pattern per line:

```plaintext
# Ignore all log files
*.log

# Ignore the entire test directory
test/**

# Ignore specific files
TODO.md
docs/private.txt

# Empty lines and comments are ignored
```

#### Pattern Matching

The tool supports various glob patterns:

- `*` matches any number of characters except slashes
- `**` matches any number of characters including slashes
- `?` matches a single character
- `[...]` matches a range of characters
- `!` negates a pattern

Examples:

```bash
# Exclude all JavaScript files
--exclude="*.js"

# Exclude test directories anywhere in the tree
--exclude="**/test"

# Exclude specific file types in specific directories
--exclude="src/**/*.test.js"
## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT
```
