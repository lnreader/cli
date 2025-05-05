package epub

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/bmaupin/go-epub"
	"github.com/lnreader/cli/internal/scraper"
)

const DefaultOutputDir = "epubs"

func GenerateEPUB(novel *scraper.Novel, outputPath string) error {

	e := epub.NewEpub(novel.Title)

	e.SetAuthor(novel.Author)
	e.SetDescription(novel.Description)

	if novel.CoverURL != "" {
		coverPath, err := downloadCover(novel.CoverURL)
		if err == nil {
			defer os.Remove(coverPath)
			coverImage, err := e.AddImage(coverPath, "cover.jpg")
			if err == nil {
				e.SetCover(coverImage, "")
			}
		}
	}

	cssContent := `
		body {
			font-family: serif;
			margin: 5%;
			text-align: justify;
		}
		h1, h2, h3, h4 {
			text-align: center;
			page-break-before: always;
		}
		.chapter {
			page-break-after: always;
		}
		p {
			text-indent: 1.25em;
			margin-top: 0;
			margin-bottom: 0.625em;
		}
	`

	tempCSSFile, err := os.CreateTemp("", "stylesheet-*.css")
	if err != nil {
		return fmt.Errorf("failed to create temporary CSS file: %w", err)
	}
	defer os.Remove(tempCSSFile.Name())

	if _, err := tempCSSFile.WriteString(cssContent); err != nil {
		return fmt.Errorf("failed to write CSS content: %w", err)
	}
	if err := tempCSSFile.Close(); err != nil {
		return fmt.Errorf("failed to close temporary CSS file: %w", err)
	}

	cssPath, err := e.AddCSS(tempCSSFile.Name(), "stylesheet.css")
	if err != nil {
		return fmt.Errorf("failed to add CSS: %w", err)
	}

	titlePage := fmt.Sprintf(`
		<html>
			<head>
				<title>%s</title>
				<link rel="stylesheet" href="%s" type="text/css" />
			</head>
			<body>
				<h1>%s</h1>
				<h3>Author: %s</h3>
				<div style="margin-top: 4em; text-align: center;">
					<p>%s</p>
				</div>
			</body>
		</html>
	`, novel.Title, cssPath, novel.Title, novel.Author, novel.Description)

	_, err = e.AddSection(titlePage, "Title Page", "", "")
	if err != nil {
		return fmt.Errorf("failed to add title page: %w", err)
	}

	tocHTML := `<html>
		<head>
			<title>Table of Contents</title>
			<link rel="stylesheet" href="` + cssPath + `" type="text/css" />
		</head>
		<body>
			<h1>Table of Contents</h1>
			<nav epub:type="toc">
				<ol>`

	for i, chapter := range novel.Chapters {
		tocHTML += fmt.Sprintf(`
			<li><a href="#chapter-%d">%s</a></li>`,
			i+1, chapter.Title)
	}

	tocHTML += `
				</ol>
			</nav>
		</body>
	</html>`

	_, err = e.AddSection(tocHTML, "Table of Contents", "", "")
	if err != nil {
		return fmt.Errorf("failed to add table of contents: %w", err)
	}

	for i, chapter := range novel.Chapters {

		chapterHTML := fmt.Sprintf(`
			<html>
				<head>
					<title>%s</title>
					<link rel="stylesheet" href="%s" type="text/css" />
				</head>
				<body>
					<div class="chapter" id="chapter-%d">
						<h2>%s</h2>
						%s
					</div>
				</body>
			</html>
		`, chapter.Title, cssPath, i+1, chapter.Title, chapter.Content)

		_, err = e.AddSection(chapterHTML, chapter.Title, fmt.Sprintf("chapter-%d.xhtml", i+1), "")
		if err != nil {
			return fmt.Errorf("failed to add chapter %s: %w", chapter.Title, err)
		}
	}

	var finalOutputPath string

	sanitizedTitle := sanitizeFilename(novel.Title)

	if outputPath == "" {

		outputDir := DefaultOutputDir
		finalOutputPath = filepath.Join(outputDir, sanitizedTitle+".epub")
	} else {

		fileInfo, err := os.Stat(outputPath)
		if err == nil && fileInfo.IsDir() {

			finalOutputPath = filepath.Join(outputPath, sanitizedTitle+".epub")
		} else if os.IsNotExist(err) && !strings.HasSuffix(outputPath, ".epub") {

			finalOutputPath = filepath.Join(outputPath, sanitizedTitle+".epub")
		} else {

			finalOutputPath = outputPath

			if !strings.HasSuffix(finalOutputPath, ".epub") {
				finalOutputPath += ".epub"
			}
		}
	}

	outputDir := filepath.Dir(finalOutputPath)
	if _, err := os.Stat(outputDir); os.IsNotExist(err) {
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	err = e.Write(finalOutputPath)
	if err != nil {
		return fmt.Errorf("failed to write EPUB file: %w", err)
	}

	fmt.Printf("EPUB file saved to: %s\n", finalOutputPath)

	return nil
}

func sanitizeFilename(filename string) string {

	invalidChars := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\t", "\n", "\r"}
	result := filename

	for _, char := range invalidChars {
		result = strings.ReplaceAll(result, char, "_")
	}

	result = strings.TrimSpace(result)

	if result == "" {
		result = "novel"
	}

	maxLength := 100
	if len(result) > maxLength {
		result = result[:maxLength]
	}

	return result
}

func downloadCover(url string) (string, error) {

	tempFile, err := os.CreateTemp("", "cover-*.jpg")
	if err != nil {
		return "", err
	}
	defer tempFile.Close()

	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("got status code %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		return "", fmt.Errorf("URL does not point to an image: %s", contentType)
	}

	_, err = io.Copy(tempFile, resp.Body)
	if err != nil {
		return "", err
	}

	return tempFile.Name(), nil
}
