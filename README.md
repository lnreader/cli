# LNReader CLI

Convert web/light novels from websites to EPUB format for offline reading.

## Installation

**Requires:** Go 1.16+

```bash
# Build from source
git clone https://github.com/lnreader/cli.git && cd cli
go build -o lnreader-cli ./cmd/cli

# Optional: Add to PATH
mv lnreader-cli /usr/local/bin/
```

## Usage

```bash
lnreader-cli [URL]                          # Basic usage
lnreader-cli -o path/to/output.epub [URL]   # Custom output path
lnreader-cli -v [URL]                       # Verbose logging
```

**Options:**
- `-o, --output`: Set output EPUB path
- `-v, --verbose`: Enable verbose logging

## Supported Websites
- AllNovelFull (https://allnovelfull.net)

## Adding Website Support

Implement the `Scraper` interface from `internal/scraper/scraper.go`. See examples in `internal/scraper/sites/`.

## License
[MIT License](LICENSE)

