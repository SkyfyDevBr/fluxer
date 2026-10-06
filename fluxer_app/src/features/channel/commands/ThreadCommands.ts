// SPDX-License-Identifier: AGPL-3.0-or-later

import {Endpoints} from '@app/features/app/constants/Endpoints';
import {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import {http} from '@app/features/platform/transport/RestTransport';
import type {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import type {
	ChannelResponse,
	ThreadListResponse,
	ThreadMemberResponse,
	Channel as WireChannel,
} from '@fluxer/schema/src/domains/channel/ChannelSchemas';

export interface CreateThreadFromMessageOptions {
	name: string;
	autoArchiveDuration?: number;
	rateLimitPerUser?: number;
}

export interface CreateThreadOptions {
	name: string;
	type: typeof ChannelTypes.GUILD_PUBLIC_THREAD | typeof ChannelTypes.GUILD_PRIVATE_THREAD;
	autoArchiveDuration?: number;
	rateLimitPerUser?: number;
	invitable?: boolean;
}

export type ArchivedThreadMode = 'public' | 'private' | 'joined_private';

function asChannel(response: ChannelResponse): WireChannel {
	return response;
}

export function cacheThread(channel: WireChannel): Channel {
	Channels.handleThreadCreate({channel});
	const cached = Channels.getChannel(channel.id);
	return cached ?? new Channel(channel);
}

export async function createThreadFromMessage(
	parentChannelId: string,
	messageId: string,
	options: CreateThreadFromMessageOptions,
): Promise<Channel> {
	const response = await http.post<ChannelResponse>(Endpoints.CHANNEL_MESSAGE_THREADS(parentChannelId, messageId), {
		body: {
			name: options.name,
			...(options.autoArchiveDuration !== undefined ? {auto_archive_duration: options.autoArchiveDuration} : {}),
			...(options.rateLimitPerUser !== undefined ? {rate_limit_per_user: options.rateLimitPerUser} : {}),
		},
	});
	const thread = cacheThread(asChannel(response.body));
	const guildId = thread.guildId ?? parentChannelId;
	NavigationCommands.selectChannel(guildId, thread.id);
	return thread;
}

export async function createThread(parentChannelId: string, options: CreateThreadOptions): Promise<Channel> {
	const response = await http.post<ChannelResponse>(Endpoints.CHANNEL_THREADS(parentChannelId), {
		body: {
			name: options.name,
			type: options.type,
			...(options.autoArchiveDuration !== undefined ? {auto_archive_duration: options.autoArchiveDuration} : {}),
			...(options.rateLimitPerUser !== undefined ? {rate_limit_per_user: options.rateLimitPerUser} : {}),
			...(options.invitable !== undefined ? {invitable: options.invitable} : {}),
		},
	});
	const thread = cacheThread(asChannel(response.body));
	const guildId = thread.guildId ?? parentChannelId;
	NavigationCommands.selectChannel(guildId, thread.id);
	return thread;
}

export async function updateThread(
	channel: Channel,
	updates: {
		name?: string;
		archived?: boolean;
		locked?: boolean;
		invitable?: boolean;
		auto_archive_duration?: number;
		rate_limit_per_user?: number | null;
	},
): Promise<Channel> {
	const response = await http.patch<ChannelResponse>(Endpoints.CHANNEL(channel.id), {
		body: {
			type: channel.type,
			...updates,
		},
	});
	const updated = new Channel(asChannel(response.body));
	Channels.handleThreadUpdate({channel: asChannel(response.body)});
	return updated;
}

export async function setThreadArchived(channel: Channel, archived: boolean): Promise<Channel> {
	return updateThread(channel, {archived});
}

export async function setThreadLocked(channel: Channel, locked: boolean): Promise<Channel> {
	return updateThread(channel, {locked, ...(locked ? {archived: true} : {})});
}

export async function joinThread(channelId: string): Promise<void> {
	await http.put(Endpoints.CHANNEL_THREAD_MEMBER_ME(channelId), {});
}

export async function leaveThread(channelId: string): Promise<void> {
	await http.delete(Endpoints.CHANNEL_THREAD_MEMBER_ME(channelId));
}

export async function addThreadMember(channelId: string, userId: string): Promise<void> {
	await http.put(Endpoints.CHANNEL_THREAD_MEMBER(channelId, userId), {});
}

export async function removeThreadMember(channelId: string, userId: string): Promise<void> {
	await http.delete(Endpoints.CHANNEL_THREAD_MEMBER(channelId, userId));
}

export async function fetchThreadMembers(channelId: string): Promise<Array<ThreadMemberResponse>> {
	const response = await http.get<Array<ThreadMemberResponse>>(Endpoints.CHANNEL_THREAD_MEMBERS(channelId));
	return response.body;
}

export async function fetchActiveThreadsForChannel(channelId: string): Promise<ThreadListResponse> {
	const response = await http.get<ThreadListResponse>(Endpoints.CHANNEL_THREADS_ACTIVE(channelId));
	return response.body;
}

export async function fetchActiveThreadsForGuild(guildId: string): Promise<ThreadListResponse> {
	const response = await http.get<ThreadListResponse>(Endpoints.GUILD_THREADS_ACTIVE(guildId));
	return response.body;
}

export async function fetchArchivedThreads(
	channelId: string,
	mode: ArchivedThreadMode,
	before?: string,
): Promise<ThreadListResponse> {
	const endpoint =
		mode === 'public'
			? Endpoints.CHANNEL_THREADS_ARCHIVED_PUBLIC(channelId)
			: mode === 'private'
				? Endpoints.CHANNEL_THREADS_ARCHIVED_PRIVATE(channelId)
				: Endpoints.CHANNEL_THREADS_ARCHIVED_JOINED_PRIVATE(channelId);
	const response = await http.get<ThreadListResponse>(endpoint, {
		query: before ? {before} : undefined,
	});
	return response.body;
}
