// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, MessageID, UserID} from '@app/api/BrandedTypes';
import {createChannelID, createGuildID, createMessageID} from '@app/api/BrandedTypes';
import {mapChannelToResponse, mapThreadToInternalResponse} from '@app/api/channel/ChannelMappers';
import type {IChannelRepositoryAggregate} from '@app/api/channel/repositories/IChannelRepositoryAggregate';
import type {ChannelAuthService} from '@app/api/channel/services/channel_data/ChannelAuthService';
import type {ChannelUtilsService} from '@app/api/channel/services/channel_data/ChannelUtilsService';
import type {MessagePersistenceService} from '@app/api/channel/services/message/MessagePersistenceService';
import type {ChannelRow, ThreadMemberRow} from '@app/api/database/types/ChannelTypes';
import type {IGuildRepositoryAggregate} from '@app/api/guild/repositories/IGuildRepositoryAggregate';
import type {IGatewayService} from '@app/api/infrastructure/IGatewayService';
import type {ISnowflakeService} from '@app/api/infrastructure/ISnowflakeService';
import type {UserCacheService} from '@app/api/infrastructure/UserCacheService';
import type {RequestCache} from '@app/api/middleware/RequestCacheMiddleware';
import type {Channel} from '@app/api/models/Channel';
import type {User} from '@app/api/models/User';
import {
	ChannelTypes,
	MessageReferenceTypes,
	MessageTypes,
	Permissions,
} from '@fluxer/constants/src/ChannelConstants';
import {
	MAX_ACTIVE_THREADS_PER_GUILD,
	THREAD_AUTO_ARCHIVE_DURATION_DEFAULT,
} from '@fluxer/constants/src/LimitConstants';
import {InvalidChannelTypeError} from '@fluxer/errors/src/domains/channel/InvalidChannelTypeError';
import {MaxActiveThreadsError} from '@fluxer/errors/src/domains/channel/MaxActiveThreadsError';
import {ThreadLockedError} from '@fluxer/errors/src/domains/channel/ThreadLockedError';
import {UnknownChannelError} from '@fluxer/errors/src/domains/channel/UnknownChannelError';
import {UnknownMessageError} from '@fluxer/errors/src/domains/channel/UnknownMessageError';
import {UnknownThreadMemberError} from '@fluxer/errors/src/domains/channel/UnknownThreadMemberError';
import {MissingPermissionsError} from '@fluxer/errors/src/domains/core/MissingPermissionsError';
import type {
	ChannelResponse,
	ThreadListResponse,
	ThreadMemberResponse,
} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import type {ThreadCreateFromMessageRequest, ThreadCreateRequest} from '@fluxer/schema/src/domains/channel/ChannelRequestSchemas';

export interface CreateThreadFromMessageParams {
	user: User;
	parentChannelId: ChannelID;
	messageId: MessageID;
	data: ThreadCreateFromMessageRequest;
	requestCache: RequestCache;
}

export interface CreateThreadParams {
	user: User;
	parentChannelId: ChannelID;
	data: ThreadCreateRequest;
	requestCache: RequestCache;
}

export interface ThreadMemberListParams {
	userId: UserID;
	channelId: ChannelID;
	withMember: boolean;
	after?: bigint;
	limit: number;
}

interface MessageSendThreadContext {
	unarchived: boolean;
	joined: boolean;
}

export class ThreadService {
	constructor(
		private readonly channelRepository: IChannelRepositoryAggregate,
		private readonly guildRepository: IGuildRepositoryAggregate,
		private readonly gatewayService: IGatewayService,
		private readonly channelAuthService: ChannelAuthService,
		private readonly channelUtilsService: ChannelUtilsService,
		private readonly messagePersistenceService: MessagePersistenceService,
		private readonly snowflakeService: ISnowflakeService,
		private readonly userCacheService: UserCacheService,
	) {}

