import { Server, ChevronDown, Copy } from "lucide-react";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
export function ServerSelector({
  hostname,
  onCopy,
}: {
  hostname: string;
  onCopy: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="mono-server-trigger"
          aria-label="Select server"
        >
          <Server size={13} />
          <span>{hostname || "Unavailable"}</span>
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="dashboard-popover" align="start">
        <p className="page-eyebrow">CURRENT SERVER</p>
        <strong>{hostname || "Unavailable"}</strong>
        <p>Single-host mode. Additional servers are not configured.</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hostname}
          onClick={onCopy}
        >
          <Copy size={12} />
          Copy hostname
        </Button>
      </PopoverContent>
    </Popover>
  );
}
