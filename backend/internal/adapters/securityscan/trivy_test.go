package securityscan

import (
	"strings"
	"testing"
)

func TestTrivyReportIsWhitelistedAndNeverTreatsMissingInventoryAsClean(t *testing.T) {
	data := `{"SchemaVersion":2,"Metadata":{"ImageConfig":{"Env":["TOKEN=private-test-secret"]},"OS":{"Family":"ubuntu","Name":"26.04","EOSL":false}},"Results":[{"Target":"ubuntu","Packages":[{}],"Vulnerabilities":[{"VulnerabilityID":"CVE-test","PkgName":"test","InstalledVersion":"1","Severity":"HIGH","PrimaryURL":"javascript:bad()"},{"VulnerabilityID":"CVE-test","PkgName":"test","InstalledVersion":"1","Severity":"HIGH"}]}]}`
	p, e := decodeReport([]byte(data))
	if e != nil || p.Packages != 1 || p.Counts["HIGH"] != 1 || len(p.Vulnerabilities) != 1 || p.Vulnerabilities[0].URL != "" {
		t.Fatal(p, e)
	}
	if strings.Contains(p.OS, "secret") {
		t.Fatal("raw metadata exposed")
	}
	if _, e = decodeReport([]byte(`{"SchemaVersion":2,"Results":[]}`)); e == nil {
		t.Fatal("missing inventory is not clean")
	}
}
