// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, MessageID, UserID} from '@app/api/BrandedTypes';
import type {ChannelRow, ThreadMemberRow} from '@app/api/database/types/ChannelTypes';
import type {Channel} from '@app/api/models/Channel';

export interface ThreadCounterDelta {
	messageCount?: number;
	totalMessageSent?: number;
	memberCount?: number;
}

export abstract class IChannelDataRepository {
	abstract findUnique(channelId: ChannelID): Promise<Channel | null>;

	abstract upsert(data: ChannelRow): Promise<Channel>;

	abstract updateLastMessageId(channelId: ChannelID, messageId: MessageID): Promise<void>;

	abstract delete(channelId: ChannelID, guildId?: GuildID): Promise<void>;

	abstract listGuildChannels(guildId: GuildID): Promise<Array<Channel>>;

	abstract listGuildThreads(guildId: GuildID): Promise<Array<Channel>>;

	abstract listChannels(channelIds: Array<ChannelID>): Promise<Array<Channel>>;

	abstract countGuildChannels(guildId: GuildID): Promise<number>;

	abstract findThreadMember(channelId: ChannelID, userId: UserID): Promise<ThreadMemberRow | null>;

	abstract listThreadMembers(channelId: ChannelID): Promise<Array<ThreadMemberRow>>;

	abstract upsertThreadMember(row: ThreadMemberRow): Promise<void>;

	abstract deleteThreadMember(channelId: ChannelID, userId: UserID): Promise<void>;

	abstract deleteThreadMembers(channelId: ChannelID): Promise<void>;

	abstract adjustThreadCounters(channelId: ChannelID, delta: ThreadCounterDelta): Promise<void>;
}
