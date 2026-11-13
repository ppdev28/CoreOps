Continue and expand the existing project:

"Server Control Center Dashboard"

IMPORTANT:
Do NOT replace or redesign the existing visual language from scratch.

Use the current Dashboard as the definitive visual foundation and extend it into a complete, coherent server management application.

The goal is to create a complete clickable product preview so we can evaluate the UX and information architecture before implementing the application in production code.

==================================================
PRODUCT
==================================================

Server Control Center is a modern self-hosted Linux server management platform.

It combines concepts from:

- Cockpit
- Portainer
- Proxmox
- Grafana
- CasaOS

but it must have its own visual identity.

The product manages:

- Linux system
- Docker containers
- applications
- services
- storage
- networking
- monitoring
- logs
- terminal
- security
- system updates
- configuration

The target user is a technically experienced Linux user, developer, homelab administrator or DevOps engineer.

The interface must feel like a serious professional developer tool.

It must NOT look like a generic enterprise admin dashboard.

==================================================
DESIGN PRINCIPLES
==================================================

Use the existing Dashboard design as the source of truth.

Maintain:

- dark-first interface
- charcoal/near-black background
- subtle elevated surfaces
- subtle borders
- restrained shadows
- compact professional controls
- Inter or equivalent modern sans-serif
- Lucide-style icons
- restrained accent colors
- excellent typography hierarchy
- high information density without clutter

Avoid:

- excessive gradients
- excessive glassmorphism
- oversized cards
- excessive rounded containers
- decorative illustrations
- marketing-style layouts
- unnecessary colors
- giant headings
- excessive whitespace

The interface should feel similar in quality to modern developer products such as Linear, Vercel, Raycast and GitHub, while remaining visually original.

==================================================
APPLICATION SHELL
==================================================

Create a consistent application shell used by every page.

Desktop:

Left sidebar
Top header
Main content

Sidebar navigation:

Server Control Center

Dashboard

Infrastructure
  Containers
  Applications
  Services
  Storage
  Network

Observability
  Monitoring
  Logs

Tools
  Terminal

System
  Security
  Updates
  Settings

At the bottom:

● Server online

Header:

Server Control Center / homelab-server

Server selector

Global search / command palette

⌘ K

Notifications

Server status

User menu

The server selector should suggest that multiple servers may be supported in the future.

==================================================
GLOBAL COMMAND PALETTE
==================================================

Create a global command palette.

It should be accessible using:

⌘ K

Design it as a serious developer command interface.

Example:

Search or run a command...

Recent:

Open containers
Open monitoring
Open terminal
View logs

Commands:

Restart container
Stop container
Start container
Open terminal
View system logs
Check updates
Open settings

The command palette should support keyboard navigation visually.

==================================================
DASHBOARD
==================================================

Keep the existing Dashboard.

Do not redesign it.

It is the primary reference for the rest of the application.

Dashboard sections:

Server health

CPU
Memory
Storage
Network

CPU chart
Memory chart

System information

Containers

Recent activity

Quick actions

Maintain the existing Dashboard structure and styling.

==================================================
CONTAINERS
==================================================

Create the main Docker management experience.

Page:

Containers

Manage and monitor Docker containers running on this server.

Toolbar:

Search

Filter

Sort

Table/Grid toggle

+ Create container

Summary:

8 containers
5 running
2 stopped
1 restarting

Default view:

TABLE

Columns:

Status
Name
Image
CPU
Memory
Network
Ports
Uptime
Actions

Example containers:

nginx
nginx:1.25-alpine
Running
Healthy

postgres
postgres:16
Running
Healthy

redis
redis:7.2-alpine
Running
Healthy

nextcloud
nextcloud:28-apache
Running
Healthy

grafana
grafana/grafana:10.2
Running
Healthy

prometheus
prom/prometheus:v2.48
Stopped

loki
grafana/loki:2.9
Stopped

traefik
traefik:v3.0
Restarting

Container state and health must be represented separately.

States:

Running
Stopped
Paused
Restarting
Exited

Health:

Healthy
Unhealthy
Starting
No healthcheck

Actions:

Start
Stop
Restart
Pause
Logs
Terminal
Inspect
Delete

Create a Grid view as an alternative.

Grid cards should contain:

status
name
image
CPU
memory
network
uptime

==================================================
CONTAINER DETAIL
==================================================

Create a full container detail experience.

Header:

← Containers

nginx

nginx:1.25-alpine

● Running
● Healthy

Actions:

Stop
Restart
Terminal
More

Tabs:

Overview
Logs
Stats
Network
Volumes
Environment
Inspect

Overview:

CPU
Memory
Network
Uptime
Restart count
Health
Ports
Mounts
Networks

Resource charts:

CPU usage

Memory usage

Network traffic

Time selector:

5m
30m
1h
6h
24h

==================================================
CONTAINER LOGS
==================================================

Create a serious log viewer.

Dark terminal-like panel.

Monospace font.

Each line contains:

timestamp
level
message

Controls:

Search logs

