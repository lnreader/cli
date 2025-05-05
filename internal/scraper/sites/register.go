package sites

import (
	"strings"

	"github.com/lnreader/cli/internal/scraper"
)

type AllNovelFullDetector struct{}

func (d *AllNovelFullDetector) CanHandle(url string) bool {
	return strings.Contains(url, "allnovelfull.net") || strings.Contains(url, "novgo.net")
}

func (d *AllNovelFullDetector) CreateScraper() scraper.Scraper {
	return NewAllNovelFullScraper()
}

type ScribbleHubDetector struct{}

func (d *ScribbleHubDetector) CanHandle(url string) bool {
	return strings.Contains(url, "scribblehub.com")
}

func (d *ScribbleHubDetector) CreateScraper() scraper.Scraper {
	return NewScribbleHubScraper()
}

func init() {
	scraper.RegisterSiteDetector(&AllNovelFullDetector{})
	scraper.RegisterSiteDetector(&ScribbleHubDetector{})
}