	private async mapThread(
		channel: Channel,
		currentUserId: UserID | null,
		requestCache: RequestCache,
	): Promise<ChannelResponse> {
		return mapChannelToResponse({
			channel,
			currentUserId,
			userCacheService: this.userCacheService,
			requestCache,
		});
	}

	private async dispatchThreadCreate({thread, requestCache}: {thread: Channel; requestCache: RequestCache}): Promise<void> {
		const data = await mapThreadToInternalResponse({
			channel: thread,
			currentUserId: null,
			userCacheService: this.userCacheService,
			requestCache,
		});
		await this.gatewayService.dispatchGuild({guildId: thread.guildId!, event: 'THREAD_CREATE', data});
	}

	private buildThreadChannelRow({
		channelId,
		guildId,
		type,
		name,
		parentId,
		ownerId,
		autoArchiveDuration,
		invitable,
		createTimestamp,
		rateLimitPerUser,
	}: {
		channelId: ChannelID;
		guildId: GuildID;
		type: number;
		name: string;
		parentId: ChannelID;
		ownerId: UserID;
		autoArchiveDuration: number;
		invitable: boolean;
		createTimestamp: Date;
		rateLimitPerUser: number | null;
	}): ChannelRow {
		const archiveTimestamp = new Date(createTimestamp.getTime() + autoArchiveDuration * 60_000);
		return {
			channel_id: channelId,
			guild_id: guildId,
			type,
			name,
			topic: null,
			icon_hash: null,
			url: null,
			parent_id: parentId,
			position: 0,
			owner_id: ownerId,
			recipient_ids: null,
			nsfw: null,
			content_warning_level: null,
			content_warning_text: null,
			rate_limit_per_user: rateLimitPerUser,
			bitrate: null,
			user_limit: null,
			voice_connection_limit: null,
			rtc_region: null,
			last_message_id: null,
			last_pin_timestamp: null,
			permission_overwrites: null,
			nicks: null,
			thread_archived: false,
			thread_auto_archive_duration: autoArchiveDuration,
			thread_archive_timestamp: archiveTimestamp,
			thread_locked: false,
			thread_invitable: invitable,
			thread_create_timestamp: createTimestamp,
			thread_member_ids: new Set([ownerId]),
			member_count: 1,
			message_count: 0,
			total_message_sent: 0,
			soft_deleted: false,
			indexed_at: null,
			version: 0,
		};
	}

	private async ensureActiveThreadCapacity(guildId: GuildID): Promise<void> {
		const threads = await this.channelRepository.channelData.listGuildThreads(guildId);
		const activeCount = threads.filter((thread) => !(thread.threadMetadata?.archived ?? false)).length;
		if (activeCount >= MAX_ACTIVE_THREADS_PER_GUILD) {
			throw new MaxActiveThreadsError();
		}
	}

	private async addMemberInternal({
		channel,
		userId,
		requestCache,
	}: {
		channel: Channel;
		userId: UserID;
		requestCache: RequestCache;
	}): Promise<ThreadMemberRow> {
		const existing = await this.channelRepository.channelData.findThreadMember(channel.id, userId);
		if (existing) {
			return existing;
		}
		const joinTimestamp = new Date();
		const member: ThreadMemberRow = {
			channel_id: channel.id,
			user_id: userId,
			join_timestamp: joinTimestamp,
			flags: 0,
		};
		await this.channelRepository.channelData.upsertThreadMember(member);
		if (!channel.threadMemberIds.has(userId)) {
			channel.threadMemberIds.add(userId);
			const updated = await this.channelRepository.channelData.upsert({
				...channel.toRow(),
				thread_member_ids: new Set(channel.threadMemberIds),
				member_count: channel.memberCount + 1,
			});
			await this.channelUtilsService.dispatchThreadMembersUpdate({
				channel: updated,
				addedMembers: [
					{
						id: member.channel_id.toString(),
						user_id: member.user_id.toString(),
						join_timestamp: member.join_timestamp.toISOString(),
						flags: member.flags,
					},
				],
				removedMemberIds: [],
				requestCache,
			});
		}
		return member;
	}

