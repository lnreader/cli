package cli

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"github.com/lnreader/cli/internal/epub"
	"github.com/lnreader/cli/internal/scraper"
	"github.com/spf13/cobra"
)

var (
	outputPath string
	verbose    bool
	outputDir  string
)

var rootCmd = &cobra.Command{
	Use:   "cli [url]",
	Short: "Convert web novels to EPUB format",
	Long:  `A CLI tool to convert web/light novels from various websites into EPUB format for offline reading.`,
	Args: func(cmd *cobra.Command, args []string) error {
		if len(args) < 1 {
			return errors.New("requires a URL argument")
		}
		_, err := url.ParseRequestURI(args[0])
		if err != nil {
			return fmt.Errorf("invalid URL format: %v", err)
		}
		return nil
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		novelURL := args[0]

		if outputDir != "" {
			if _, err := os.Stat(outputDir); os.IsNotExist(err) {
				if err := os.MkdirAll(outputDir, 0755); err != nil {
					return fmt.Errorf("failed to create output directory: %v", err)
				}
			}
			outputPath = outputDir
		}

		var absPath string
		var err error
		if outputPath != "" {
			absPath, err = filepath.Abs(outputPath)
			if err != nil {
				return fmt.Errorf("failed to get absolute file path: %v", err)
			}
		}

		if absPath != "" {
			fmt.Printf("Converting novel from %s to EPUB at %s\n", novelURL, absPath)
		} else {
			fmt.Printf("Converting novel from %s to EPUB in the default directory\n", novelURL)
		}

		s, err := scraper.GetScraperForURL(novelURL)
		if err != nil {
			return fmt.Errorf("unsupported website: %v", err)
		}

		fmt.Println("Fetching novel information...")
		novel, err := s.ScrapeNovel(novelURL, verbose)
		if err != nil {
			return fmt.Errorf("failed to scrape novel: %v", err)
		}

		fmt.Println("Generating EPUB file...")
		if err := epub.GenerateEPUB(novel, absPath); err != nil {
			return fmt.Errorf("failed to generate EPUB: %v", err)
		}

		fmt.Printf("Successfully created EPUB at %s\n", absPath)
		return nil
	},
}

func init() {
	rootCmd.Flags().StringVarP(&outputPath, "output", "o", "", "Output path for the EPUB file")
	rootCmd.Flags().StringVarP(&outputDir, "dir", "d", "", "Output directory for the EPUB file (novel title will be used as filename)")
	rootCmd.Flags().BoolVarP(&verbose, "verbose", "v", false, "Enable verbose logging")
}

func Execute() error {
	return rootCmd.Execute()
}
