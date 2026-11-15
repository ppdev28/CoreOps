export interface MonitoringHost {
  cpuUsagePercent: number;
  cores: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryUsagePercent: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  load1: number;
  load5: number;
  load15: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}
export interface MonitoringContainer {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
}
export interface MonitoringOverview {
  timestamp: number;
  host: MonitoringHost;
  containers: MonitoringContainer[];
}
