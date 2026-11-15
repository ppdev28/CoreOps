// Pure appearance policy, shared by settings, CSS tokens and browser validation.
export const ACCENT_PRESETS = [
  { name: "Neutral", value: "neutral", swatch: "#e5e5e5" },
  { name: "Blue", value: "#60a5fa", swatch: "#60a5fa" },
  { name: "Indigo", value: "#818cf8", swatch: "#818cf8" },
  { name: "Violet", value: "#a78bfa", swatch: "#a78bfa" },
  { name: "Teal", value: "#2dd4bf", swatch: "#2dd4bf" },
  { name: "Green", value: "#86efac", swatch: "#86efac" },
  { name: "Amber", value: "#fbbf24", swatch: "#fbbf24" },
  { name: "Rose", value: "#fb7185", swatch: "#fb7185" },
] as const;
export const isAccentColor = (value: unknown): value is string =>
  typeof value === "string" &&
  (value === "neutral" || /^#[0-9a-f]{6}$/i.test(value));
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) =>
  rgb(hex)
    .map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
export const contrast = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
export function mix(a: string, b: string, amount: number) {
  const target = rgb(b);
  return (
    "#" +
    rgb(a)
      .map((c, i) =>
        Math.round(c + (target[i] - c) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function resolveAppearance(
  theme: "dark" | "gray" | "light",
  accentColor: string,
) {
  const light = theme === "light";
  const base = light
    ? {
        bg: "#f5f5f5",
        bgHeader: "#fafafa",
        bgSidebar: "#fafafa",
        raised: "#ffffff",
        overlay: "#f0f0f0",
        hover: "#e8e8e8",
        border: "#d4d4d4",
        borderHeader: "#dedede",
        borderRight: "#dedede",
        borderMuted: "#e5e5e5",
        borderStrong: "#a3a3a3",
        text: "#171717",
        textSub: "#404040",
        textDim: "#626262",
        green: "#18753d",
        yellow: "#8c5608",
        red: "#b42335",
        purple: "#7655a3",
      }
    : theme === "gray"
      ? {
          bg: "#202020",
          bgHeader: "#242424",
          bgSidebar: "#242424",
          raised: "#2b2b2b",
          overlay: "#333333",
          hover: "#3c3c3c",
          border: "#484848",
          borderHeader: "#414141",
          borderRight: "#414141",
          borderMuted: "#3c3c3c",
          borderStrong: "#737373",
          text: "#f2f2f2",
          textSub: "#d4d4d4",
          textDim: "#b3b3b3",
          green: "#79c99a",
          yellow: "#e6bb73",
          red: "#ee9292",
          purple: "#c4b5fd",
        }
      : {
          bg: "#090909",
          bgHeader: "#090909",
          bgSidebar: "#101010",
          raised: "#171717",
          overlay: "#222222",
          hover: "#272727",
          border: "#2d2d2d",
          borderHeader: "#222222",
          borderRight: "#222222",
          borderMuted: "#272727",
          borderStrong: "#555555",
          text: "#f2f2f2",
          textSub: "#c4c4c4",
          textDim: "#a0a0a0",
          green: "#79c99a",
          yellow: "#e6bb73",
          red: "#ee9292",
          purple: "#c4c4c4",
        };
  const primary =
    accentColor === "neutral" ? (light ? "#202020" : "#e5e5e5") : accentColor;
  const onAccent =
    contrast(primary, "#171717") >= contrast(primary, "#ffffff")
      ? "#171717"
      : "#ffffff";
  let accent = primary;
  for (let i = 1; contrast(accent, base.raised) < 4.5 && i <= 20; i++)
    accent = mix(primary, light ? "#000000" : "#ffffff", i / 20);
  return {
    ...base,
    primary,
    onAccent,
    accent,
    accentHover: mix(
      primary,
      onAccent === "#171717" ? "#ffffff" : "#000000",
      0.12,
    ),
    active:
      accentColor === "neutral" ? base.hover : mix(base.raised, primary, 0.14),
  };
}
