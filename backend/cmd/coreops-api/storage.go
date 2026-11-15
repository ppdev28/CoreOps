package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/moby/moby/client"
)

type StorageDisk struct {
	Device      string  `json:"device"`
	Model       string  `json:"model"`
	Capacity    int64   `json:"capacityBytes"`
	Used        int64   `json:"usedBytes"`
	Available   int64   `json:"availableBytes"`
	UsagePct    float64 `json:"usagePercent"`
	Filesystem  string  `json:"filesystem"`
	Mount       string  `json:"mount"`
	Temperature string  `json:"temperature"`
	SMART       string  `json:"smart"`
	Type        string  `json:"type"`
}
type StorageVolume struct {
	Name       string `json:"name"`
	Driver     string `json:"driver"`
	Mountpoint string `json:"mountpoint"`
	Size       int64  `json:"sizeBytes"`
	Used       int64  `json:"usedBytes"`
}
type StorageOverview struct {
	TotalCapacity int64           `json:"totalCapacityBytes"`
	Used          int64           `json:"usedBytes"`
	Available     int64           `json:"availableBytes"`
	UsagePercent  float64         `json:"usagePercent"`
	Disks         []StorageDisk   `json:"disks"`
	Volumes       []StorageVolume `json:"volumes"`
}
type lsblkOutput struct {
	BlockDevices []lsblkDevice `json:"blockdevices"`
}
type lsblkDevice struct {
	Name       string        `json:"name"`
	Path       string        `json:"path"`
	Type       string        `json:"type"`
	FSType     string        `json:"fstype"`
	Size       int64         `json:"size"`
	Mountpoint string        `json:"mountpoint"`
	Mounts     []string      `json:"mountpoints"`
	Model      string        `json:"model"`
	Children   []lsblkDevice `json:"children"`
}

func collectStorage(ctx context.Context, docker *client.Client) (StorageOverview, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	disks, err := collectStorageDisks(ctx)
	if err != nil {
		return StorageOverview{}, err
	}
	volumes, err := collectStorageVolumes(ctx, docker)
	if err != nil {
		return StorageOverview{}, err
	}
	var total, used, available int64
	for _, disk := range disks {
		if disk.Type == "disk" {
			total += disk.Capacity
		}
	}
	for _, disk := range disks {
		if disk.Mount != "" && disk.Type != "disk" {
			used += disk.Used
			available += disk.Available
		}
	}
	if total == 0 {
		for _, disk := range disks {
			total += disk.Capacity
			used += disk.Used
			available += disk.Available
		}
	}
	if total == 0 {
		total = used + available
	}
	pct := 0.0
	if total > 0 {
		pct = float64(used) * 100 / float64(total)
	}
	return StorageOverview{TotalCapacity: total, Used: used, Available: available, UsagePercent: pct, Disks: disks, Volumes: volumes}, nil
}
func collectStorageDisks(ctx context.Context) ([]StorageDisk, error) {
	cmd := exec.CommandContext(ctx, "lsblk", "-J", "-b", "-o", "NAME,PATH,TYPE,FSTYPE,SIZE,MOUNTPOINTS,MODEL")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk: %w", err)
	}
	var result lsblkOutput
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("parse lsblk output: %w", err)
	}
	var disks []StorageDisk
	for _, device := range result.BlockDevices {
		appendStorageDevice(&disks, device)
	}
	return disks, nil
}
func appendStorageDevice(disks *[]StorageDisk, device lsblkDevice) {
	path := device.Path
	if path == "" && device.Name != "" {
		path = "/dev/" + device.Name
	}
	mount := device.Mountpoint
	if mount == "" && len(device.Mounts) > 0 {
		mount = device.Mounts[0]
	}
	used, available := int64(0), int64(0)
	if mount != "" {
		used, available = filesystemUsage(mount)
	}
	capacity := device.Size
	pct := 0.0
	if used+available > 0 {
		pct = float64(used) * 100 / float64(used+available)
	}
	*disks = append(*disks, StorageDisk{Device: path, Model: strings.TrimSpace(device.Model), Capacity: capacity, Used: used, Available: available, UsagePct: pct, Filesystem: device.FSType, Mount: mount, Temperature: "—", SMART: "—", Type: device.Type})
	for _, child := range device.Children {
		appendStorageDevice(disks, child)
	}
}
func filesystemUsage(path string) (int64, int64) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0
	}
	available := int64(stat.Bavail) * int64(stat.Bsize)
	total := int64(stat.Blocks) * int64(stat.Bsize)
	used := total - int64(stat.Bfree)*int64(stat.Bsize)
	if used < 0 {
		used = 0
	}
	return used, available
}
func collectStorageVolumes(ctx context.Context, docker *client.Client) ([]StorageVolume, error) {
	result, err := docker.VolumeList(ctx, client.VolumeListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list docker volumes: %w", err)
	}
	volumes := make([]StorageVolume, 0, len(result.Items))
	for _, volume := range result.Items {
		mountpoint := volume.Mountpoint
		size, used := volumeSize(mountpoint)
		volumes = append(volumes, StorageVolume{Name: volume.Name, Driver: volume.Driver, Mountpoint: mountpoint, Size: size, Used: used})
	}
	return volumes, nil
}
func volumeSize(mountpoint string) (int64, int64) {
	if mountpoint == "" {
		return 0, 0
	}
	info, err := os.Stat(mountpoint)
	if err != nil || !info.IsDir() {
		return 0, 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "du", "-sb", filepath.Clean(mountpoint))
	output, err := cmd.Output()
	if err != nil {
		return 0, 0
	}
	fields := strings.Fields(string(output))
	if len(fields) == 0 {
		return 0, 0
	}
	used, err := strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, 0
	}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(mountpoint, &stat); err != nil {
		return used, used
	}
	size := int64(stat.Blocks) * int64(stat.Bsize)
	return size, used
}
