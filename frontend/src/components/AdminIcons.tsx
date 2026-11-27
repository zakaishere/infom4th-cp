import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 15, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
      {...rest}
    >
      {children}
    </svg>
  );
}

export type AdminIconName =
  | "overview"
  | "contests"
  | "analytics"
  | "bank"
  | "practice"
  | "missions"
  | "duels"
  | "judging"
  | "benchmark"
  | "languages"
  | "users"
  | "teams"
  | "audit"
  | "plus"
  | "upload"
  | "folder"
  | "eye"
  | "edit"
  | "trash"
  | "check"
  | "warning"
  | "layers"
  | "arrowLeft"
  | "arrowRight"
  | "chevronUp"
  | "chevronDown"
  | "close";

export function AdminIcon({ name, size = 15 }: { name: AdminIconName; size?: number }) {
  switch (name) {
    case "overview":
      return (
        <Svg size={size}>
          <rect x="2" y="2" width="5" height="5" />
          <rect x="9" y="2" width="5" height="5" />
          <rect x="2" y="9" width="5" height="5" />
          <rect x="9" y="9" width="5" height="5" />
        </Svg>
      );
    case "contests":
      return (
        <Svg size={size}>
          <path d="M3 2v12" />
          <path d="M3 3h9l-2 3 2 3H3" />
        </Svg>
      );
    case "analytics":
      return (
        <Svg size={size}>
          <path d="M2 13.5h12" />
          <path d="M4.5 11V7.5" />
          <path d="M8 11V4" />
          <path d="M11.5 11V6" />
        </Svg>
      );
    case "bank":
      return (
        <Svg size={size}>
          <path d="M2.5 4.5L8 2l5.5 2.5L8 7 2.5 4.5z" />
          <path d="M2.5 8L8 10.5 13.5 8" />
          <path d="M2.5 11.5L8 14l5.5-2.5" />
        </Svg>
      );
    case "practice":
      return (
        <Svg size={size}>
          <path d="M3 2.5h10v11H3z" />
          <path d="M5.5 5.5h5" />
          <path d="M5.5 8h5" />
          <path d="M5.5 10.5h3" />
        </Svg>
      );
    case "missions":
      return (
        <Svg size={size}>
          <circle cx="8" cy="8" r="5.5" />
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 2.5V1.5M8 14.5v-1M2.5 8H1.5M14.5 8h-1" />
        </Svg>
      );
    case "duels":
      return (
        <Svg size={size}>
          <path d="M9.5 2L4 9h4l-1.5 5L12 7H8l1.5-5z" />
        </Svg>
      );
    case "judging":
      return (
        <Svg size={size}>
          <rect x="2" y="3" width="12" height="4" />
          <rect x="2" y="9" width="12" height="4" />
          <path d="M4.5 5h.01M4.5 11h.01" />
        </Svg>
      );
    case "benchmark":
      return (
        <Svg size={size}>
          <circle cx="8" cy="8.5" r="5" />
          <path d="M8 6v2.8l2 1.2" />
          <path d="M6.5 2h3" />
        </Svg>
      );
    case "languages":
      return (
        <Svg size={size}>
          <path d="M5.5 4.5L2 8l3.5 3.5" />
          <path d="M10.5 4.5L14 8l-3.5 3.5" />
          <path d="M9 3l-2 10" />
        </Svg>
      );
    case "users":
      return (
        <Svg size={size}>
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 13.5c.6-2.5 2.6-4 5-4s4.4 1.5 5 4" />
        </Svg>
      );
    case "teams":
      return (
        <Svg size={size}>
          <circle cx="6" cy="5.5" r="2.2" />
          <path d="M2 13c.5-2.1 2-3.4 4-3.4s3.5 1.3 4 3.4" />
          <circle cx="11.2" cy="6" r="1.8" />
          <path d="M11 9.8c1.5.2 2.7 1.2 3 3.2" />
        </Svg>
      );
    case "audit":
      return (
        <Svg size={size}>
          <path d="M3 4h10M3 8h10M3 12h6.5" />
        </Svg>
      );
    case "plus":
      return (
        <Svg size={size}>
          <path d="M8 3v10M3 8h10" />
        </Svg>
      );
    case "upload":
      return (
        <Svg size={size}>
          <path d="M8 10.5V3" />
          <path d="M5 5.8L8 2.8l3 3" />
          <path d="M2.5 11v2.2h11V11" />
        </Svg>
      );
    case "folder":
      return (
        <Svg size={size}>
          <path d="M2 4h4.2l1.4 1.6H14v7.4H2V4z" />
        </Svg>
      );
    case "eye":
      return (
        <Svg size={size}>
          <path d="M1.8 8S4.2 4 8 4s6.2 4 6.2 4-2.4 4-6.2 4-6.2-4-6.2-4z" />
          <circle cx="8" cy="8" r="1.8" />
        </Svg>
      );
    case "edit":
      return (
        <Svg size={size}>
          <path d="M11.2 2.5l2.3 2.3-7.7 7.7H3.5v-2.3l7.7-7.7z" />
        </Svg>
      );
    case "trash":
      return (
        <Svg size={size}>
          <path d="M3 4.5h10" />
          <path d="M6 4.5V3h4v1.5" />
          <path d="M4.3 4.5l.6 8.5h6.2l.6-8.5" />
        </Svg>
      );
    case "check":
      return (
        <Svg size={size}>
          <path d="M3 8.5l3.2 3.2L13 4.8" />
        </Svg>
      );
    case "warning":
      return (
        <Svg size={size}>
          <path d="M8 2.5L14 13H2L8 2.5z" />
          <path d="M8 6.5v3" />
          <path d="M8 11.3h.01" />
        </Svg>
      );
    case "layers":
      return (
        <Svg size={size}>
          <path d="M8 2.5l5.5 3-5.5 3-5.5-3 5.5-3z" />
          <path d="M2.5 9l5.5 3 5.5-3" />
          <path d="M2.5 11.8l5.5 3 5.5-3" />
        </Svg>
      );
    case "arrowLeft":
      return (
        <Svg size={size}>
          <path d="M13 8H3" />
          <path d="M6.5 4.5L3 8l3.5 3.5" />
        </Svg>
      );
    case "arrowRight":
      return (
        <Svg size={size}>
          <path d="M3 8h10" />
          <path d="M9.5 4.5L13 8l-3.5 3.5" />
        </Svg>
      );
    case "chevronUp":
      return (
        <Svg size={size}>
          <path d="M4 10l4-4 4 4" />
        </Svg>
      );
    case "chevronDown":
      return (
        <Svg size={size}>
          <path d="M4 6l4 4 4-4" />
        </Svg>
      );
    case "close":
      return (
        <Svg size={size}>
          <path d="M4 4l8 8M12 4l-8 8" />
        </Svg>
      );
  }
}
