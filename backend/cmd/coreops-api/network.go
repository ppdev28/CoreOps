package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/moby/moby/client"
)

type NetworkInterface struct {
	Name    string `json:"name"`
	IP      string `json:"ip"`
	MAC     string `json:"mac"`
	State   string `json:"state"`
	Speed   string `json:"speed"`
	RXBytes uint64 `json:"rxBytes"`
	TXBytes uint64 `json:"txBytes"`
}
type OpenPort struct {
	Port      uint16 `json:"port"`
	Proto     string `json:"proto"`
	Process   string `json:"process"`
	Container string `json:"container"`
	Address   string `json:"address"`
	State     string `json:"state"`
}
type NetworkContainer struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}
type NetworkTopology struct {
	Gateway      string             `json:"gateway"`
	Host         string             `json:"host"`
	DockerBridge string             `json:"dockerBridge"`
	Containers   []NetworkContainer `json:"containers"`
}
type NetworkOverview struct {
	Interfaces []NetworkInterface `json:"interfaces"`
	Ports      []OpenPort         `json:"ports"`
	Topology   NetworkTopology    `json:"topology"`
}
type ipAddressJSON struct {
	Ifname    string `json:"ifname"`
	Operstate string `json:"operstate"`
	Address   string `json:"address"`
	LinkType  string `json:"link_type"`
	AddrInfo  []struct {
		Family string `json:"family"`
		Local  string `json:"local"`
		Scope  string `json:"scope"`
	} `json:"addr_info"`
}

func collectNetwork(ctx context.Context, docker *client.Client) (NetworkOverview, error) {
	interfaces, err := collectNetworkInterfaces(ctx)
	if err != nil {
		return NetworkOverview{}, err
	}
	ports, err := collectOpenPorts(ctx, docker)
	if err != nil {
		return NetworkOverview{}, err
	}
	return NetworkOverview{Interfaces: interfaces, Ports: ports, Topology: collectNetworkTopology(ctx, interfaces, docker)}, nil
}
func collectNetworkInterfaces(ctx context.Context) ([]NetworkInterface, error) {
	out, err := commandOutput(ctx, "ip", "-j", "address", "show")
	if err != nil {
		return nil, fmt.Errorf("list network interfaces: %w", err)
	}
	var raw []ipAddressJSON
	if err := json.Unmarshal([]byte(out), &raw); err != nil {
		return nil, fmt.Errorf("parse network interfaces: %w", err)
	}
	counters := readNetworkCounters()
	result := make([]NetworkInterface, 0, len(raw))
	for _, item := range raw {
		ip := "—"
		for _, addr := range item.AddrInfo {
			if addr.Family == "inet" && addr.Scope == "global" {
				ip = addr.Local
				break
			}
		}
		if ip == "—" {
			for _, addr := range item.AddrInfo {
				if addr.Family == "inet" {
					ip = addr.Local
					break
				}
			}
		}
		speed := "N/A"
		if b, err := os.ReadFile(filepath.Join("/sys/class/net", item.Ifname, "speed")); err == nil {
			if n, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && n > 0 {
				speed = fmt.Sprintf("%d Mbps", n)
				if n >= 1000 {
					speed = fmt.Sprintf("%.0f Gbps", float64(n)/1000)
				}
			}
		}
		c := counters[item.Ifname]
		result = append(result, NetworkInterface{Name: item.Ifname, IP: ip, MAC: item.Address, State: strings.ToUpper(item.Operstate), Speed: speed, RXBytes: c.rx, TXBytes: c.tx})
	}
	return result, nil
}

type netCounter struct{ rx, tx uint64 }