	private async buildThreadMemberResponse(
		member: ThreadMemberRow,
		guildId: GuildID | null,
		withMember: boolean,
	): Promise<ThreadMemberResponse> {
		const response: ThreadMemberResponse = {
			id: member.channel_id.toString(),
			user_id: member.user_id.toString(),
			join_timestamp: member.join_timestamp.toISOString(),
			flags: member.flags,
		};
		if (withMember && guildId) {
			const result = await this.gatewayService.getGuildMember({guildId, userId: member.user_id});
			if (result.success && result.memberData) {
				response.member = result.memberData;
			}
		}
		return response;
	}

	async createThreadFromMessage({
		user,
		parentChannelId,
		messageId,
		data,
		requestCache,
	}: CreateThreadFromMessageParams): Promise<ChannelResponse> {
		const {channel: parent, guild, checkPermission} = await this.channelAuthService.getChannelAuthenticated({
			userId: user.id,
			channelId: parentChannelId,
		});
		if (!guild || (parent.type !== ChannelTypes.GUILD_TEXT && parent.type !== ChannelTypes.GUILD_ANNOUNCEMENT)) {
			throw new InvalidChannelTypeError();
		}
		await checkPermission(Permissions.SEND_MESSAGES);
		await checkPermission(Permissions.CREATE_PUBLIC_THREADS);
		const starterMessage = await this.channelRepository.messages.getMessage(parentChannelId, messageId);
		if (!starterMessage) {
			throw new UnknownMessageError();
		}
		const guildId = createGuildID(BigInt(guild.id));
		await this.ensureActiveThreadCapacity(guildId);
		const threadType =
			parent.type === ChannelTypes.GUILD_ANNOUNCEMENT
				? ChannelTypes.GUILD_ANNOUNCEMENT_THREAD
				: ChannelTypes.GUILD_PUBLIC_THREAD;
		const channelId = createChannelID(await this.snowflakeService.generate());
		const createTimestamp = new Date();
		const autoArchiveDuration = data.auto_archive_duration ?? THREAD_AUTO_ARCHIVE_DURATION_DEFAULT;
		const thread = await this.channelRepository.channelData.upsert(
			this.buildThreadChannelRow({
				channelId,
				guildId,
				type: threadType,
				name: data.name,
				parentId: parentChannelId,
				ownerId: user.id,
				autoArchiveDuration,
				invitable: true,
				createTimestamp,
				rateLimitPerUser: data.rate_limit_per_user ?? null,
			}),
		);
		await this.channelRepository.channelData.upsertThreadMember({
			channel_id: channelId,
			user_id: user.id,
			join_timestamp: createTimestamp,
			flags: 0,
		});
		const starterMessageId = createMessageID(await this.snowflakeService.generateForChannel(channelId));
		const threadStarter = await this.messagePersistenceService.createSystemMessage({
			messageId: starterMessageId,
			channelId,
			userId: user.id,
			type: MessageTypes.THREAD_STARTER_MESSAGE,
			guildId,
			messageReference: {
				channel_id: parentChannelId,
				message_id: messageId,
				guild_id: guildId,
				type: MessageReferenceTypes.DEFAULT,
			},
		});
		await this.dispatchThreadCreate({thread, requestCache});
		await this.channelUtilsService.dispatchMessageCreate({
			channel: thread,
			message: threadStarter,
			requestCache,
		});
		const noticeMessageId = createMessageID(await this.snowflakeService.generateForChannel(parentChannelId));
		const notice = await this.messagePersistenceService.createSystemMessage({
			messageId: noticeMessageId,
			channelId: parentChannelId,
			userId: user.id,
			type: MessageTypes.THREAD_CREATED,
			content: data.name,
			guildId,
		});
		await this.channelUtilsService.dispatchMessageCreate({
			channel: parent,
			message: notice,
			requestCache,
		});
		return this.mapThread(thread, user.id, requestCache);
	}

