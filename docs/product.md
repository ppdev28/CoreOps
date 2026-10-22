# CoreOps Product Definition

## What CoreOps is

**CoreOps (CoreOps)** is a self-hosted, all-in-one infrastructure control panel for real operational work.

It takes inspiration from tools such as Cockpit and Portainer, but the ambition is broader: CoreOps should bring together the tasks a DevOps engineer, sysadmin, SRE or cloud engineer repeatedly performs on servers and infrastructure into one coherent application.

The product should eventually cover, in a consistent UX:

- hosts and system information
- containers and container orchestration workflows
- services and processes
- CPU, memory, disk and network metrics
- logs and diagnostics
- storage and filesystems
- networking and ports
- users, permissions and security-related operations
- scheduled tasks and automation
- configuration and environment management
- monitoring and alerts
- multiple hosts/nodes
- eventually Kubernetes and selected cloud infrastructure

This is a direction, not a commitment to implement every area immediately. Features must be added because they form useful operational workflows, not simply because they fit a checklist.

## Product positioning

CoreOps should feel closer to a professional infrastructure workstation than to a collection of unrelated admin pages.

The core promise is:

> One place to understand, operate and troubleshoot your infrastructure without needing a different UI for every subsystem.

The product should be useful for a single self-hosted Linux server first, while the architecture leaves room for multiple nodes and more advanced infrastructure later.

## Target users

Primary users:

- DevOps engineers
- sysadmins
- SREs
- platform engineers
- cloud engineers
- technically advanced homelab/self-hosting users

The UI can be approachable, but it must not hide useful operational information from experienced users.

## UX principles

### 1. Operational clarity

A user should be able to answer quickly:

- What is healthy?
- What is failing?
- What changed?
- What is consuming resources?
- What can I safely do about it?

### 2. Information density without visual chaos

Infrastructure interfaces need dense information. Use hierarchy, spacing, typography, status indicators and progressive disclosure rather than simply removing information.

### 3. Actions must be explicit

Destructive or disruptive actions should be visually distinct and, where appropriate, require confirmation. Never hide operational consequences behind ambiguous controls.

### 4. Real data over decorative data

If a metric is unavailable, show that it is unavailable. Never display a plausible-looking fabricated CPU percentage, IP address, health state or uptime.

### 5. Fast paths for experts

Frequent operations should require few clicks. Detailed inspection should remain available without forcing users through wizard-like flows for routine actions.

### 6. Consistency

The same concepts should behave the same way throughout CoreOps. A container action, service action and future host action should share recognizable interaction patterns.

### 7. Safe by default

The application has privileged infrastructure access. Safety, authentication, authorization, auditability and least privilege are product features, not future polish.

### 8. Responsive from the beginning

CoreOps must work on desktop and remain genuinely usable from a phone. Mobile access is especially important for operational checks and emergency actions.

## Design direction

The current UI was designed with Figma Make and is the visual reference for implementation.

Do not replace the existing design with a generic admin template. Implementation should adapt the architecture and data flow to the UI, not flatten the UI to match whatever code is easiest to write.

The visual language should remain modern, restrained and professional, with clear status semantics and strong hierarchy.

## Scope discipline

Do not attempt to implement the entire vision in one pass.

Prefer this loop:

1. identify a useful operational workflow;
2. implement the backend capability;
3. expose a small, stable API surface;
4. connect the existing UI;
5. test against real infrastructure;
6. improve error handling and security;
7. only then move to the next workflow.

A complete, reliable vertical slice is more valuable than a broad collection of simulated screens.
