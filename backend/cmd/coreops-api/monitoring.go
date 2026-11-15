package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

type MonitoringHost struct {
	CPUUsagePercent    float64 `json:"cpuUsagePercent"`
	Cores              int     `json:"cores"`
	MemoryUsedBytes    uint64  `json:"memoryUsedBytes"`
	MemoryTotalBytes   uint64  `json:"memoryTotalBytes"`
	MemoryUsagePercent float64 `json:"memoryUsagePercent"`
	SwapUsedBytes      uint64  `json:"swapUsedBytes"`
	SwapTotalBytes     uint64  `json:"swapTotalBytes"`
	Load1              float64 `json:"load1"`
	Load5              float64 `json:"load5"`
	Load15             float64 `json:"load15"`
	DiskReadBytes      uint64  `json:"diskReadBytes"`
	DiskWriteBytes     uint64  `json:"diskWriteBytes"`
	NetRXBytes         uint64  `json:"netRxBytes"`
	NetTXBytes         uint64  `json:"netTxBytes"`
}

type MonitoringContainer struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	CPUPercent       float64 `json:"cpuPercent"`
	MemoryUsedBytes  uint64  `json:"memoryUsedBytes"`
	MemoryLimitBytes uint64  `json:"memoryLimitBytes"`
	MemoryPercent    float64 `json:"memoryPercent"`
	NetRXBytes       uint64  `json:"netRxBytes"`
	NetTXBytes       uint64  `json:"netTxBytes"`
	BlockReadBytes   uint64  `json:"blockReadBytes"`
	BlockWriteBytes  uint64  `json:"blockWriteBytes"`
}

type MonitoringOverview struct {
	Timestamp  int64                 `json:"timestamp"`
	Host       MonitoringHost        `json:"host"`
	Containers []MonitoringContainer `json:"containers"`
}

func collectMonitoring(ctx context.Context, docker *client.Client) (MonitoringOverview, error) {
	host, err := collectMonitoringHost()
	if err != nil {
		return MonitoringOverview{}, err
	}
	containers, err := collectMonitoringContainers(ctx, docker)
	if err != nil {
		return MonitoringOverview{}, err
	}
	return MonitoringOverview{Timestamp: time.Now().UnixMilli(), Host: host, Containers: containers}, nil
}

func collectMonitoringHost() (MonitoringHost, error) {
	load, err := readLoad("/proc/loadavg")
	if err != nil {
		return MonitoringHost{}, err
	}
	memory, err := readMemory("/proc/meminfo")
	if err != nil {
		return MonitoringHost{}, err
	}
	cpu, err := readCPUUsage("/proc/stat", 100*time.Millisecond)
	if err != nil {
		return MonitoringHost{}, err
	}
	swapTotal, swapFree, err := readSwap("/proc/meminfo")
	if err != nil {
		return MonitoringHost{}, err
	}
	diskRead, diskWrite := readDiskIO("/proc/diskstats")
	netRX, netTX := readNetworkTotals("/proc/net/dev")
	return MonitoringHost{CPUUsagePercent: cpu, Cores: memoryCPUCount(), MemoryUsedBytes: memory.UsedBytes, MemoryTotalBytes: memory.TotalBytes, MemoryUsagePercent: memory.UsagePercent, SwapUsedBytes: swapTotal - minUint64(swapTotal, swapFree), SwapTotalBytes: swapTotal, Load1: load.Load1, Load5: load.Load5, Load15: load.Load15, DiskReadBytes: diskRead, DiskWriteBytes: diskWrite, NetRXBytes: netRX, NetTXBytes: netTX}, nil
}