	async createThread({user, parentChannelId, data, requestCache}: CreateThreadParams): Promise<ChannelResponse> {
		const {channel: parent, guild, checkPermission} = await this.channelAuthService.getChannelAuthenticated({
			userId: user.id,
			channelId: parentChannelId,
		});
		if (!guild || parent.type !== ChannelTypes.GUILD_TEXT) {
			throw new InvalidChannelTypeError();
		}
		await checkPermission(Permissions.SEND_MESSAGES);
		await checkPermission(Permissions.CREATE_PUBLIC_THREADS);
		const isPrivate = data.type === ChannelTypes.GUILD_PRIVATE_THREAD;
		if (isPrivate) {
			await checkPermission(Permissions.CREATE_PRIVATE_THREADS);
		}
		const guildId = createGuildID(BigInt(guild.id));
		await this.ensureActiveThreadCapacity(guildId);
		const channelId = createChannelID(await this.snowflakeService.generate());
		const createTimestamp = new Date();
		const autoArchiveDuration = data.auto_archive_duration ?? THREAD_AUTO_ARCHIVE_DURATION_DEFAULT;
		const thread = await this.channelRepository.channelData.upsert(
			this.buildThreadChannelRow({
				channelId,
				guildId,
				type: data.type,
				name: data.name,
				parentId: parentChannelId,
				ownerId: user.id,
				autoArchiveDuration,
				invitable: isPrivate ? (data.invitable ?? true) : true,
				createTimestamp,
				rateLimitPerUser: data.rate_limit_per_user ?? null,
			}),
		);
		await this.channelRepository.channelData.upsertThreadMember({
			channel_id: channelId,
			user_id: user.id,
			join_timestamp: createTimestamp,
			flags: 0,
		});
		await this.dispatchThreadCreate({thread, requestCache});
		if (!isPrivate) {
			const noticeMessageId = createMessageID(await this.snowflakeService.generateForChannel(parentChannelId));
			const notice = await this.messagePersistenceService.createSystemMessage({
				messageId: noticeMessageId,
				channelId: parentChannelId,
				userId: user.id,
				type: MessageTypes.THREAD_CREATED,
				content: data.name,
				guildId,
			});
			await this.channelUtilsService.dispatchMessageCreate({
				channel: parent,
				message: notice,
				requestCache,
			});
		}
		return this.mapThread(thread, user.id, requestCache);
	}

	async joinThread({
		userId,
		channelId,
		requestCache,
	}: {
		userId: UserID;
		channelId: ChannelID;
		requestCache: RequestCache;
	}): Promise<void> {
		const {channel, hasPermission, checkPermission} = await this.channelAuthService.getChannelAuthenticated({
			userId,
			channelId,
		});
		if (!channel.isThread() || channel.isPrivateThread()) {
			throw new UnknownChannelError();
		}
		const canManageThreads = await hasPermission(Permissions.MANAGE_THREADS);
		const metadata = channel.threadMetadata;
		if (metadata?.archived && !canManageThreads) {
			throw new ThreadLockedError();
		}
		await checkPermission(Permissions.VIEW_CHANNEL);
		await this.addMemberInternal({channel, userId, requestCache});
	}