Filter level

Clear

Download

Auto-scroll

Follow logs

Include realistic example logs.

==================================================
CONTAINER STATS
==================================================

Create detailed resource monitoring.

Metrics:

CPU
Memory
Network RX
Network TX
Block I/O
PIDs

Use compact metric cards and clean charts.

Do not make the interface resemble Grafana too closely.

Keep the Server Control Center visual identity.

==================================================
CONTAINER TERMINAL
==================================================

Create a full-width terminal.

It should visually resemble a real interactive Linux terminal.

Example:

root@nginx:/#

Include realistic commands and output.

Controls:

Reconnect
Clear
Fullscreen

==================================================
CONTAINER NETWORK
==================================================

Show:

Container IP
MAC address
Networks
Published ports
Exposed ports

Example:

bridge
172.17.0.4

Ports:

80 → 80
443 → 443

Create a compact network information layout.

==================================================
CONTAINER VOLUMES
==================================================

Show mounted volumes.

Columns:

Source
Destination
Mode
Type

Example:

/srv/data/nginx
→ /var/www/html
rw

==================================================
CONTAINER ENVIRONMENT
==================================================

Show environment variables.

Use a secure presentation.

Variables should appear masked where appropriate.

Controls:

Show values
Copy
Edit

==================================================
CONTAINER INSPECT
==================================================

Create a JSON/code viewer.

Display Docker inspection data.

Use monospace typography.

Provide:

Copy JSON
Download
Collapse sections

==================================================
CREATE CONTAINER
==================================================

Create a multi-step container creation wizard.

Step navigation:

1. Image
2. Configuration
3. Ports
4. Volumes
5. Environment
6. Network
7. Review

Step 1:

Image name

Example:

nginx:alpine

Pull image button

Step 2:

Container name
Command
Entrypoint
Restart policy

Step 3:

Port mappings

Step 4:

Volumes

Step 5:

Environment variables

Step 6:

Network selection

Step 7:

Review configuration

Final action:

Create container

The wizard must feel significantly simpler than raw Docker configuration.

==================================================
APPLICATIONS
==================================================

Applications are NOT simply containers.

They represent higher-level services composed of one or more containers.

Create:

Applications

Installed applications

Available applications

Search applications

Categories:

Web
Database
Media
Development
Monitoring
Automation
Storage

Create an application marketplace-style interface, but keep it technical and restrained.

Example applications:

Nextcloud
Gitea
Jellyfin
Grafana
Prometheus
Vaultwarden
Immich
Home Assistant

Use compact application cards.

Each application card:

Icon
Name
Description
Status
Containers
Version

Example:

Nextcloud

● Running

3 containers

Version 31.0

==================================================
APPLICATION DETAIL
==================================================

Create:

Nextcloud

● Running

Overview
Containers
Configuration
Volumes
Network
Logs
Updates

Show the application as a composed service.

Example architecture:

Nextcloud
│
├── nextcloud
├── postgres
└── redis

Represent this relationship visually but simply.

==================================================
SERVICES
==================================================

Create Linux system service management.

Page:

Services

Search services

Filters:

Running
Stopped
Failed
Enabled
Disabled

Table:

Name
Description
Status
Enabled
CPU
Memory
Actions

Example:

docker.service
nginx.service
ssh.service
cron.service
systemd-resolved.service

Detail page:

Service name

Status

Enabled

Uptime

CPU

Memory

Actions:

Start
Stop
Restart
Enable
Disable

Tabs:

Overview
Logs
Configuration

==================================================
STORAGE
==================================================

Create a complete storage management area.

Main page:

Storage

Overview metrics:

Total capacity
Used
Available

Disk list:

Device
Model
Capacity
Usage
Filesystem
Mount point

Example:

/dev/nvme0n1
1 TB
61%
ext4
/

Create sections for:

Disks
Partitions
Mounts
Docker volumes

==================================================
DISK DETAIL
==================================================

Show:

Disk model
Device
Capacity
Temperature
SMART status

Partitions

Filesystem

Mount points

Usage

Include a disk usage visualization.

Do not make destructive disk actions prominent.

==================================================
DOCKER VOLUMES
==================================================

Show:

Volume name
Driver
Mount point
Size
Used space

Actions:

Inspect
Browse
Delete

Deletion requires confirmation.

==================================================
NETWORK
==================================================

Create network management.

Main page:

Network

Overview:

Interfaces
Traffic
IP addresses
Open ports

Interfaces:

eth0
enp3s0
docker0

Show:

IP
MAC
Link state
Speed
RX
TX

==================================================
NETWORK TOPOLOGY
==================================================

Create a simple visual topology:

Internet
↓
Router
↓
Server
↓
Docker networks
↓
Containers

Do not create a complicated network graph.

The visualization should prioritize clarity.

==================================================
PORTS
==================================================

Create an open ports view.

Columns:

Port
Protocol
Process
Container
Address
Status

Example:

22
TCP
sshd
Host
0.0.0.0

80
TCP
nginx
nginx
0.0.0.0