func memoryCPUCount() int { return int(readCPUCount()) }
func readCPUCount() uint64 {
	b, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return 1
	}
	count := uint64(0)
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "processor\t:") {
			count++
		}
	}
	if count == 0 {
		return 1
	}
	return count
}
func readSwap(path string) (total, free uint64, err error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, 0, err
	}
	values := map[string]uint64{}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			v, e := strconv.ParseUint(fields[1], 10, 64)
			if e == nil {
				values[strings.TrimSuffix(fields[0], ":")] = v * 1024
			}
		}
	}
	return values["SwapTotal"], values["SwapFree"], nil
}
func readNetworkTotals(path string) (uint64, uint64) {
	file, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer file.Close()
	var rx, tx uint64
	s := bufio.NewScanner(file)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if strings.TrimSpace(parts[0]) == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}
		r, _ := strconv.ParseUint(fields[0], 10, 64)
		t, _ := strconv.ParseUint(fields[8], 10, 64)
		rx += r
		tx += t
	}
	return rx, tx
}
func readDiskIO(path string) (uint64, uint64) {
	file, err := os.Open(path)
	if err != nil {
		return 0, 0
	}
	defer file.Close()
	var r, w uint64
	s := bufio.NewScanner(file)
	for s.Scan() {
		f := strings.Fields(s.Text())
		if len(f) < 14 {
			continue
		}
		name := f[2]
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "fd") || strings.HasPrefix(name, "sr") {
			continue
		}
		reads, e1 := strconv.ParseUint(f[5], 10, 64)
		writes, e2 := strconv.ParseUint(f[9], 10, 64)
		if e1 != nil || e2 != nil {
			continue
		}
		r += reads * 512
		w += writes * 512
	}
	return r, w
}

func collectMonitoringContainers(ctx context.Context, docker *client.Client) ([]MonitoringContainer, error) {
	result, err := docker.ContainerList(ctx, client.ContainerListOptions{All: false})
	if err != nil {
		return nil, fmt.Errorf("list running containers: %w", err)
	}
	containers := make([]MonitoringContainer, 0, len(result.Items))
	for _, item := range result.Items {
		statsResult, err := docker.ContainerStats(ctx, item.ID, client.ContainerStatsOptions{Stream: false})
		if err != nil {
			continue
		}
		var stats container.StatsResponse
		var reader io.Reader = statsResult.Body
		decodeErr := json.NewDecoder(reader).Decode(&stats)
		if statsResult.Body != nil {
			_ = statsResult.Body.Close()
		}
		if decodeErr != nil {
			continue
		}
		name := item.ID[:12]
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		containers = append(containers, MonitoringContainer{ID: item.ID, Name: name, CPUPercent: containerCPUPercent(stats), MemoryUsedBytes: memoryUsage(stats), MemoryLimitBytes: stats.MemoryStats.Limit, MemoryPercent: memoryPercent(stats), NetRXBytes: networkRX(stats), NetTXBytes: networkTX(stats), BlockReadBytes: blockIORead(stats), BlockWriteBytes: blockIOWrite(stats)})
	}
	return containers, nil
}

func containerCPUPercent(stats container.StatsResponse) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemUsage - stats.PreCPUStats.SystemUsage)
	if cpuDelta <= 0 || systemDelta <= 0 {
		return 0
	}
	cpus := float64(stats.CPUStats.OnlineCPUs)
	if cpus == 0 {
		cpus = 1
	}
	return (cpuDelta / systemDelta) * cpus * 100
}
func memoryUsage(stats container.StatsResponse) uint64 {
	usage := stats.MemoryStats.Usage
	if cache, ok := stats.MemoryStats.Stats["cache"]; ok && usage >= cache {
		usage -= cache
	}
	return usage
}
func memoryPercent(stats container.StatsResponse) float64 {
	limit := stats.MemoryStats.Limit
	if limit == 0 {
		return 0
	}
	return float64(memoryUsage(stats)) * 100 / float64(limit)
}
func networkRX(stats container.StatsResponse) uint64 {
	var total uint64
	for _, network := range stats.Networks {
		total += network.RxBytes
	}
	return total
}
func networkTX(stats container.StatsResponse) uint64 {
	var total uint64
	for _, network := range stats.Networks {
		total += network.TxBytes
	}
	return total
}
func blockIORead(stats container.StatsResponse) uint64 {
	var total uint64
	for _, entry := range stats.BlkioStats.IoServiceBytesRecursive {
		if strings.EqualFold(entry.Op, "read") {
			total += entry.Value
		}
	}
	return total
}
func blockIOWrite(stats container.StatsResponse) uint64 {
	var total uint64
	for _, entry := range stats.BlkioStats.IoServiceBytesRecursive {
		if strings.EqualFold(entry.Op, "write") {
			total += entry.Value
		}
	}
	return total
}
func minUint64(a, b uint64) uint64 {
	if a < b {
		return a
	}
	return b
}