	async addThreadMember({
		requesterId,
		channelId,
		targetUserId,
		requestCache,
	}: {
		requesterId: UserID;
		channelId: ChannelID;
		targetUserId: UserID;
		requestCache: RequestCache;
	}): Promise<void> {
		const {channel, guild, hasPermission, checkPermission} = await this.channelAuthService.getChannelAuthenticated({
			userId: requesterId,
			channelId,
		});
		if (!channel.isThread() || !guild) {
			throw new UnknownChannelError();
		}
		const canManageThreads = await hasPermission(Permissions.MANAGE_THREADS);
		const metadata = channel.threadMetadata;
		if (metadata?.archived && !canManageThreads) {
			throw new ThreadLockedError();
		}
		await checkPermission(Permissions.SEND_MESSAGES);
		await checkPermission(Permissions.SEND_MESSAGES_IN_THREADS);
		if (channel.isPrivateThread() && !canManageThreads) {
			if (!metadata?.invitable) {
				throw new MissingPermissionsError();
			}
		}
		const guildId = createGuildID(BigInt(guild.id));
		const targetMember = await this.guildRepository.getMember(guildId, targetUserId);
		if (!targetMember) {
			throw new UnknownThreadMemberError();
		}
		await this.addMemberInternal({channel, userId: targetUserId, requestCache});
	}

	async leaveThread({
		userId,
		channelId,
		requestCache,
	}: {
		userId: UserID;
		channelId: ChannelID;
		requestCache: RequestCache;
	}): Promise<void> {
		const {channel, hasPermission} = await this.channelAuthService.getChannelAuthenticated({userId, channelId});
		if (!channel.isThread()) {
			throw new UnknownChannelError();
		}
		const canManageThreads = await hasPermission(Permissions.MANAGE_THREADS);
		if (channel.threadMetadata?.archived && !canManageThreads) {
			throw new ThreadLockedError();
		}
		const existing = await this.channelRepository.channelData.findThreadMember(channelId, userId);
		if (!existing) {
			return;
		}
		await this.removeMemberInternal({channel, userId, requestCache});
	}

	async removeThreadMember({
		requesterId,
		channelId,
		targetUserId,
		requestCache,
	}: {
		requesterId: UserID;
		channelId: ChannelID;
		targetUserId: UserID;
		requestCache: RequestCache;
	}): Promise<void> {
		const {channel, checkPermission, hasPermission} = await this.channelAuthService.getChannelAuthenticated({
			userId: requesterId,
			channelId,
		});
		if (!channel.isThread()) {
			throw new UnknownChannelError();
		}
		const canManageThreads = await hasPermission(Permissions.MANAGE_THREADS);
		if (!canManageThreads) {
			throw new MissingPermissionsError();
		}
		await checkPermission(Permissions.MANAGE_THREADS);
		if (channel.ownerId === targetUserId) {
			throw new UnknownThreadMemberError();
		}
		const existing = await this.channelRepository.channelData.findThreadMember(channelId, targetUserId);
		if (!existing) {
			throw new UnknownThreadMemberError();
		}
		await this.removeMemberInternal({channel, userId: targetUserId, requestCache});
	}

	private async removeMemberInternal({
		channel,
		userId,
		requestCache,
	}: {
		channel: Channel;
		userId: UserID;
		requestCache: RequestCache;
	}): Promise<void> {
		await this.channelRepository.channelData.deleteThreadMember(channel.id, userId);
		if (channel.threadMemberIds.has(userId)) {
			channel.threadMemberIds.delete(userId);
			const updated = await this.channelRepository.channelData.upsert({
				...channel.toRow(),
				thread_member_ids: channel.threadMemberIds.size > 0 ? new Set(channel.threadMemberIds) : null,
				member_count: Math.max(0, channel.memberCount - 1),
			});
			await this.channelUtilsService.dispatchThreadMembersUpdate({
				channel: updated,
				addedMembers: [],
				removedMemberIds: [userId.toString()],
				requestCache,
			});
		}
	}