func readNetworkCounters() map[string]netCounter {
	result := map[string]netCounter{}
	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return result
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		result[strings.TrimSpace(parts[0])] = netCounter{rx: rx, tx: tx}
	}
	return result
}
func collectOpenPorts(ctx context.Context, docker *client.Client) ([]OpenPort, error) {
	out, err := commandOutput(ctx, "ss", "-lntup")
	if err != nil {
		return nil, fmt.Errorf("list listening ports: %w", err)
	}
	containerByPort := map[uint16]string{}
	if result, err := docker.ContainerList(ctx, client.ContainerListOptions{All: true}); err == nil {
		for _, c := range result.Items {
			name := ""
			if len(c.Names) > 0 {
				name = strings.TrimPrefix(c.Names[0], "/")
			}
			for _, p := range c.Ports {
				if p.PublicPort > 0 && name != "" {
					containerByPort[p.PublicPort] = name
				}
			}
		}
	}
	result := make([]OpenPort, 0)
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] == "Netid" {
			continue
		}
		proto := strings.ToUpper(fields[0])
		state := strings.ToUpper(fields[1])
		local := fields[4]
		port := parseEndpointPort(local)
		if port == 0 {
			continue
		}
		process := "—"
		if idx := strings.Index(line, "users:((\""); idx >= 0 {
			rest := line[idx+10:]
			if end := strings.Index(rest, "\""); end > 0 {
				process = rest[:end]
			}
		}
		container := "Host"
		if name := containerByPort[port]; name != "" {
			container = name
		}
		result = append(result, OpenPort{Port: port, Proto: proto, Process: process, Container: container, Address: parseEndpointAddress(local), State: state})
	}
	return result, nil
}

var endpointPortPattern = regexp.MustCompile(`:(\d+)$`)

func parseEndpointPort(endpoint string) uint16 {
	m := endpointPortPattern.FindStringSubmatch(endpoint)
	if len(m) != 2 {
		return 0
	}
	n, _ := strconv.ParseUint(m[1], 10, 16)
	return uint16(n)
}
func parseEndpointAddress(endpoint string) string {
	if strings.HasPrefix(endpoint, "[") {
		if idx := strings.LastIndex(endpoint, "]:"); idx >= 0 {
			return endpoint[:idx+1]
		}
	}
	if idx := strings.LastIndex(endpoint, ":"); idx >= 0 {
		return endpoint[:idx]
	}
	return endpoint
}
func collectNetworkTopology(ctx context.Context, interfaces []NetworkInterface, docker *client.Client) NetworkTopology {
	topology := NetworkTopology{Gateway: "—", Host: "—", DockerBridge: "—", Containers: []NetworkContainer{}}
	for _, iface := range interfaces {
		if iface.IP != "—" && iface.Name != "lo" {
			topology.Host = iface.IP
			break
		}
	}
	if out, err := commandOutput(ctx, "ip", "route", "show", "default"); err == nil {
		fields := strings.Fields(out)
		for i := range fields {
			if fields[i] == "via" && i+1 < len(fields) {
				topology.Gateway = fields[i+1]
				break
			}
		}
	}
	if out, err := commandOutput(ctx, "ip", "-j", "addr", "show", "docker0"); err == nil {
		var raw []ipAddressJSON
		if json.Unmarshal([]byte(out), &raw) == nil && len(raw) > 0 {
			for _, a := range raw[0].AddrInfo {
				if a.Family == "inet" {
					topology.DockerBridge = a.Local
					break
				}
			}
		}
	}
	if result, err := docker.ContainerList(ctx, client.ContainerListOptions{All: false}); err == nil {
		for _, c := range result.Items {
			name := ""
			if len(c.Names) > 0 {
				name = strings.TrimPrefix(c.Names[0], "/")
			}
			for _, n := range c.NetworkSettings.Networks {
				if n.IPAddress.IsValid() {
					topology.Containers = append(topology.Containers, NetworkContainer{Name: name, IP: n.IPAddress.String()})
					break
				}
			}
		}
	}
	return topology
}
func commandOutput(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			return "", fmt.Errorf("%s: %s", name, strings.TrimSpace(string(ee.Stderr)))
		}
		return "", err
	}
	return string(out), nil
}
