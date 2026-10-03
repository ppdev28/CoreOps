package main

import (
    "context"
    "fmt"
    "sort"
    "strings"

    "github.com/moby/moby/api/types/container"
    "github.com/moby/moby/client"
)

type ApplicationSummary struct {
    ID           string   `json:"id"`
    Name         string   `json:"name"`
    Description  string   `json:"description"`
    Status       string   `json:"status"`
    Containers   int      `json:"containers"`
    Version      string   `json:"version"`
    Category     string   `json:"category"`
    Icon         string   `json:"icon"`
    ContainerIDs []string `json:"containerIds"`
}

func collectApplications(ctx context.Context, docker *client.Client) ([]ApplicationSummary, error) {
    result, err := docker.ContainerList(ctx, client.ContainerListOptions{All: true})
    if err != nil { return nil, err }
    type group struct { key string; items []container.Summary }
    groups := map[string]*group{}
    for _, c := range result.Items {
        key := strings.TrimSpace(c.Labels["com.docker.compose.project"])
        if key == "" { key = strings.TrimPrefix(firstContainerName(c), "/") }
        if key == "" { key = c.ID[:12] }
        if groups[key] == nil { groups[key] = &group{key:key} }
        groups[key].items = append(groups[key].items, c)
    }
    apps := make([]ApplicationSummary, 0, len(groups))
    for _, g := range groups {
        first := g.items[0]
        labels := first.Labels
        name := labels["com.docker.compose.project"]
        if name == "" { name = firstContainerName(first) }
        name = prettyApplicationName(name)
        if custom := strings.TrimSpace(labels["coreops.application.name"]); custom != "" { name = custom }
        category := applicationCategory(name, first.Image)
        if custom := strings.TrimSpace(labels["coreops.application.category"]); custom != "" { category = custom }
        description := strings.TrimSpace(labels["coreops.application.description"])
        if description == "" { description = "Docker application composed of one or more containers." }
        icon := applicationIcon(name, first.Image, category)
        if custom := strings.TrimSpace(labels["coreops.application.icon"]); custom != "" { icon = custom }
        running := 0
        versions := make([]string, 0, len(g.items))
        ids := make([]string, 0, len(g.items))
        for _, c := range g.items {
            if strings.EqualFold(string(c.State), "running") { running++ }
            if tag := imageTag(c.Image); tag != "" { versions = append(versions, tag) }
            ids = append(ids, c.ID)
        }
        sort.Strings(ids)
        status := "stopped"
        if running == len(g.items) { status = "running" } else if running > 0 { status = "restarting" }
        apps = append(apps, ApplicationSummary{ID: nameToID(g.key), Name: name, Description: description, Status: status, Containers: len(g.items), Version: commonVersion(versions), Category: category, Icon: icon, ContainerIDs: ids})
    }
    sort.Slice(apps, func(i, j int) bool { return strings.ToLower(apps[i].Name) < strings.ToLower(apps[j].Name) })
    return apps, nil
}

func firstContainerName(c container.Summary) string { if len(c.Names) == 0 { return "application" }; return strings.TrimPrefix(c.Names[0], "/") }
func prettyApplicationName(name string) string { name = strings.ReplaceAll(name, "_", " "); name = strings.ReplaceAll(name, "-", " "); words := strings.Fields(name); for i, word := range words { if word != "" { words[i] = strings.ToUpper(word[:1]) + word[1:] } }; return strings.Join(words, " ") }
func nameToID(name string) string { name = strings.ToLower(strings.TrimSpace(name)); return strings.ReplaceAll(name, " ", "-") }
func imageTag(image string) string { image = strings.TrimSpace(image); if at := strings.LastIndex(image, "@"); at >= 0 && at < len(image)-1 { return image[at+1:] }; slash := strings.LastIndex(image, "/"); colon := strings.LastIndex(image, ":"); if colon > slash && colon < len(image)-1 { return image[colon+1:] }; return "latest" }
func commonVersion(versions []string) string { if len(versions) == 0 { return "latest" }; first := versions[0]; for _, version := range versions[1:] { if version != first { return first } }; return first }
func applicationCategory(name, image string) string { value := strings.ToLower(name + " " + image); switch { case strings.Contains(value, "postgres"), strings.Contains(value, "mysql"), strings.Contains(value, "mariadb"), strings.Contains(value, "redis"): return "Database"; case strings.Contains(value, "grafana"), strings.Contains(value, "prometheus"), strings.Contains(value, "loki"), strings.Contains(value, "uptime"): return "Monitoring"; case strings.Contains(value, "vault"), strings.Contains(value, "auth"), strings.Contains(value, "keycloak"): return "Security"; case strings.Contains(value, "jellyfin"), strings.Contains(value, "immich"), strings.Contains(value, "plex"): return "Media"; case strings.Contains(value, "gitea"), strings.Contains(value, "gitlab"), strings.Contains(value, "code"): return "Development"; case strings.Contains(value, "nextcloud"), strings.Contains(value, "minio"), strings.Contains(value, "storage"): return "Storage"; case strings.Contains(value, "home-assistant"), strings.Contains(value, "n8n"), strings.Contains(value, "automation"): return "Automation"; default: return "Web" } }

func applicationIcon(name, image, category string) string {
    value := strings.ToLower(name + " " + image)
    icons := []struct{ match, slug string }{
        {"vaultwarden", "vaultwarden"}, {"immich", "immich"}, {"jellyfin", "jellyfin"}, {"home-assistant", "homeassistant"}, {"gitea", "gitea"}, {"gitlab", "gitlab"}, {"portainer", "portainer"}, {"uptime kuma", "uptimekuma"}, {"uptime-kuma", "uptimekuma"}, {"n8n", "n8n"},
        {"grafana", "grafana"}, {"prometheus", "prometheus"}, {"loki", "grafana"}, {"postgres", "postgresql"}, {"mysql", "mysql"}, {"mariadb", "mariadb"}, {"redis", "redis"}, {"nextcloud", "nextcloud"}, {"minio", "minio"}, {"plex", "plex"}, {"keycloak", "keycloak"}, {"docker", "docker"},
    }
    for _, icon := range icons { if strings.Contains(value, icon.match) { return "https://cdn.simpleicons.org/" + icon.slug } }
    _ = category
    return ""
}

func applicationAction(ctx context.Context, docker *client.Client, ids []string, action string) error {
    for _, id := range ids {
        inspected, err := docker.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
        if err != nil { return fmt.Errorf("inspect %s: %w", shortID(id), err) }
        running := inspected.Container.State != nil && inspected.Container.State.Running
        switch action {
        case "start": if running { continue }; if _, err := docker.ContainerStart(ctx, id, client.ContainerStartOptions{}); err != nil { return fmt.Errorf("start %s: %w", shortID(id), err) }
        case "stop": if !running { continue }; if _, err := docker.ContainerStop(ctx, id, client.ContainerStopOptions{}); err != nil { return fmt.Errorf("stop %s: %w", shortID(id), err) }
        case "restart": if !running { continue }; if _, err := docker.ContainerRestart(ctx, id, client.ContainerRestartOptions{}); err != nil { return fmt.Errorf("restart %s: %w", shortID(id), err) }
        }
    }
    return nil
}
func shortID(id string) string { if len(id) > 12 { return id[:12] }; return id }