443
TCP
nginx
nginx
0.0.0.0

==================================================
MONITORING
==================================================

Create a full monitoring page.

This is more detailed than the Dashboard.

Metrics:

CPU
Memory
Swap
Load
Disk
Disk I/O
Network
Temperature

Create time-series charts.

Time ranges:

15m
1h
6h
24h
7d
30d

Include metric selector.

Allow switching between:

System
Containers

Create a container resource ranking:

Highest CPU
Highest Memory
Highest Network

==================================================
LOGS
==================================================

Create a centralized logging interface.

Sources:

All
System
Docker
Containers
Services
Applications
Security

Layout:

Filter bar

Search

Time range

Log level

Source

Main log viewer

Use a professional log explorer interface.

Example:

12:31:42
INFO
docker
Container started

12:32:08
WARN
nginx
Upstream timeout

12:35:21
INFO
system
Backup completed

==================================================
TERMINAL
==================================================

Create a full server terminal page.

Large terminal area.

Example:

pepe@homelab-server:~$

Controls:

New session
Clear
Fullscreen
Reconnect

Show multiple terminal tabs:

Terminal 1
Terminal 2

The terminal must feel like a real administrative tool.

==================================================
SECURITY
==================================================

Create a Security dashboard.

Show:

Firewall status
SSH status
Failed login attempts
Open ports
Security updates
Active sessions

Sections:

Firewall

SSH

Authentication

Open ports

Security events

Use strong visual distinction for critical security problems.

==================================================
UPDATES
==================================================

Create system updates management.

Show:

System up to date

or:

12 updates available

Categories:

Security
System
Applications

Each update:

Package
Current version
New version
Type

Actions:

Update selected
Update all

Show a confirmation dialog before major updates.

==================================================
SETTINGS
==================================================

Create settings.

Sections:

General
Server
Users
Authentication
Notifications
Appearance
API
Docker
Monitoring

Use a clean settings layout.

Left-side settings navigation.

Forms should be compact and professional.

==================================================
NOTIFICATIONS
==================================================

Create a global notification panel.

Example:

Container unhealthy

2 minutes ago

System update available

1 hour ago

Backup completed

3 hours ago

Support:

Mark as read
Clear all

==================================================
EMPTY STATES
==================================================

Create polished empty states for:

No containers
No applications
No services
No logs
No storage volumes
No notifications

Do not use illustrations.

Use concise explanations and useful actions.

==================================================
LOADING STATES
==================================================

Create skeleton loading states for:

Dashboard
Tables
Cards
Charts
Container detail

==================================================
ERROR STATES
==================================================

Create consistent error states.

Examples:

Docker unavailable

Unable to connect to Docker Engine.

Retry

Server offline

Unable to communicate with the server.

Retry

Permission denied

The current user does not have permission to perform this action.

==================================================
CONFIRMATION DIALOGS
==================================================

Create reusable confirmation dialogs.

Examples:

Stop container?

Restart container?

Delete container?

Delete volume?

Restart service?

Apply system updates?

Destructive actions must clearly communicate consequences.

==================================================
TOASTS
==================================================

Create notification toasts for:

Container started
Container stopped
Container restarted
Container deleted
Configuration saved
Update completed
Connection restored
Connection lost

==================================================
RESPONSIVE DESIGN
==================================================

Every screen must support:

Desktop
Tablet
Mobile

Desktop:

Sidebar visible

Tablet:

Collapsed sidebar

Mobile:

Navigation drawer

Tables should adapt into compact cards when necessary.

Do not simply shrink desktop interfaces.

==================================================
GLOBAL SEARCH
==================================================

Create a global search experience.

Search across:

Containers
Applications
Services
Logs
Files
Settings

Example:

Search "nginx"

Results:

Container
nginx

Service
nginx.service

Logs
3 matching entries

Use keyboard-friendly interaction.

==================================================
DESIGN SYSTEM
==================================================

Extend the existing design system.

Create reusable components for:

Button
Card
Badge
StatusDot
MetricCard
Table
Tabs
Dropdown
Dialog
Toast
Input
Select
Search
Chart
Terminal
LogViewer
EmptyState
Skeleton
Sidebar
Header

Use consistent:

Typography
Spacing
Border radius
Colors
States
Focus states
Hover states
Disabled states

==================================================
ACCESSIBILITY
==================================================

Ensure:

strong keyboard navigation
visible focus states
adequate contrast
semantic controls
clear error messages
non-color-only status communication

==================================================
FINAL PRODUCT FEEL
==================================================

The final result should feel like a complete production-ready Linux server control platform.

It should feel:

technical
modern
calm
fast
precise
trustworthy
professional

It should NOT feel:

like an analytics template
like a generic enterprise dashboard
like a marketing website
like a clone of Portainer
like a clone of Cockpit

The existing Dashboard remains the visual source of truth.

Do not introduce unrelated visual styles between sections.

The final prototype should be fully navigable between all major screens so we can evaluate the complete product experience before implementing it in production.