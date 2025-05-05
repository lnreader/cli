package sites

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/lnreader/cli/internal/scraper"
	"github.com/schollz/progressbar/v3"
)
type AllNovelFullScraper struct {
	baseURL string
}


func NewAllNovelFullScraper() *AllNovelFullScraper {
	return &AllNovelFullScraper{
		baseURL: "https://allnovelfull.net",
	}
}


func (s *AllNovelFullScraper) ScrapeNovel(novelURL string, verbose bool) (*scraper.Novel, error) {
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
	req.Header.Set("Upgrade-Insecure-Requests", "1")


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


	novel.Title = doc.Find(".book > img").AttrOr("alt", "Untitled")


	coverImg := doc.Find(".book > img").AttrOr("src", "")
	if coverImg != "" && !strings.HasPrefix(coverImg, "http") {
		novel.CoverURL = s.baseURL + coverImg
	} else {
		novel.CoverURL = coverImg
	}


	novel.Description = strings.TrimSpace(doc.Find(".desc-text").Text())


	doc.Find(".info > div").Each(func(i int, el *goquery.Selection) {
		detailName := el.Find("h3").Text()
		detail := []string{}

		el.Find("a").Each(func(j int, link *goquery.Selection) {
			detail = append(detail, link.Text())
		})

		detailText := strings.Join(detail, ", ")

		switch detailName {
		case "Author:":
			novel.Author = detailText
		}
	})


	if novel.Author == "" {
		novel.Author = "Unknown Author"
	}


	novelID := doc.Find("#rating").AttrOr("data-novel-id", "")
	if novelID == "" {
		return nil, fmt.Errorf("could not find novel ID")
	}


	if verbose {
		fmt.Println("Fetching chapter list...")
	}

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
			time.Sleep(500 * time.Millisecond)
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
			URL:     s.baseURL + chapterInfo.Path,
		}

		novel.Chapters = append(novel.Chapters, chapter)
		_ = bar.Add(1)
	}

	if len(novel.Chapters) == 0 {
		return nil, fmt.Errorf("failed to scrape any chapters")
	}

	return novel, nil
}


type chapterData struct {
	Name string
	Path string
}


func (s *AllNovelFullScraper) fetchChapters(novelID string, client *http.Client) ([]chapterData, error) {
	chaptersURL := fmt.Sprintf("%s/ajax/chapter-option?novelId=%s", s.baseURL, novelID)

	req, err := http.NewRequest("GET", chaptersURL, nil)
	if err != nil {
		return nil, err
	}


	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
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

	var chapters []chapterData


	doc.Find("select > option").Each(func(i int, el *goquery.Selection) {
		chapterName := el.Text()
		chapterPath, exists := el.Attr("value")

		if exists && chapterPath != "" {
			chapters = append(chapters, chapterData{
				Name: chapterName,
				Path: chapterPath,
			})
		}
	})

	return chapters, nil
}


func (s *AllNovelFullScraper) fetchChapterContent(chapterPath string, client *http.Client) (string, error) {
	chapterURL := s.baseURL + chapterPath

	req, err := http.NewRequest("GET", chapterURL, nil)
	if err != nil {
		return "", err
	}

	// Set headers
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


	contentSelection := doc.Find("#chapter-content")


	contentSelection.Find("script, .ads, .chapter-nav").Remove()


	content, err := contentSelection.Html()
	if err != nil {
		return "", err
	}

	return content, nil
}
