export type Topic = `sport:${number}` | `event:${number}`;

export const sportTopic = (sportId: number): Topic => `sport:${sportId}`;
export const eventTopic = (eventId: number): Topic => `event:${eventId}`;

export type ParsedTopic = { kind: 'sport'; id: number } | { kind: 'event'; id: number };

const TOPIC_RE = /^(sport|event):(\d{1,9})$/;

export function parseTopic(topic: string): ParsedTopic | null {
  const match = TOPIC_RE.exec(topic);
  if (!match) return null;
  return { kind: match[1] as 'sport' | 'event', id: Number(match[2]) };
}
