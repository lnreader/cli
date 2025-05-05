package sites

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/lnreader/cli/internal/scraper"
	"github.com/schollz/progressbar/v3"
)

type ScribbleHubScraper struct {
	baseURL string
}

func NewScribbleHubScraper() *ScribbleHubScraper {
	return &ScribbleHubScraper{
		baseURL: "https://www.scribblehub.com",
	}
}

func (s *ScribbleHubScraper) ScrapeNovel(novelURL string, verbose bool) (*scraper.Novel, error) {
	novel := &scraper.Novel{
		Chapters: []scraper.Chapter{},
	}

	_, err := url.Parse(novelURL)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	client := &http.Client{}
	req, err := http.NewRequest("GET", novelURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	req.Header.Set("Connection", "keep-alive")

	res, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch novel page: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("got status code %d", res.StatusCode)
	}

	doc, err := goquery.NewDocumentFromReader(res.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to parse page: %w", err)
	}

	// Extract novel information
	novel.Title = doc.Find(".fic_title").Text()
	if novel.Title == "" {
		novel.Title = "Untitled"
	}

	novel.CoverURL = doc.Find(".fic_image > img").AttrOr("src", "")

	novel.Description = strings.TrimSpace(doc.Find(".wi_fic_desc").Text())

	novel.Author = doc.Find(".auth_name_fic").Text()
	if novel.Author == "" {
		novel.Author = "Unknown Author"
	}

	// Extract novel ID from the URL
	novelIDRegex := regexp.MustCompile(`/read/(\d+)`)
	matches := novelIDRegex.FindStringSubmatch(novelURL)
	if len(matches) < 2 {
		return nil, fmt.Errorf("could not find novel ID in URL")
	}
	novelID := matches[1]

	if verbose {
		fmt.Println("Fetching chapter list...")
	}

	// Fetch chapters
	chapters, err := s.fetchChapters(novelID, client)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch chapters: %w", err)
	}

	if len(chapters) == 0 {
		return nil, fmt.Errorf("no chapters found")
	}

	if verbose {
		fmt.Printf("Found %d chapters\n", len(chapters))
	}

	bar := progressbar.Default(int64(len(chapters)), "Fetching Chapters")

	for i, chapterInfo := range chapters {
		if i > 0 {
			time.Sleep(500 * time.Millisecond) // Be kind to the server
		}

		content, err := s.fetchChapterContent(chapterInfo.Path, client)
		if err != nil {
			if verbose {
				fmt.Printf("Error fetching chapter %s: %v\n", chapterInfo.Name, err)
			}
			continue
		}

		chapter := scraper.Chapter{
			Title:   chapterInfo.Name,
			Content: content,
			URL:     chapterInfo.Path,
		}

		novel.Chapters = append(novel.Chapters, chapter)
		_ = bar.Add(1)
	}

	if len(novel.Chapters) == 0 {
		return nil, fmt.Errorf("failed to scrape any chapters")
	}

	return novel, nil
}

type scribbleHubChapterData struct {
	Name string
	Path string
}

func (s *ScribbleHubScraper) fetchChapters(novelID string, client *http.Client) ([]scribbleHubChapterData, error) {
	var chapters []scribbleHubChapterData

	// Create the form data for the AJAX request
	formData := fmt.Sprintf("action=wi_getreleases_pagination&pagenum=-1&mypostid=%s", novelID)

	req, err := http.NewRequest("POST", s.baseURL+"/wp-admin/admin-ajax.php", strings.NewReader(formData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Referer", s.baseURL)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("got status code %d for chapters", resp.StatusCode)
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, err
	}

	// Find all chapter elements and extract their details
	doc.Find(".toc_w").Each(func(i int, el *goquery.Selection) {
		chapterName := el.Find(".toc_a").Text()
		chapterURL, exists := el.Find("a").Attr("href")

		if exists && chapterURL != "" {
			chapters = append(chapters, scribbleHubChapterData{
				Name: chapterName,
				Path: chapterURL,
			})
		}
	})

	// Reverse the chapters to have the oldest first
	for i, j := 0, len(chapters)-1; i < j; i, j = i+1, j-1 {
		chapters[i], chapters[j] = chapters[j], chapters[i]
	}

	return chapters, nil
}

func (s *ScribbleHubScraper) fetchChapterContent(chapterURL string, client *http.Client) (string, error) {
	req, err := http.NewRequest("GET", chapterURL, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("got status code %d for chapter", resp.StatusCode)
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return "", err
	}

	contentSelection := doc.Find("div.chp_raw")

	// Remove unnecessary elements
	contentSelection.Find("script, .ads").Remove()

	content, err := contentSelection.Html()
	if err != nil {
		return "", err
	}

	return content, nil
}
