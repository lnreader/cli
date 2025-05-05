package main

import (
	"fmt"
	"os"

	"github.com/lnreader/cli/internal/cli"
	_ "github.com/lnreader/cli/internal/scraper/sites"
)

func main() {
	if err := cli.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
