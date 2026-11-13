package main

import (
	"bufio"
	"errors"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type HostOverview struct {
	Hostname      string     `json:"hostname"`
	OS            HostOS     `json:"os"`
	UptimeSeconds uint64     `json:"uptimeSeconds"`
	Load          HostLoad   `json:"load"`
	CPU           HostCPU    `json:"cpu"`
	Memory        HostMemory `json:"memory"`
	Disk          HostDisk   `json:"disk"`
}
type HostOS struct {
	Name         string `json:"name"`
	Version      string `json:"version"`
	Kernel       string `json:"kernel"`
	Architecture string `json:"architecture"`
}
type HostLoad struct {
	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`
}
type HostCPU struct {
	Cores        int     `json:"cores"`
	UsagePercent float64 `json:"usagePercent"`
}
type HostMemory struct {
	TotalBytes     uint64  `json:"totalBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsagePercent   float64 `json:"usagePercent"`
}
type HostDisk struct {
	TotalBytes     uint64  `json:"totalBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsagePercent   float64 `json:"usagePercent"`
}

func collectHostOverview() (HostOverview, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return HostOverview{}, err
	}
	uptime, err := readUptime("/proc/uptime")
	if err != nil {
		return HostOverview{}, err
	}
	load, err := readLoad("/proc/loadavg")
	if err != nil {
		return HostOverview{}, err
	}
	memory, err := readMemory("/proc/meminfo")
	if err != nil {
		return HostOverview{}, err
	}
	osInfo, err := readOSRelease("/etc/os-release")
	if err != nil {
		return HostOverview{}, err
	}
	disk, err := readDisk("/")
	if err != nil {
		return HostOverview{}, err
	}
	usage, err := readCPUUsage("/proc/stat", 150*time.Millisecond)
	if err != nil {
		return HostOverview{}, err
	}
	return HostOverview{Hostname: hostname, OS: HostOS{Name: osInfo.name, Version: osInfo.version, Kernel: kernelRelease(), Architecture: runtime.GOARCH}, UptimeSeconds: uint64(uptime), Load: load, CPU: HostCPU{Cores: runtime.NumCPU(), UsagePercent: usage}, Memory: memory, Disk: disk}, nil
}
func readUptime(path string) (float64, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return 0, e
	}
	f := strings.Fields(string(b))
	if len(f) < 1 {
		return 0, errors.New("invalid /proc/uptime")
	}
	return strconv.ParseFloat(f[0], 64)
}
func readLoad(path string) (HostLoad, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return HostLoad{}, e
	}
	f := strings.Fields(string(b))
	if len(f) < 3 {
		return HostLoad{}, errors.New("invalid /proc/loadavg")
	}
	a, e := strconv.ParseFloat(f[0], 64)
	if e != nil {
		return HostLoad{}, e
	}
	b5, e := strconv.ParseFloat(f[1], 64)
	if e != nil {
		return HostLoad{}, e
	}
	c, e := strconv.ParseFloat(f[2], 64)
	if e != nil {
		return HostLoad{}, e
	}
	return HostLoad{Load1: a, Load5: b5, Load15: c}, nil
}

type osRelease struct{ name, version string }

func readMemory(path string) (HostMemory, error) {
	file, e := os.Open(path)
	if e != nil {
		return HostMemory{}, e
	}
	defer file.Close()
	values := map[string]uint64{}
	s := bufio.NewScanner(file)
	for s.Scan() {
		p := strings.Fields(s.Text())
		if len(p) >= 2 {
			v, e := strconv.ParseUint(p[1], 10, 64)
			if e == nil {
				values[strings.TrimSuffix(p[0], ":")] = v * 1024
			}
		}
	}
	if e = s.Err(); e != nil {
		return HostMemory{}, e
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	if total == 0 {
		return HostMemory{}, errors.New("MemTotal missing")
	}
	if available > total {
		available = total
	}
	used := total - available
	return HostMemory{TotalBytes: total, UsedBytes: used, AvailableBytes: available, UsagePercent: percent(used, total)}, nil
}
func readOSRelease(path string) (osRelease, error) {
	file, e := os.Open(path)
	if e != nil {
		return osRelease{}, e
	}
	defer file.Close()
	r := osRelease{}
	s := bufio.NewScanner(file)
	for s.Scan() {
		p := strings.SplitN(s.Text(), "=", 2)
		if len(p) != 2 {
			continue
		}
		v := strings.Trim(strings.TrimSpace(p[1]), `"`)
		switch p[0] {
		case "NAME":
			r.name = v
		case "PRETTY_NAME":
			if v != "" {
				r.name = v
			}
		case "VERSION_ID":
			r.version = v
		case "VERSION":
			if r.version == "" {
				r.version = v
			}
		}
	}
	return r, s.Err()
}
func readDisk(path string) (HostDisk, error) {
	var st syscall.Statfs_t
	if e := syscall.Statfs(path, &st); e != nil {
		return HostDisk{}, e
	}
	total := uint64(st.Blocks) * uint64(st.Bsize)
	available := uint64(st.Bavail) * uint64(st.Bsize)
	used := total - uint64(st.Bfree)*uint64(st.Bsize)
	return HostDisk{TotalBytes: total, UsedBytes: used, AvailableBytes: available, UsagePercent: percent(used, total)}, nil
}
func percent(v, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(v) * 100 / float64(total)
}
func readCPUUsage(path string, interval time.Duration) (float64, error) {
	a, e := readCPUStat(path)
	if e != nil {
		return 0, e
	}
	time.Sleep(interval)
	b, e := readCPUStat(path)
	if e != nil {
		return 0, e
	}
	total := b.total - a.total
	idle := b.idle - a.idle
	if total == 0 {
		return 0, nil
	}
	return percent64(total-idle, total), nil
}

type cpuStat struct{ idle, total uint64 }

func readCPUStat(path string) (cpuStat, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return cpuStat{}, e
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "cpu ") {
			f := strings.Fields(line)
			if len(f) < 5 {
				return cpuStat{}, errors.New("invalid /proc/stat")
			}
			var vals []uint64
			for _, x := range f[1:] {
				v, e := strconv.ParseUint(x, 10, 64)
				if e != nil {
					return cpuStat{}, e
				}
				vals = append(vals, v)
			}
			var total uint64
			for _, v := range vals {
				total += v
			}
			idle := vals[3]
			if len(vals) > 4 {
				idle += vals[4]
			}
			return cpuStat{idle: idle, total: total}, nil
		}
	}
	return cpuStat{}, errors.New("cpu stat missing")
}
func percent64(v, total uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(v) * 100 / float64(total)
}
func kernelRelease() string {
	b, e := os.ReadFile("/proc/sys/kernel/osrelease")
	if e != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(b))
}
