package scraper

import (
	"errors"
	"fmt"
)

type Novel struct {
	Title       string
	Author      string
	Description string
	CoverURL    string
	Chapters    []Chapter
}

type Chapter struct {
	Title   string
	Content string
	URL     string
}

type Scraper interface {
	ScrapeNovel(url string, verbose bool) (*Novel, error)
}

var ErrUnsupportedSite = errors.New("unsupported website")

func GetScraperForURL(url string) (Scraper, error) {

	for _, detector := range siteDetectors {
		if detector.CanHandle(url) {
			return detector.CreateScraper(), nil
		}
	}

	return nil, fmt.Errorf("no scraper available for %s: %w", url, ErrUnsupportedSite)
}
