package scraper

// SiteDetector determines if a scraper can handle a given URL and creates the appropriate scraper instance
type SiteDetector interface {
	CanHandle(url string) bool
	CreateScraper() Scraper
}

// Map of site detectors registered by their packages
var siteDetectors []SiteDetector

func RegisterSiteDetector(detector SiteDetector) {
	siteDetectors = append(siteDetectors, detector)
}
