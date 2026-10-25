// Package exercises shares the generated exercise catalogue across deployables.
package exercises

import _ "embed"

// Catalog is generated from web/catalog/exercises.ts. Treat its bytes as read-only.
//go:embed catalog.json
var Catalog []byte
