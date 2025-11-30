export type MsgContext = {
  Body?: string;
  From?: string;
  To?: string;
  MessageSid?: string;
  MediaPath?: string;
  MediaUrl?: string;
  MediaType?: string;
  Transcript?: string;
  provider?: string;
  assistantProfile?: string;
  assistantLabel?: string;
  assistantPersona?: string;
  botUserId?: string;
  senderId?: string;
  senderName?: string;
  guildId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  isMentioned?: boolean;
  rawMentions?: string[];
};

export type TemplateContext = MsgContext & {
  BodyStripped?: string;
  SessionId?: string;
  IsNewSession?: string;
};

// Simple {{Placeholder}} interpolation using inbound message context.
export function applyTemplate(str: string, ctx: TemplateContext) {
  return str.replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    const value = (ctx as Record<string, unknown>)[key];
    return value == null ? "" : String(value);
  });
}
