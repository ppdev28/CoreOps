if (
  typeof document !== "undefined" &&
  !document.getElementById("coreops-sidebar-overflow-fix")
) {
  const style = document.createElement("style");
  style.id = "coreops-sidebar-overflow-fix";
  style.textContent = `
    aside{overflow:visible!important}
    aside > div:first-child > button:last-child{opacity:1;pointer-events:auto;left:12px;right:auto!important;top:12px!important;width:28px!important;height:28px!important;padding:0!important;border-radius:8px!important;background:rgba(17,19,24,.94)!important;border:1px solid rgba(59,130,246,.34)!important;box-shadow:0 4px 14px rgba(0,0,0,.34),0 0 0 3px rgba(59,130,246,.07)!important;transform:none!important;transition:background 140ms ease,border-color 140ms ease,box-shadow 140ms ease!important;z-index:20}
    aside > div:first-child > div:first-child{transition:opacity 120ms ease!important}
    aside > div:first-child > div:first-child > svg,aside > div:first-child > div:first-child > * > svg{opacity:0!important}
    aside > div:first-child > button:last-child:hover{background:rgba(31,35,48,.98)!important;border-color:rgba(59,130,246,.62)!important;box-shadow:0 5px 16px rgba(0,0,0,.42),0 0 0 3px rgba(59,130,246,.12)!important}
    html[data-scp-reduce-motion="true"] *,html[data-scp-reduce-motion="true"] *::before,html[data-scp-reduce-motion="true"] *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
    html[data-scp-compact="true"] aside nav button{padding-top:5px!important;padding-bottom:5px!important}
    html[data-scp-compact="true"] aside nav > div > div{margin-bottom:0!important}
    html[data-scp-compact="true"] .dash-metrics{gap:7px!important}
    html[data-scp-compact="true"] .dash-charts{gap:8px!important}
    html[data-scp-compact="true"] .dash-bottom{gap:8px!important}
  `;
  document.head.appendChild(style);
}
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
