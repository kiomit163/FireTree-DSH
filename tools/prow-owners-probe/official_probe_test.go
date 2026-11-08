// FireTree differential probe. This file is copied into Prow's repoowners
// package by CI so it can call the unexported loader and the official resolver.
package repoowners

import (
	"encoding/json"
	"io"
	"os"
	"sort"
	"strings"
	"testing"

	"github.com/sirupsen/logrus"

	"sigs.k8s.io/prow/pkg/plugins/ownersconfig"
)

func TestFireTreeOwnersProbe(t *testing.T) {
	root := os.Getenv("FIRE_TREE_OWNERS_ROOT")
	output := os.Getenv("FIRE_TREE_OWNERS_OUTPUT")
	filesRaw := os.Getenv("FIRE_TREE_OWNERS_FILES")
	if root == "" || output == "" || filesRaw == "" {
		t.Skip("FIRE_TREE_OWNERS_ROOT, FIRE_TREE_OWNERS_OUTPUT, and FIRE_TREE_OWNERS_FILES are not set")
	}

	logrus.SetOutput(io.Discard)
	log := logrus.NewEntry(logrus.New())
	aliases := loadAliasesFrom(root, "OWNERS_ALIASES", log)
	owners, err := loadOwnersFrom(root, false, aliases, nil, ownersconfig.Filenames{
		Owners:        "OWNERS",
		OwnersAliases: "OWNERS_ALIASES",
	}, log)
	if err != nil {
		t.Fatalf("loadOwnersFrom: %v", err)
	}

	result := map[string][]string{}
	for _, file := range strings.Split(filesRaw, ",") {
		file = strings.TrimSpace(file)
		if file == "" {
			continue
		}
		found := owners.Approvers(file).Set().UnsortedList()
		sort.Strings(found)
		result[file] = found
	}

	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(output, append(data, '\n'), 0o644); err != nil {
		t.Fatalf("write %s: %v", output, err)
	}
}
