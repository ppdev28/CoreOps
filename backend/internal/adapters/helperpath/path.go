// Package helperpath selects fixed helper locations at build time. Package builds
// use /usr/libexec/coreops; existing source installations keep /usr/local/libexec.
package helperpath

import "path/filepath"

// Directory may only be replaced by release ldflags, never by a request or env.
var Directory = "/usr/local/libexec"

func Path(name string) string { return filepath.Join(Directory, name) }
