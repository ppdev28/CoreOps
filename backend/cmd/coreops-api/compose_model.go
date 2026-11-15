package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"regexp"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

const maxComposeBytes = 128 * 1024

var composeProjectPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)
var composeResourcePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$`)

const composeOwnerLabel = "io.coreops.compose.deployment"

type ComposeRequest struct {
	Project        string `json:"project"`
	Compose        string `json:"compose"`
	Start          bool   `json:"start"`
	ValidationHash string `json:"validationHash,omitempty"`
}
type ComposeService struct {
	Name  string   `json:"name"`
	Image string   `json:"image"`
	Ports []string `json:"ports"`
}
type ComposePreview struct {
	Project  string           `json:"project"`
	Services []ComposeService `json:"services"`
	Volumes  []string         `json:"volumes"`
	Warnings []string         `json:"warnings"`
	Hash     string           `json:"hash"`
}

func parseComposeDocument(req ComposeRequest) (map[string]any, error) {
	if !composeProjectPattern.MatchString(req.Project) {
		return nil, errors.New("project must use 1–63 lowercase letters, digits, hyphens or underscores, starting with a letter or digit")
	}
	if len(req.Compose) == 0 || len(req.Compose) > maxComposeBytes {
		return nil, errors.New("provide a Compose document of at most 128 KiB")
	}
	decoder := yaml.NewDecoder(strings.NewReader(req.Compose))
	var model map[string]any
	if err := decoder.Decode(&model); err != nil {
		return nil, errors.New("invalid Compose YAML; check indentation, duplicate keys and field types")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("use one Compose YAML document")
	}
	nodes := 0
	var check func(any, int) error
	check = func(value any, depth int) error {
		nodes++
		if depth > 24 || nodes > 10000 {
			return errors.New("Compose document is too complex")
		}
		switch value := value.(type) {
		case string:
			if len(value) > 16384 || strings.ContainsRune(value, 0) {
				return errors.New("Compose values must be at most 16 KiB without null bytes")
			}
			for index := 0; index < len(value); index++ {
				if value[index] != '$' {
					continue
				}
				if index+1 < len(value) && value[index+1] == '$' {
					index++
					continue
				}
				if index+1 < len(value) && (value[index+1] == '{' || value[index+1] == '_' || value[index+1] >= 'a' && value[index+1] <= 'z' || value[index+1] >= 'A' && value[index+1] <= 'Z') {
					return errors.New("host environment interpolation is disabled; use explicit values and $$ for container-side variables")
				}
			}
		case map[string]any:
			for key, item := range value {
				if err := check(key, depth+1); err != nil {
					return err
				}
				if err := check(item, depth+1); err != nil {
					return err
				}
			}
		case []any:
			for _, item := range value {
				if err := check(item, depth+1); err != nil {
					return err
				}
			}
		case nil, bool, int, uint64, int64, float64:
		default:
			return errors.New("Compose mappings require string keys and standard YAML values")
		}
		return nil
	}
	if err := check(model, 0); err != nil {
		return nil, err
	}
	if err := validateComposeModel(model, req.Project, false); err != nil {
		return nil, err
	}
	delete(model, "version")
	delete(model, "name")
	return model, nil
}
func composeFields(value map[string]any, allowed, location string) error {
	for key := range value {
		if strings.HasPrefix(key, "x-") {
			delete(value, key)
			continue
		}
		if !slices.Contains(strings.Fields(allowed), key) {
			return fmt.Errorf("%s: unsupported field %q", location, key)
		}
	}
	return nil
}
func composeMap(value any) (map[string]any, bool) {
	result, ok := value.(map[string]any)
	return result, ok
}
func composeLabels(value any) error {
	switch labels := value.(type) {
	case nil:
		return nil
	case map[string]any:
		for key, item := range labels {
			if strings.HasPrefix(key, "com.docker.compose.") || strings.HasPrefix(key, "io.coreops.") {
				return errors.New("Compose/CoreOps labels are reserved")
			}
			if _, ok := item.(string); !ok {
				return errors.New("label values must be strings")
			}
		}
	case []any:
		for _, label := range labels {
			text, ok := label.(string)
			if !ok {
				return errors.New("labels must be strings")
			}
			key, _, _ := strings.Cut(text, "=")
			if strings.HasPrefix(key, "com.docker.compose.") || strings.HasPrefix(key, "io.coreops.") {
				return errors.New("Compose/CoreOps labels are reserved")
			}
		}
	default:
		return errors.New("invalid labels")
	}
	return nil
}
func validateComposeModel(model map[string]any, project string, normalized bool) error {
	if err := composeFields(model, "services networks volumes name version", "Compose"); err != nil {
		return err
	}
	services, ok := composeMap(model["services"])
	if !ok || len(services) < 1 || len(services) > 16 {
		return errors.New("define between 1 and 16 services")
	}
	for _, kind := range []string{"volumes", "networks"} {
		if model[kind] == nil {
			continue
		}
		resources, ok := composeMap(model[kind])
		if !ok || len(resources) > 32 {
			return fmt.Errorf("%s must be a mapping of at most 32 resources", kind)
		}
		for name, resource := range resources {
			if !composeResourcePattern.MatchString(name) {
				return fmt.Errorf("invalid %s name", kind)
			}
			if resource == nil {
				resources[name] = map[string]any{}
				continue
			}
			options, ok := composeMap(resource)
			if !ok {
				return fmt.Errorf("invalid %s configuration", kind)
			}
			fields := "labels"
			if kind == "networks" {
				fields += " driver internal attachable"
			}
			if normalized {
				fields += " name external"
			}
			if err := composeFields(options, fields, kind+" "+name); err != nil {
				return err
			}
			if options["external"] != nil && options["external"] != false {
				return errors.New("external resources are not supported")
			}
			if options["name"] != nil && options["name"] != project+"_"+name {
				return errors.New("resources must belong to the new project")
			}
			if options["driver"] != nil && options["driver"] != "bridge" {
				return errors.New("only project-scoped bridge networks are supported")
			}
			if err := composeLabels(options["labels"]); err != nil {
				return err
			}
		}
	}
	volumes, _ := composeMap(model["volumes"])
	for name, item := range services {
		if !composeResourcePattern.MatchString(name) {
			return errors.New("invalid service name")
		}
		service, ok := composeMap(item)
		if !ok {
			return errors.New("each service must be a mapping")
		}
		if err := composeFields(service, "image command entrypoint environment ports expose volumes networks depends_on restart healthcheck user working_dir hostname domainname init tty stdin_open read_only tmpfs stop_grace_period cpus mem_limit pids_limit labels cap_drop", "service "+name); err != nil {
			return err
		}
		image, ok := service["image"].(string)
		if !ok || image == "" || len(image) > 512 || strings.ContainsAny(image, " \t\r\n\x00") {
			return fmt.Errorf("service %s requires an explicit local image", name)
		}
		if err := composeLabels(service["labels"]); err != nil {
			return err
		}
		if env := service["environment"]; env != nil {
			switch env := env.(type) {
			case map[string]any:
				if len(env) > 100 {
					return errors.New("maximum 100 environment variables per service")
				}
				for key, value := range env {
					if !environmentNamePattern.MatchString(key) || value == nil {
						return errors.New("environment values must be explicit; inheriting host variables is disabled")
					}
					text, ok := value.(string)
					if !ok || len(text) > 4096 {
						return errors.New("environment values must be strings of at most 4096 bytes")
					}
				}
			case []any:
				if len(env) > 100 {
					return errors.New("maximum 100 environment variables per service")
				}
				keys := map[string]bool{}
				for _, item := range env {
					text, ok := item.(string)
					key, _, found := strings.Cut(text, "=")
					if !ok || !found || !environmentNamePattern.MatchString(key) || keys[key] || len(text) > 4096 {
						return errors.New("use unique NAME=value environment entries; host inheritance is disabled")
					}
					keys[key] = true
				}
			default:
				return errors.New("invalid environment mapping")
			}
		}
		for _, field := range []string{"command", "entrypoint", "cap_drop", "tmpfs", "expose"} {
			if values, ok := service[field].([]any); ok && len(values) > 64 {
				return fmt.Errorf("service %s: too many %s entries", name, field)
			}
		}
		if health, ok := composeMap(service["healthcheck"]); ok {
			if err := composeFields(health, "test interval timeout start_period start_interval retries disable", "healthcheck"); err != nil {
				return err
			}
		}
		if deps, ok := composeMap(service["depends_on"]); ok {
			for _, dep := range deps {
				if config, ok := composeMap(dep); ok {
					if err := composeFields(config, "condition restart required", "depends_on"); err != nil {
						return err
					}
				}
			}
		}
		if networks, ok := composeMap(service["networks"]); ok {
			for _, network := range networks {
				if config, ok := composeMap(network); ok {
					if err := composeFields(config, "aliases", "service network"); err != nil {
						return err
					}
				}
			}
		}
		if mounts := service["volumes"]; mounts != nil {
			items, ok := mounts.([]any)
			if !ok || len(items) > 32 {
				return errors.New("use at most 32 volume mounts per service")
			}
			for _, item := range items {
				var source, target string
				switch mount := item.(type) {
				case string:
					parts := strings.Split(mount, ":")
					if len(parts) > 3 {
						return errors.New("invalid volume mount")
					}
					if len(parts) == 1 {
						target = parts[0]
					} else {
						source, target = parts[0], parts[1]
					}
				case map[string]any:
					if err := composeFields(mount, "type source target read_only volume consistency", "volume mount"); err != nil {
						return err
					}
					if mount["type"] != nil && mount["type"] != "volume" {
						return errors.New("only named or anonymous Docker volumes are supported; host bind mounts are disabled")
					}
					source, _ = mount["source"].(string)
					target, _ = mount["target"].(string)
					if options, ok := composeMap(mount["volume"]); ok {
						if err := composeFields(options, "nocopy", "volume options"); err != nil {
							return err
						}
					}
				default:
					return errors.New("invalid volume mount")
				}
				if source != "" {
					if !composeResourcePattern.MatchString(source) {
						return errors.New("host bind mounts are disabled; declare a named volume")
					}
					if _, found := volumes[source]; !found {
						return fmt.Errorf("declare named volume %s in the volumes section", source)
					}
				}
				if !strings.HasPrefix(target, "/") || strings.ContainsRune(target, 0) {
					return errors.New("volume target must be an absolute container path")
				}
			}
		}
		if normalized && service["ports"] != nil {
			ports, ok := service["ports"].([]any)
			if !ok || len(ports) > 32 {
				return errors.New("maximum 32 published ports per service")
			}
			for _, item := range ports {
				port, ok := composeMap(item)
				if !ok {
					return errors.New("invalid normalized port")
				}
				if err := composeFields(port, "name target published host_ip protocol app_protocol mode", "port"); err != nil {
					return err
				}
				if port["host_ip"] == nil || port["host_ip"] == "" {
					port["host_ip"] = "127.0.0.1"
				}
				ip, err := netip.ParseAddr(fmt.Sprint(port["host_ip"]))
				if err != nil || ip.Zone() != "" {
					return errors.New("invalid published port IP")
				}
				if protocol := port["protocol"]; protocol != nil && protocol != "tcp" && protocol != "udp" {
					return errors.New("only TCP and UDP ports are supported")
				}
			}
		}
	}
	return nil
}
func composePreview(model map[string]any, project string) (ComposePreview, []byte, error) {
	encoded, err := json.Marshal(model)
	if err != nil {
		return ComposePreview{}, nil, err
	}
	digest := sha256.Sum256(encoded)
	preview := ComposePreview{Project: project, Services: []ComposeService{}, Volumes: []string{}, Warnings: []string{"Images must exist locally. No image pulls or builds are performed.", "Ports without an explicit host IP bind to 127.0.0.1."}, Hash: hex.EncodeToString(digest[:])}
	services, _ := composeMap(model["services"])
	for name, item := range services {
		service, _ := composeMap(item)
		entry := ComposeService{Name: name, Image: service["image"].(string), Ports: []string{}}
		if ports, ok := service["ports"].([]any); ok {
			for _, item := range ports {
				port, _ := composeMap(item)
				published := "auto"
				if port["published"] != nil {
					published = fmt.Sprint(port["published"])
				}
				protocol := "tcp"
				if port["protocol"] != nil {
					protocol = fmt.Sprint(port["protocol"])
				}
				entry.Ports = append(entry.Ports, fmt.Sprintf("%v:%s → %v/%s", port["host_ip"], published, port["target"], protocol))
			}
		}
		preview.Services = append(preview.Services, entry)
	}
	slices.SortFunc(preview.Services, func(a, b ComposeService) int { return strings.Compare(a.Name, b.Name) })
	if volumes, ok := composeMap(model["volumes"]); ok {
		for name := range volumes {
			preview.Volumes = append(preview.Volumes, name)
		}
	}
	slices.Sort(preview.Volumes)
	return preview, encoded, nil
}
func decodeComposeJSON(data []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var model map[string]any
	if err := decoder.Decode(&model); err != nil {
		return nil, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid Compose model")
	}
	return model, nil
}
