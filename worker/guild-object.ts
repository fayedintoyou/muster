import { DurableObject } from 'cloudflare:workers';

// One object per Discord server: which poll each of its channels posts for, so a slash command typed in a
// channel finds its poll. `/muster connect` fills it in; disconnecting takes it out.

export class GuildObject extends DurableObject<Env> {
  private get kv() {
    return this.ctx.storage.kv;
  }

  async link(channel: string, poll: string): Promise<void> {
    // One channel per poll: connecting it elsewhere moves it.
    for (const [k, v] of this.kv.list<string>({ prefix: 'ch:' })) if (v === poll) this.kv.delete(k);
    this.kv.put(`ch:${channel}`, poll);
  }

  async unlink(poll: string): Promise<void> {
    for (const [k, v] of this.kv.list<string>({ prefix: 'ch:' })) if (v === poll) this.kv.delete(k);
  }

  /** The channel's poll, or the server's only one when it posts for one poll in all. */
  async pollFor(channel: string): Promise<string | null> {
    const here = this.kv.get<string>(`ch:${channel}`);
    if (here) return here;
    const all = new Set<string>();
    for (const [, v] of this.kv.list<string>({ prefix: 'ch:' })) all.add(v);
    return all.size === 1 ? [...all][0] : null;
  }
}
