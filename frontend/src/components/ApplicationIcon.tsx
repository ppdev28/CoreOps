import { useState } from "react";
import {
  Box,
  Database,
  Radar,
  Shield,
  Film,
  Code,
  HardDrive,
  Workflow,
  Globe,
} from "lucide-react";
import { T } from "../lib/tokens";

const assets = import.meta.glob<string>(
  ["../assets/application-icons/*.svg", "../assets/application-icons/*.png"],
  {
    query: "?url",
    import: "default",
    eager: true,
  },
);
const logos = Object.fromEntries(
  Object.entries(assets).map(([path, url]) => [
    path
      .split("/")
      .pop()!
      .replace(/\.(svg|png)$/, ""),
    url,
  ]),
);
const brands: [string, string][] = [
  ["gethomepage", "homepage"],
  ["homepage", "homepage"],
  ["pairdrop", "pairdrop"],
  ["convertx", "convertx"],
  ["node-exporter", "prometheus-node-exporter"],
  ["homeassistant", "home-assistant"],
  ["home-assistant", "home-assistant"],
  ["vaultwarden", "vaultwarden"],
  ["cloudbeaver", "cloudbeaver"],
  ["postgres", "postgresql"],
  ["uptime-kuma", ""],
  ["qbittorrent", "qbittorrent"],
  ["flaresolverr", "flaresolverr"],
  ["transmission", "transmission"],
  ["prometheus", "prometheus"],
  ["grafana", "grafana"],
  ["portainer", "portainer"],
  ["dockhand", "dockhand-svg"],
  ["adminer", "adminer"],
  ["couchdb", "couchdb"],
  ["prowlarr", "prowlarr"],
  ["radarr", "radarr"],
  ["dozzle", "dozzle"],
  ["firefox", "firefox"],
  ["arcane", "arcane"],
  ["android", "android"],
  ["btop", "btop"],
  ["mailpit", "mailpit"],
  ["immich", "immich"],
  ["jellyfin", "jellyfin"],
  ["nextcloud", "nextcloud"],
  ["keycloak", "keycloak"],
  ["mariadb", "mariadb"],
  ["mysql", "mysql"],
  ["redis", "redis"],
  ["minio", "minio"],
  ["nginx", "nginx"],
  ["gitea", "gitea"],
  ["gitlab", "gitlab"],
  ["plex", "plex"],
  ["n8n", "n8n"],
  ["docker", "docker"],
];
function inferredLogo(value: string) {
  const normalized = value.toLowerCase().replace(/[_\s]+/g, "-");
  const brand = brands.find(([match]) => normalized.includes(match));
  return brand && logos[brand[1]];
}
function imageURL(icon: string) {
  try {
    if (!/^(https?:\/\/|\/|\.\/)/i.test(icon)) return null;
    const url = new URL(icon, window.location.href);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}
export default function ApplicationIcon({
  name,
  image = "",
  icon = "",
  category = "",
  size = 40,
}: {
  name: string;
  image?: string;
  icon?: string;
  category?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const remote = imageURL(icon);
  const simpleIcon =
    remote?.hostname === "cdn.simpleicons.org"
      ? remote.pathname.split("/")[1]?.toLowerCase()
      : "";
  const bundled =
    logos[icon.toLowerCase()] ||
    (simpleIcon && (logos[simpleIcon] || inferredLogo(simpleIcon))) ||
    inferredLogo(name) ||
    inferredLogo(image);
  // Recognized Simple Icons resolve locally. User-provided URLs keep precedence.
  const candidates =
    simpleIcon && bundled ? [bundled] : [remote?.href, bundled];
  const src = candidates.find(
    (candidate): candidate is string => !!candidate && !failed.has(candidate),
  );
  const Icon =
    (
      {
        Database,
        Monitoring: Radar,
        Security: Shield,
        Media: Film,
        Development: Code,
        Storage: HardDrive,
        Automation: Workflow,
        Web: Globe,
      } as Record<string, typeof Box>
    )[category] || Box;
  const glyph =
    !remote && !/[:/]/.test(icon) && Array.from(icon).length <= 3 ? icon : "";
  return (
    <span
      className="application-logo"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        background: src && src === bundled ? "#f3f4f6" : T.bg,
        border: `1px solid ${T.border}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={Math.round(size * 0.72)}
          height={Math.round(size * 0.72)}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed((previous) => new Set(previous).add(src))}
          style={{ objectFit: "contain", display: "block" }}
        />
      ) : glyph ? (
        <span aria-hidden="true" style={{ fontSize: size * 0.5 }}>
          {glyph}
        </span>
      ) : (
        <Icon
          aria-hidden="true"
          size={Math.round(size * 0.5)}
          color={T.textSub}
        />
      )}
    </span>
  );
}
