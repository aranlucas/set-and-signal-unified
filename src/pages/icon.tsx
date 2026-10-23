const iconPaths = {
  pulse: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  activity: (
    <>
      <circle cx="15" cy="4" r="2" />
      <path d="m12 8 4 3 5 1M16 7l-5 6-5-1-3 5m8-4 5 4-2 5M5 7l5 1" />
    </>
  ),
  moon: <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1 9 9 0 1 0 20.9 13.3Z" />,
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 9 4v6c0 5-9 9-9 9s-9-4-9-9V7l9-4Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
};

type IconProps = { name: keyof typeof iconPaths };

export function Icon({ name }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}
