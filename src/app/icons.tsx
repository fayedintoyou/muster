// Small line icons for roles and classes, drawn here (Blizzard's own art isn't ours to use). Each is a
// 16-unit square in the current text colour, so a class icon takes its class colour from the chip.

const ROLE: Record<string, string> = {
  // A shield.
  tank: 'M8 1.8 13.2 3.6V8c0 3-2.3 5.1-5.2 6.2C5.1 13.1 2.8 11 2.8 8V3.6Z',
  // A cross.
  healer: 'M6.4 2.5h3.2v3.9h3.9v3.2H9.6v3.9H6.4V9.6H2.5V6.4h3.9Z',
  // Crosshairs.
  dps: 'M8 3.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 1 0 0-9.6ZM8 1.5v3.2M8 11.3v3.2M1.5 8h3.2M11.3 8h3.2',
};

const CLASS: Record<string, string> = {
  // Two crossed swords.
  warrior: 'M3 3l10 10M13 3 3 13M2.5 10.5l3 3M10.5 2.5l3 3M13.5 10.5l-3 3M5.5 2.5l-3 3',
  // A hammer.
  paladin: 'M2.8 13.2 8.6 7.4M7.6 3.2l5.2 5.2-2.1 2.1-5.2-5.2Z',
  // A bow and arrow.
  hunter: 'M4.5 2c5.6 1.6 5.6 10.4 0 12M4.5 2v12M2 8h11.5M11 5.8 13.5 8 11 10.2',
  // A dagger.
  rogue: 'M8 1.5 9.6 9.2H6.4ZM4.8 9.8h6.4M8 10v4.5',
  // The sun.
  priest: 'M8 5.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 1 0 0-5.2ZM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4',
  // Lightning.
  shaman: 'M9.2 1.5 4 9h4l-1.2 5.5L12 7H8Z',
  // A snowflake.
  mage: 'M8 1.5v13M2.4 4.8l11.2 6.4M13.6 4.8 2.4 11.2M6.4 2.6 8 4.2l1.6-1.6M6.4 13.4 8 11.8l1.6 1.6',
  // Fel fire.
  warlock:
    'M8 14.5c-2.8 0-4.5-1.9-4.5-4.4 0-3 2.4-4.6 3-8.1 2 1.5 2.5 3 2.3 4.5 1-.5 1.7-1.5 1.8-2.5 1.6 1.8 1.9 4 1.9 6.1 0 2.5-1.7 4.4-4.5 4.4Z',
  // A leaf.
  druid: 'M3 13c0-7 4-10.5 10.5-10.5C13.5 9 10 13 3 13ZM3 13l7-7',
};

function Icon({ d, className }: { d: string; className: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function RoleIcon({ role }: { role: string }) {
  const d = ROLE[role];
  return d ? <Icon d={d} className="role-icon" /> : null;
}

export function ClassIcon({ cls }: { cls: string }) {
  const d = CLASS[cls];
  return d ? <Icon d={d} className="class-icon" /> : null;
}

/** Discord's logo, for signing in with Discord. */
export function DiscordIcon() {
  return (
    <svg className="icon discord-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  );
}
