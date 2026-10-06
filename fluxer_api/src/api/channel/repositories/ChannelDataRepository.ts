// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, MessageID, UserID} from '@app/api/BrandedTypes';
import {
	privateChannelFanOutTargets,
	privateChannelLastMessageIdPatch,
	privateChannelMetadataPatch,
} from '@app/api/channel/PrivateChannelSnapshot';
import type {ThreadCounterDelta} from '@app/api/channel/repositories/IChannelDataRepository';
import {IChannelDataRepository} from '@app/api/channel/repositories/IChannelDataRepository';
import {
	BatchBuilder,
	fetchMany,
	fetchManyInChunks,
	fetchOne,
	upsertOne,
} from '@app/api/database/CassandraQueryExecution';
import {Db, type DbOp} from '@app/api/database/CassandraTypes';
import {buildPatchFromData, executeVersionedUpdate} from '@app/api/database/CassandraVersionedUpdate';
import type {ChannelRow, ThreadMemberRow} from '@app/api/database/types/ChannelTypes';
import {CHANNEL_COLUMNS} from '@app/api/database/types/ChannelTypes';
import {Logger} from '@app/api/Logger';
import type {RequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import {Channel} from '@app/api/models/Channel';
import {Channels, ChannelsByGuild, PrivateChannels, ThreadMembers} from '@app/api/Tables';
import {THREAD_CHANNEL_TYPES} from '@fluxer/constants/src/ChannelConstants';

const FETCH_CHANNEL_BY_ID = Channels.select({
	where: [Channels.where.eq('channel_id'), Channels.where.eq('soft_deleted')],
	limit: 1,
});
const FETCH_CHANNELS_BY_IDS = Channels.select({
	where: [Channels.where.in('channel_id', 'channel_ids'), Channels.where.eq('soft_deleted')],
});
const FETCH_GUILD_CHANNELS_BY_GUILD_ID = ChannelsByGuild.select({
	where: ChannelsByGuild.where.eq('guild_id'),
});
const FETCH_THREAD_MEMBER = ThreadMembers.select({
	where: [ThreadMembers.where.eq('channel_id'), ThreadMembers.where.eq('user_id')],
	limit: 1,
});
const FETCH_THREAD_MEMBERS_BY_CHANNEL = ThreadMembers.select({
	where: ThreadMembers.where.eq('channel_id'),
});
const FETCH_OPEN_PRIVATE_CHANNEL_TARGET = PrivateChannels.selectCql({
	columns: ['user_id'],
	where: [PrivateChannels.where.eq('user_id'), PrivateChannels.where.eq('channel_id')],
	limit: 1,
});

export class ChannelDataRepository extends IChannelDataRepository {
	constructor(private readonly requestCache?: RequestCache) {
		super();
	}

	async findUnique(channelId: ChannelID): Promise<Channel | null> {
		const prefetched = this.requestCache?.takeChannel(channelId);
		if (prefetched !== undefined) {
			return prefetched;
		}
		const channel = await fetchOne<ChannelRow>(
			FETCH_CHANNEL_BY_ID.bind({
				channel_id: channelId,
				soft_deleted: false,
			}),
		);
		return channel ? new Channel(channel) : null;
	}

	async upsert(data: ChannelRow, oldData?: ChannelRow | null): Promise<Channel> {
		const channelId = data.channel_id;
		this.requestCache?.channels.delete(channelId);
		const result = await executeVersionedUpdate<ChannelRow, 'channel_id' | 'soft_deleted'>(
			async () => fetchOne<ChannelRow>(FETCH_CHANNEL_BY_ID.bind({channel_id: channelId, soft_deleted: false})),
			(current) => ({
				pk: {channel_id: channelId, soft_deleted: false},
				patch: buildPatchFromData(data, current, CHANNEL_COLUMNS, ['channel_id', 'soft_deleted']),
			}),
			Channels,
			{initialData: oldData},
		);
		if (data.guild_id) {
			await upsertOne(
				ChannelsByGuild.upsertAll({
					guild_id: data.guild_id,
					channel_id: channelId,
				}),
			);
		}
		const finalRow: ChannelRow = {...data, version: result.finalVersion ?? 0};
		await this.writeThroughPrivateChannelMetadata(finalRow);
		return new Channel(finalRow);
	}

	async updateLastMessageId(channelId: ChannelID, messageId: MessageID): Promise<void> {
		this.requestCache?.channels.delete(channelId);
		const existing = await fetchOne<ChannelRow>(
			FETCH_CHANNEL_BY_ID.bind({
				channel_id: channelId,
				soft_deleted: false,
			}),
		);
		if (!existing) return;
		const prev = existing.last_message_id ?? null;
		if (prev !== null && messageId <= prev) return;
		await upsertOne(
			Channels.patchByPk({channel_id: channelId, soft_deleted: false}, {last_message_id: Db.set(messageId)}),
		);
		void this.fanOutPrivateChannelLastMessageId(existing, messageId);
	}

	private async writeThroughPrivateChannelMetadata(row: ChannelRow): Promise<void> {
		try {
			const targets = await this.listOpenPrivateChannelTargets(row);
			if (targets.length === 0) return;
			const patch = privateChannelMetadataPatch(row);
			const results = await Promise.allSettled(
				targets.map((userId) =>
					upsertOne(PrivateChannels.patchByPk({user_id: userId, channel_id: row.channel_id}, patch)),
				),
			);
			this.logFanOutFailures(results, row.channel_id, 'metadata');
		} catch (error) {
			this.logFanOutError(error, row.channel_id, 'metadata');
		}
	}

	private async fanOutPrivateChannelLastMessageId(existing: ChannelRow, messageId: MessageID): Promise<void> {
		try {
			const targets = await this.listOpenPrivateChannelTargets(existing);
			if (targets.length === 0) return;
			const patch = privateChannelLastMessageIdPatch(messageId);
			const results = await Promise.allSettled(
				targets.map((userId) =>
					upsertOne(PrivateChannels.patchByPk({user_id: userId, channel_id: existing.channel_id}, patch)),
				),
			);
			this.logFanOutFailures(results, existing.channel_id, 'last_message_id');
		} catch (error) {
			this.logFanOutError(error, existing.channel_id, 'last_message_id');
		}
	}

	private async listOpenPrivateChannelTargets(row: ChannelRow): Promise<Array<UserID>> {
		const targets = privateChannelFanOutTargets(row);
		if (targets.length === 0) return [];
		const openTargets = await Promise.all(
			targets.map(async (userId) => {
				const existing = await fetchOne<{user_id: UserID}>(FETCH_OPEN_PRIVATE_CHANNEL_TARGET, {
					user_id: userId,
					channel_id: row.channel_id,
				});
				return existing ? userId : null;
			}),
		);
		return openTargets.filter((userId): userId is UserID => userId != null);
	}

	private logFanOutFailures(results: Array<PromiseSettledResult<unknown>>, channelId: ChannelID, kind: string): void {
		const failures = results.filter((result) => result.status === 'rejected');
		if (failures.length === 0) return;
		Logger.warn(
			{
				channelId: channelId.toString(),
				kind,
				failureCount: failures.length,
				error:
					failures[0].status === 'rejected' && failures[0].reason instanceof Error
						? failures[0].reason.message
						: String(failures[0].status === 'rejected' ? failures[0].reason : ''),
			},
			'Failed to write through private channel snapshot fan-out',
		);
	}

	private logFanOutError(error: unknown, channelId: ChannelID, kind: string): void {
		Logger.warn(
			{
				channelId: channelId.toString(),
				kind,
				error: error instanceof Error ? error.message : String(error),
			},
			'Failed to write through private channel snapshot fan-out',
		);
	}

	async delete(channelId: ChannelID, guildId?: GuildID): Promise<void> {
		this.requestCache?.channels.delete(channelId);
		const batch = new BatchBuilder();
		batch.addPrepared(
			Channels.deleteByPk({
				channel_id: channelId,
				soft_deleted: false,
			}),
		);
		if (guildId) {
			batch.addPrepared(
				ChannelsByGuild.deleteByPk({
					guild_id: guildId,
					channel_id: channelId,
				}),
			);
		}
		await batch.execute();
	}

	async listGuildChannels(guildId: GuildID): Promise<Array<Channel>> {
		const channels = await this.listGuildChannelRows(guildId);
		return channels.filter((channel) => !THREAD_CHANNEL_TYPES.has(channel.type)).map((channel) => new Channel(channel));
	}

	async listGuildThreads(guildId: GuildID): Promise<Array<Channel>> {
		const channels = await this.listGuildChannelRows(guildId);
		return channels.filter((channel) => THREAD_CHANNEL_TYPES.has(channel.type)).map((channel) => new Channel(channel));
	}

	private async listGuildChannelRows(guildId: GuildID): Promise<Array<ChannelRow>> {
		const guildChannels = await fetchMany<{
			channel_id: bigint;
		}>(FETCH_GUILD_CHANNELS_BY_GUILD_ID.bind({guild_id: guildId}));
		if (guildChannels.length === 0) return [];
		const channelIds = guildChannels.map((c) => c.channel_id);
		return fetchManyInChunks<ChannelRow>(FETCH_CHANNELS_BY_IDS, channelIds, (chunk) => ({
			channel_ids: chunk,
			soft_deleted: false,
		}));
	}

	async listChannels(channelIds: Array<ChannelID>): Promise<Array<Channel>> {
		if (channelIds.length === 0) return [];
		const channels = await fetchManyInChunks<ChannelRow>(FETCH_CHANNELS_BY_IDS, channelIds, (chunk) => ({
			channel_ids: chunk,
			soft_deleted: false,
		}));
		return channels.map((channel) => new Channel(channel));
	}

	async countGuildChannels(guildId: GuildID): Promise<number> {
		const channels = await this.listGuildChannelRows(guildId);
		return channels.filter((channel) => !THREAD_CHANNEL_TYPES.has(channel.type)).length;
	}

	async findThreadMember(channelId: ChannelID, userId: UserID): Promise<ThreadMemberRow | null> {
		const row = await fetchOne<ThreadMemberRow>(FETCH_THREAD_MEMBER.bind({channel_id: channelId, user_id: userId}));
		return row ?? null;
	}

	async listThreadMembers(channelId: ChannelID): Promise<Array<ThreadMemberRow>> {
		return fetchMany<ThreadMemberRow>(FETCH_THREAD_MEMBERS_BY_CHANNEL.bind({channel_id: channelId}));
	}

	async upsertThreadMember(row: ThreadMemberRow): Promise<void> {
		this.requestCache?.channels.delete(row.channel_id);
		await upsertOne(ThreadMembers.upsertAll(row));
	}

	async deleteThreadMember(channelId: ChannelID, userId: UserID): Promise<void> {
		this.requestCache?.channels.delete(channelId);
		await upsertOne(ThreadMembers.deleteByPk({channel_id: channelId, user_id: userId}));
	}

	async deleteThreadMembers(channelId: ChannelID): Promise<void> {
		this.requestCache?.channels.delete(channelId);
		await upsertOne(ThreadMembers.deletePartition({channel_id: channelId}));
	}

	async adjustThreadCounters(channelId: ChannelID, delta: ThreadCounterDelta): Promise<void> {
		this.requestCache?.channels.delete(channelId);
		type Patch = Partial<Record<'message_count' | 'total_message_sent' | 'member_count', DbOp<number>>>;
		await executeVersionedUpdate<ChannelRow, 'channel_id' | 'soft_deleted'>(
			async () => fetchOne<ChannelRow>(FETCH_CHANNEL_BY_ID.bind({channel_id: channelId, soft_deleted: false})),
			(current): {pk: {channel_id: ChannelID; soft_deleted: boolean}; patch: Patch} => {
				if (!current) return {pk: {channel_id: channelId, soft_deleted: false}, patch: {}};
				const messageCount = Math.max(0, (current.message_count ?? 0) + (delta.messageCount ?? 0));
				const totalMessageSent = Math.max(0, (current.total_message_sent ?? 0) + (delta.totalMessageSent ?? 0));
				const memberCount = Math.max(0, (current.member_count ?? 0) + (delta.memberCount ?? 0));
				return {
					pk: {channel_id: channelId, soft_deleted: false},
					patch: {
						message_count: Db.set(messageCount),
						total_message_sent: Db.set(totalMessageSent),
						member_count: Db.set(memberCount),
					},
				};
			},
			Channels,
		);
	}
}
