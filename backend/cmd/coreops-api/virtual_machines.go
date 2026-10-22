package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type VirtualMachine struct {
	Name       string `json:"name"`
	Connection string `json:"connection"`
	State      string `json:"state"`
}

type VirtualMachineActionResponse struct {
	OK     bool   `json:"ok"`
	Name   string `json:"name"`
	Action string `json:"action"`
}

const libvirtSystemURI = "qemu:///system"

func collectVirtualMachines(ctx context.Context) ([]VirtualMachine, error) {
	commandCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	output, err := exec.CommandContext(commandCtx, "virsh", "-c", libvirtSystemURI, "list", "--all", "--name").CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return nil, fmt.Errorf("unable to query libvirt with virsh: %s", message)
	}

	lines := strings.Split(string(output), "\n")
	machines := make([]VirtualMachine, 0, len(lines))
	for _, line := range lines {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}

		state, err := virtualMachineState(commandCtx, name)
		if err != nil {
			return nil, err
		}
		machines = append(machines, VirtualMachine{
			Name:       name,
			Connection: "System",
			State:      state,
		})
	}

	return machines, nil
}

func virtualMachineState(ctx context.Context, name string) (string, error) {
	output, err := exec.CommandContext(ctx, "virsh", "-c", libvirtSystemURI, "domstate", name).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("unable to read virtual machine %q state: %s", name, message)
	}
	state := strings.TrimSpace(string(output))
	if state == "" {
		return "unknown", nil
	}
	return state, nil
}

func virtualMachineAction(ctx context.Context, name, action string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("virtual machine name is required")
	}

	var command string
	switch action {
	case "start":
		command = "start"
	case "shutdown":
		command = "shutdown"
	default:
		return fmt.Errorf("unsupported virtual machine action %q", action)
	}

	commandCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandCtx, "virsh", "-c", libvirtSystemURI, command, name).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("unable to %s virtual machine %q: %s", command, name, message)
	}
	return nil
}