	async listThreadMembers({
		userId,
		channelId,
		withMember,
		after,
		limit,
	}: ThreadMemberListParams): Promise<Array<ThreadMemberResponse>> {
		const {channel, guild} = await this.channelAuthService.getChannelAuthenticated({userId, channelId});
		if (!channel.isThread()) {
			throw new UnknownChannelError();
		}
		let members = await this.channelRepository.channelData.listThreadMembers(channelId);
		members = members.sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0));
		if (after) {
			members = members.filter((member) => member.user_id > after);
		}
		members = members.slice(0, limit);
		const guildId = guild ? createGuildID(BigInt(guild.id)) : null;
		return Promise.all(members.map((member) => this.buildThreadMemberResponse(member, guildId, withMember)));
	}

	async getThreadMember({
		userId,
		channelId,
		targetUserId,
		withMember,
	}: {
		userId: UserID;
		channelId: ChannelID;
		targetUserId: UserID;
		withMember: boolean;
	}): Promise<ThreadMemberResponse> {
		const {channel, guild} = await this.channelAuthService.getChannelAuthenticated({userId, channelId});
		if (!channel.isThread()) {
			throw new UnknownChannelError();
		}
		const member = await this.channelRepository.channelData.findThreadMember(channelId, targetUserId);
		if (!member) {
			throw new UnknownThreadMemberError();
		}
		const guildId = guild ? createGuildID(BigInt(guild.id)) : null;
		return this.buildThreadMemberResponse(member, guildId, withMember);
	}

	private async listVisibleThreadMembers(
		threads: Array<Channel>,
		userId: UserID,
	): Promise<Array<ThreadMemberResponse>> {
		const members = await Promise.all(
			threads.map(async (thread) => {
				const member = await this.channelRepository.channelData.findThreadMember(thread.id, userId);
				if (!member) return null;
				return this.buildThreadMemberResponse(member, thread.guildId, false);
			}),
		);
		return members.filter((member): member is ThreadMemberResponse => member !== null);
	}

	async listActiveThreads({
		userId,
		guildId,
		parentChannelId,
		requestCache,
	}: {
		userId: UserID;
		guildId: GuildID;
		parentChannelId?: ChannelID;
		requestCache: RequestCache;
	}): Promise<ThreadListResponse> {
		const member = await this.guildRepository.getMember(guildId, userId);
		if (!member) {
			throw new UnknownChannelError();
		}
		const canManageThreads =
			((await this.gatewayService.getUserPermissions({guildId, userId})) & Permissions.MANAGE_THREADS) ===
			Permissions.MANAGE_THREADS;
		const candidates = (await this.channelRepository.channelData.listGuildThreads(guildId))
			.filter((thread) => !(thread.threadMetadata?.archived ?? false))
			.filter((thread) => (parentChannelId ? thread.parentId === parentChannelId : true));
		const visibility = await Promise.all(
			candidates.map(async (thread) => {
				if (thread.isPrivateThread()) {
					return thread.threadMemberIds.has(userId) || canManageThreads;
				}
				if (canManageThreads) {
					return true;
				}
				const permissions = await this.gatewayService.getUserPermissions({
					guildId,
					userId,
					channelId: thread.id,
				});
				return (permissions & Permissions.VIEW_CHANNEL) === Permissions.VIEW_CHANNEL;
			}),
		);
		const threads = candidates
			.filter((_thread, index) => visibility[index])
			.sort((a, b) => {
				const aId = a.lastMessageId ?? 0n;
				const bId = b.lastMessageId ?? 0n;
				if (aId === bId) return a.id < b.id ? 1 : -1;
				return aId < bId ? 1 : -1;
			});
		const threadResponses = await Promise.all(threads.map((thread) => this.mapThread(thread, userId, requestCache)));
		const members = await this.listVisibleThreadMembers(threads, userId);
		return {threads: threadResponses, members};
	}

	async listArchivedThreads({
		userId,
		channelId,
		mode,
		before,
		limit,
		requestCache,
	}: {
		userId: UserID;
		channelId: ChannelID;
		mode: 'public' | 'private' | 'joined_private';
		before?: string;
		limit: number;
		requestCache: RequestCache;
	}): Promise<ThreadListResponse> {
		const {channel: parent, guild, hasPermission} = await this.channelAuthService.getChannelAuthenticated({
			userId,
			channelId,
		});
		if (!guild || parent.isThread()) {
			throw new UnknownChannelError();
		}
		if (mode === 'public') {
			const canReadHistory = await hasPermission(Permissions.READ_MESSAGE_HISTORY);
			if (!canReadHistory) {
				throw new MissingPermissionsError();
			}
		} else {
			const canManageThreads = await hasPermission(Permissions.MANAGE_THREADS);
			if (mode === 'private' && !canManageThreads) {
				throw new MissingPermissionsError();
			}
		}
		const guildId = createGuildID(BigInt(guild.id));
		const beforeDate = before ? new Date(before) : null;
		let threads = (await this.channelRepository.channelData.listGuildThreads(guildId))
			.filter((thread) => thread.parentId === channelId)
			.filter((thread) => thread.threadMetadata?.archived ?? false)
			.filter((thread) => {
				if (mode === 'public') {
					return thread.type === ChannelTypes.GUILD_PUBLIC_THREAD || thread.type === ChannelTypes.GUILD_ANNOUNCEMENT_THREAD;
				}
				if (mode === 'private') {
					return thread.isPrivateThread();
				}
				return thread.isPrivateThread() && thread.threadMemberIds.has(userId);
			})
			.filter((thread) => {
				if (!beforeDate) return true;
				const archiveTimestamp = thread.threadMetadata?.archiveTimestamp;
				return archiveTimestamp ? archiveTimestamp.getTime() < beforeDate.getTime() : false;
			})
			.sort((a, b) => {
				const aTimestamp = a.threadMetadata?.archiveTimestamp?.getTime() ?? 0;
				const bTimestamp = b.threadMetadata?.archiveTimestamp?.getTime() ?? 0;
				if (aTimestamp === bTimestamp) return a.id < b.id ? 1 : -1;
				return bTimestamp - aTimestamp;
			});
		const hasMore = threads.length > limit;
		threads = threads.slice(0, limit);
		const threadResponses = await Promise.all(threads.map((thread) => this.mapThread(thread, userId, requestCache)));
		const members = await this.listVisibleThreadMembers(threads, userId);
		return {threads: threadResponses, members, has_more: hasMore};
	}

	async prepareThreadMessageSend({
		channel,
		userId,
		hasPermission,
		requestCache,
	}: {
		channel: Channel;
		userId: UserID;
		hasPermission: (permission: bigint) => Promise<boolean>;
		requestCache: RequestCache;
	}): Promise<MessageSendThreadContext | null> {
		if (!channel.isThread()) {
			return null;
		}
		const metadata = channel.threadMetadata;
		if (!metadata) {
			return null;
		}
		const canManageThreads = await hasPermission(Permissions.MANAGE_THREADS);
		if (metadata.locked && !canManageThreads) {
			throw new ThreadLockedError();
		}
		let current = channel;
		let unarchived = false;
		if (metadata.archived) {
			current = await this.channelRepository.channelData.upsert({
				...channel.toRow(),
				thread_archived: false,
				thread_archive_timestamp: new Date(Date.now() + metadata.autoArchiveDuration * 60_000),
			});
			await this.channelUtilsService.dispatchThreadUpdate({channel: current, requestCache});
			unarchived = true;
		}
		let joined = false;
		if (!current.isPrivateThread() && !current.threadMemberIds.has(userId)) {
			await this.addMemberInternal({channel: current, userId, requestCache});
			joined = true;
		}
		return {unarchived, joined};
	}

	async recordThreadMessageCreated({
		channel,
		requestCache: _requestCache,
	}: {
		channel: Channel;
		requestCache: RequestCache;
	}): Promise<void> {
		if (!channel.isThread()) {
			return;
		}
		await this.channelRepository.channelData.adjustThreadCounters(channel.id, {
			messageCount: 1,
			totalMessageSent: 1,
		});
	}

	async recordThreadMessageDeleted({channel}: {channel: Channel}): Promise<void> {
		if (!channel.isThread()) {
			return;
		}
		await this.channelRepository.channelData.adjustThreadCounters(channel.id, {messageCount: -1});
	}
}
