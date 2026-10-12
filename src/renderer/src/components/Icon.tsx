// the app's line icons, drawn on a 24-unit grid with a 1.6 stroke

const PATHS = {
  sidebar: 'M4 5h16v14H4zM9.5 5v14',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20',
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  folder: 'M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z',
  branch: 'M7 4v12M7 16a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 8c0 5-10 3-10 8',
  harness: 'M4 6h16v10H4zM9 20h6M12 16v4M7.5 9.5l2 1.5-2 1.5M11.5 12.5h4',
  changes: 'M6 3.5h9l3.5 3.5v13.5H6zM12 9v6M9 12h6M9 17.5h6',
  files: 'M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z',
  more: 'M12 6.5v.01M12 12v.01M12 17.5v.01',
  send: 'M12 19V6M6.5 11.5 12 6l5.5 5.5',
  stop: 'M8 8h8v8H8z',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  monitor: 'M4 5h16v11H4zM9 20h6M12 16v4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
  info: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 11v5M12 7.8v.01',
  storage: 'M4.5 6.5c0-1.4 3.4-2.5 7.5-2.5s7.5 1.1 7.5 2.5S16.1 9 12 9 4.5 7.9 4.5 6.5zM4.5 6.5v11c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-11M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5',
  proxy: 'M4 8h13M13.5 4.5 17 8l-3.5 3.5M20 16H7M10.5 12.5 7 16l3.5 3.5',
  model: 'M12 3.5l7.5 4v9l-7.5 4-7.5-4v-9zM4.5 7.5l7.5 4 7.5-4M12 11.5v9',
  warning: 'M12 4 21 19.5H3zM12 10v4.5M12 17v.01',
  server: 'M4.5 4.5h15v6h-15zM4.5 13.5h15v6h-15zM8 7.5v.01M8 16.5v.01',
  restart: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5',
  globe: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5s1.2-6.2 3.5-8.5z',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 19.5h14',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.9 1.1l-.3 2h-3.8l-.3-2a7 7 0 0 1-1.9-1.1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7 7 0 0 1 1.9-1.1l.3-2h3.8l.3 2a7 7 0 0 1 1.9 1.1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
