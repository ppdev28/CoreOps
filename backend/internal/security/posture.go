package security

import (
	"context"
	"net/netip"
	"regexp"
	"strings"
)

type APTHealth struct {
	Installed      *bool    `json:"installed"`
	Origins        []string `json:"origins"`
	Exclusions     []string `json:"exclusions"`
	LastRun        string   `json:"lastRun"`
	LastResult     string   `json:"lastResult"`
	RebootRequired *bool    `json:"rebootRequired"`
}
type Jail struct {
	Name            string       `json:"name"`
	LogPaths        []string     `json:"logPaths"`
	JournalMatch    string       `json:"journalMatch"`
	Actions         string       `json:"actions"`
	FailRegexCount  int          `json:"failRegexCount"`
	MaxRetry        int          `json:"maxRetry"`
	FindTime        int          `json:"findTime"`
	BanTime         int          `json:"banTime"`
	CurrentlyBanned int          `json:"currentlyBanned"`
	TotalBanned     int          `json:"totalBanned"`
	Status          SourceStatus `json:"status"`
}
type FirewallChain struct {
	Family string `json:"family"`
	Table  string `json:"table"`
	Name   string `json:"name"`
	Hook   string `json:"hook"`
	Policy string `json:"policy"`
	Rules  int    `json:"rules"`
}
type Sensor struct {
	Scheduled          *bool  `json:"scheduled"`
	LastRun            string `json:"lastRun"`
	LastResult         string `json:"lastResult"`
	SignatureUpdatedAt string `json:"signatureUpdatedAt"`
	ID                 string `json:"id"`
	Label              string `json:"label"`
	Kind               string `json:"kind"`
	Installed          *bool  `json:"installed"`
	Active             *bool  `json:"active"`
	Detail             string `json:"detail"`
}
type Posture struct {
	APT            APTHealth               `json:"apt"`
	Jails          []Jail                  `json:"jails"`
	JailsTruncated bool                    `json:"jailsTruncated"`
	Chains         []FirewallChain         `json:"chains"`
	Sensors        []Sensor                `json:"sensors"`
	Sources        map[string]SourceStatus `json:"sources"`
}
type SSHContext struct {
	User    string `json:"user"`
	Address string `json:"address"`
	Host    string `json:"host"`
}
type SSHPolicy struct {
	Context               SSHContext   `json:"context"`
	Checks                []Check      `json:"checks"`
	AuthenticationMethods string       `json:"authenticationMethods"`
	AllowUsers            string       `json:"allowUsers"`
	DenyUsers             string       `json:"denyUsers"`
	Source                SourceStatus `json:"source"`
}
type PostureSource interface {
	Posture(context.Context) (Posture, error)
	SSHPolicy(context.Context, SSHContext) (SSHPolicy, error)
}

var sshUser = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_.-]{0,31}\$?$`)
var sshHost = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$`)

func ValidSSHContext(c SSHContext) bool {
	_, err := netip.ParseAddr(c.Address)
	return sshUser.MatchString(c.User) && err == nil && (c.Host == "" || sshHost.MatchString(c.Host))
}
func (s *Service) Posture(ctx context.Context) (Posture, error) {
	if p, ok := s.source.(PostureSource); ok {
		return p.Posture(ctx)
	}
	return Posture{}, ErrUnavailable
}
func (s *Service) SSHPolicy(ctx context.Context, c SSHContext) (SSHPolicy, error) {
	if !ValidSSHContext(c) {
		return SSHPolicy{}, ErrInvalid
	}
	if p, ok := s.source.(PostureSource); ok {
		return p.SSHPolicy(ctx, c)
	}
	return SSHPolicy{}, ErrUnavailable
}
func APTList(config, key string) []string {
	out := []string{}
	for _, line := range strings.Split(config, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, key+":: ") {
			continue
		}
		start := strings.IndexByte(line, '"')
		end := strings.LastIndexByte(line, '"')
		if start >= 0 && end > start {
			out = append(out, line[start+1:end])
		}
	}
	return out
}
func SecurityOrigins(config string) bool {
	id := strings.ToLower(Value(config, "CoreOps::OS::ID"))
	codename := strings.ToLower(Value(config, "CoreOps::OS::Codename"))
	if (id != "ubuntu" && id != "debian") || codename == "" {
		return false
	}
	for _, raw := range append(APTList(config, "Unattended-Upgrade::Allowed-Origins"), APTList(config, "Unattended-Upgrade::Origins-Pattern")...) {
		v := strings.ToLower(raw)
		v = strings.ReplaceAll(strings.ReplaceAll(v, "${distro_id}", id), "${distro_codename}", codename)
		if v == id+":"+codename+"-security" || (id == "ubuntu" && (v == "ubuntuesmapps:"+codename+"-apps-security" || v == "ubuntuesm:"+codename+"-infra-security")) {
			return true
		}
		fields := map[string]string{}
		for _, part := range strings.Split(v, ",") {
			k, value, ok := strings.Cut(strings.TrimSpace(part), "=")
			if ok {
				fields[k] = value
			}
		}
		origin := fields["origin"]
		if origin == "" {
			origin = fields["o"]
		}
		suite := fields["archive"]
		if suite == "" {
			suite = fields["a"]
		}
		code := fields["codename"]
		if code == "" {
			code = fields["n"]
		}
		label := fields["label"]
		if label == "" {
			label = fields["l"]
		}
		if origin == id && (suite == codename+"-security" || code == codename+"-security" || (id == "debian" && code == codename && label == "debian-security")) {
			return true
		}
	}
	return false
}
