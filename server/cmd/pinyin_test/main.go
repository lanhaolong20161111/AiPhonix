package main

import (
	"fmt"
	"ai-server/internal/service"
)

func main() {
	for _, t := range []string{"jiong3", "liu2", "ao4", "kuai4"} {
		pi, _ := service.ParsePinyin(t)
		m := pi.Medial; if m == "" { m = "-" }
		i := pi.Initial; if i == "" { i = "(零)" }
		fmt.Printf("%s → %s + %s + %s\n", t, i, m, pi.Final)
	}
}
