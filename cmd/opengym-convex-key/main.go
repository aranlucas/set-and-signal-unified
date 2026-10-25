// opengym-convex-key initializes the API signing key and prints its public JWKS data URI.
package main

import (
	"encoding/base64"
	"encoding/json/v2"
	"fmt"
	"github.com/aranlucas/set-and-signal-unified/internal/config"
	"github.com/aranlucas/set-and-signal-unified/internal/convex"
	"log"
	"os"
)

func main() {
	cfg := config.Load()
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		log.Fatal(err)
	}
	c, err := convex.New(cfg.ConvexURL, cfg.PublicURL, cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	raw, err := json.Marshal(c.JWKS())
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("data:text/plain;charset=utf-8;base64," + base64.StdEncoding.EncodeToString(raw))
}
