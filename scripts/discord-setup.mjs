// Once, and again after changing the commands: registers `/muster` with Discord and points the app's
// interactions at the Worker. Needs the bot's token in DISCORD_BOT_TOKEN, piped in without showing it:
//
//   DISCORD_BOT_TOKEN="$(security find-generic-password -a "$USER" -s DISCORD_BOT_TOKEN -w)" node scripts/discord-setup.mjs
//
// It prints the app's public key, which the Worker needs as DISCORD_PUBLIC_KEY (it isn't secret). Set
// that before pointing interactions at the Worker: Discord checks the address answers a signed PING first.

const token = process.env.DISCORD_BOT_TOKEN;
const endpoint = process.env.INTERACTIONS_URL ?? 'https://muster.fayelore.com/discord/interactions';
if (!token) {
  console.error('Set DISCORD_BOT_TOKEN first.');
  process.exit(1);
}

async function discord(method, path, body) {
  const response = await fetch(`https://discord.com/api/v10/${path}`, {
    method,
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

// Who may run /muster: people who can manage events, unless a server changes it under Server Settings →
// Integrations → muster. Buttons on the posts are for everyone.
const MANAGE_EVENTS = String(1n << 33n);

const app = await discord('GET', 'applications/@me');
console.log(`app ${app.name} (${app.id})`);
console.log(`DISCORD_PUBLIC_KEY=${app.verify_key}`);

await discord('PUT', `applications/${app.id}/commands`, [
  {
    name: 'muster',
    description: 'Raid posts from muster',
    default_member_permissions: MANAGE_EVENTS,
    contexts: [0],
    options: [
      {
        type: 1,
        name: 'connect',
        description: 'Post a poll’s raids in this channel',
        options: [{ type: 3, name: 'code', description: 'The code from the poll’s organizer tab', required: true }],
      },
      {
        type: 1,
        name: 'event',
        description: 'Make a one-off event, such as a pug night, with its own sign-up post',
        options: [
          { type: 3, name: 'name', description: 'Such as “Pug night” or “Onyxia attunement”', required: true, max_length: 40 },
          { type: 3, name: 'date', description: 'Server time: “sat”, “tomorrow”, “Dec 12” or “2026-12-12”', required: true },
          { type: 3, name: 'time', description: 'Server time: “8pm” or “20:00”', required: true },
          {
            type: 4,
            name: 'length',
            description: 'How long it runs (the poll’s raid length if left out)',
            choices: [
              ['1 hour', 60],
              ['1½ hours', 90],
              ['2 hours', 120],
              ['2½ hours', 150],
              ['3 hours', 180],
              ['4 hours', 240],
            ].map(([name, value]) => ({ name, value })),
          },
          {
            type: 4,
            name: 'size',
            description: 'How many it holds (the poll’s raid size if left out)',
            choices: [
              { name: '10', value: 10 },
              { name: '20', value: 20 },
              { name: '40', value: 40 },
              { name: 'any number', value: 0 },
            ],
          },
          { type: 3, name: 'team', description: 'A team’s name, to seat its people first (or only them, if team only)' },
          { type: 3, name: 'note', description: 'Anything to bring or know', max_length: 200 },
        ],
      },
    ],
  },
]);
console.log('registered /muster connect and /muster event');

if (process.argv.includes('--endpoint')) {
  await discord('PATCH', 'applications/@me', { interactions_endpoint_url: endpoint });
  console.log(`interactions go to ${endpoint}`);
}
