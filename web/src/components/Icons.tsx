import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden {...props}>
      {props.children}
    </svg>
  );
}

export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </Svg>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </Svg>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" strokeLinecap="round" />
    </Svg>
  );
}

export function IconWatch(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconBell(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 16h12l-1.2-2.2V10a4.8 4.8 0 0 0-9.6 0v3.8L6 16z" strokeLinejoin="round" />
      <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" />
    </Svg>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 9v6M9 12h6" strokeLinecap="round" />
    </Svg>
  );
}

export function IconCard(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
    </Svg>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" strokeLinecap="round" />
    </Svg>
  );
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 11.5 12 5l8 6.5V20H4v-8.5z" strokeLinejoin="round" />
    </Svg>
  );
}
