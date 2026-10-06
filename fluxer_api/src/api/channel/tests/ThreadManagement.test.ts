// SPDX-License-Identifier: AGPL-3.0-or-later

import {createTestAccount} from '@app/api/auth/tests/AuthTestUtils';
import {
	createChannelInvite,
	createGuild,
	getChannel,
	sendChannelMessage,
	setupTestGuildWithMembers,
} from '@app/api/channel/tests/ChannelTestUtils';
import {getGatewayService} from '@app/api/middleware/ServiceRegistry';
import {type ApiTestHarness, createApiTestHarness} from '@app/api/test/ApiTestHarness';
import {createBuilder} from '@app/api/test/TestRequestBuilder';
import {APIErrorCodes} from '@fluxer/constants/src/ApiErrorCodes';
import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import type {
	ChannelResponse,
	ThreadListResponse,
	ThreadMemberResponse,
} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import type {MessageResponse} from '@fluxer/schema/src/domains/message/MessageResponseSchemas';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

describe('Thread Management', () => {
	let harness: ApiTestHarness;
	beforeEach(async () => {
		harness = await createApiTestHarness();
	});
	afterEach(async () => {
		await harness?.shutdown();
	});

	async function createThreadFromMessage(
		harness: ApiTestHarness,
		token: string,
		channelId: string,
		message: MessageResponse,
		name = 'Thread topic',
	): Promise<ChannelResponse> {
		return createBuilder<ChannelResponse>(harness, token)
			.post(`/channels/${channelId}/messages/${message.id}/threads`)
			.body({name})
			.expect(201)
			.execute();
	}

	async function startThread(
		harness: ApiTestHarness,
		token: string,
		channelId: string,
		body: Record<string, unknown>,
	): Promise<ChannelResponse> {
		return createBuilder<ChannelResponse>(harness, token)
			.post(`/channels/${channelId}/threads`)
			.body(body)
			.expect(201)
			.execute();
	}

	test('starts a public thread from a message and dispatches THREAD_CREATE', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const message = await sendChannelMessage(harness, owner.token, systemChannel.id, 'root message');
		const gateway = getGatewayService();
		const dispatchGuild = vi.spyOn(gateway, 'dispatchGuild');
		const thread = await createThreadFromMessage(harness, owner.token, systemChannel.id, message, 'Release notes');
		expect(thread.type).toBe(ChannelTypes.GUILD_PUBLIC_THREAD);
		expect(thread.parent_id).toBe(systemChannel.id);
		expect(thread.owner_id).toBe(owner.userId);
		expect(thread.name).toBe('Release notes');
		expect(thread.thread_metadata).toMatchObject({
			archived: false,
			auto_archive_duration: 1440,
			locked: false,
		});
		expect(thread.member_count).toBe(1);
		expect(thread.message_count).toBe(0);
		expect(dispatchGuild).toHaveBeenCalledWith(expect.objectContaining({event: 'THREAD_CREATE'}));
		expect(dispatchGuild).toHaveBeenCalledWith(expect.objectContaining({event: 'MESSAGE_CREATE'}));
		const channel = await getChannel(harness, owner.token, thread.id);
		expect(channel.id).toBe(thread.id);
		expect(channel.thread_metadata?.archived).toBe(false);
		const messages = await createBuilder<Array<MessageResponse>>(harness, owner.token)
			.get(`/channels/${thread.id}/messages`)
			.execute();
		expect(messages.some((entry) => entry.type === 21)).toBe(true);
		expect(guild.id).toBeTruthy();
	});

	test('creates a private thread and restricts it to members', async () => {
		const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const member = members[0]!;
		const thread = await startThread(harness, owner.token, systemChannel.id, {
			name: 'Secret thread',
			type: ChannelTypes.GUILD_PRIVATE_THREAD,
		});
		expect(thread.type).toBe(ChannelTypes.GUILD_PRIVATE_THREAD);
		await getChannel(harness, owner.token, thread.id);
		await createBuilder(harness, member.token)
			.get(`/channels/${thread.id}`)
			.expect(404, APIErrorCodes.UNKNOWN_CHANNEL)
			.execute();
		await createBuilder(harness, owner.token)
			.put(`/channels/${thread.id}/thread-members/${member.userId}`)
			.expect(204)
			.execute();
		const visible = await getChannel(harness, member.token, thread.id);
		expect(visible.id).toBe(thread.id);
		await createBuilder(harness, owner.token)
			.delete(`/channels/${thread.id}/thread-members/${member.userId}`)
			.expect(204)
			.execute();
		await createBuilder(harness, member.token)
			.get(`/channels/${thread.id}`)
			.expect(404, APIErrorCodes.UNKNOWN_CHANNEL)
			.execute();
	});

	test('unarchives and auto-joins a public thread when a message is sent', async () => {
		const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const member = members[0]!;
		const message = await sendChannelMessage(harness, owner.token, systemChannel.id, 'root');
		const thread = await createThreadFromMessage(harness, owner.token, systemChannel.id, message);
		await createBuilder<ChannelResponse>(harness, owner.token)
			.patch(`/channels/${thread.id}`)
			.body({type: ChannelTypes.GUILD_PUBLIC_THREAD, archived: true})
			.execute();
		const gateway = getGatewayService();
		const dispatchGuild = vi.spyOn(gateway, 'dispatchGuild');
		await sendChannelMessage(harness, member.token, thread.id, 'unarchive me');
		expect(dispatchGuild).toHaveBeenCalledWith(expect.objectContaining({event: 'THREAD_UPDATE'}));
		expect(dispatchGuild).toHaveBeenCalledWith(expect.objectContaining({event: 'THREAD_MEMBERS_UPDATE'}));
		const updated = await getChannel(harness, member.token, thread.id);
		expect(updated.thread_metadata?.archived).toBe(false);
		expect(updated.member_count).toBe(2);
		const self = await createBuilder<ThreadMemberResponse>(harness, member.token)
			.get(`/channels/${thread.id}/thread-members/@me`)
			.execute();
		expect(self.user_id).toBe(member.userId);
	});

	test('rejects messages in locked threads and cannot be unarchived by non-moderators', async () => {
		const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const member = members[0]!;
		const message = await sendChannelMessage(harness, member.token, systemChannel.id, 'root');
		const thread = await createThreadFromMessage(harness, member.token, systemChannel.id, message);
		await createBuilder<ChannelResponse>(harness, owner.token)
			.patch(`/channels/${thread.id}`)
			.body({type: ChannelTypes.GUILD_PUBLIC_THREAD, archived: true, locked: true})
			.execute();
		await createBuilder(harness, member.token)
			.post(`/channels/${thread.id}/messages`)
			.body({content: 'should fail'})
			.expect(403, APIErrorCodes.THREAD_IS_LOCKED)
			.execute();
		await createBuilder(harness, member.token)
			.patch(`/channels/${thread.id}`)
			.body({type: ChannelTypes.GUILD_PUBLIC_THREAD, archived: false})
			.expect(403, APIErrorCodes.THREAD_IS_LOCKED)
			.execute();
	});

	test('lists active and archived threads', async () => {
		const {owner, guild, systemChannel} = await setupTestGuildWithMembers(harness, 0);
		const first = await startThread(harness, owner.token, systemChannel.id, {
			name: 'First',
			type: ChannelTypes.GUILD_PUBLIC_THREAD,
		});
		const second = await startThread(harness, owner.token, systemChannel.id, {
			name: 'Second',
			type: ChannelTypes.GUILD_PUBLIC_THREAD,
		});
		await createBuilder<ChannelResponse>(harness, owner.token)
			.patch(`/channels/${second.id}`)
			.body({type: ChannelTypes.GUILD_PUBLIC_THREAD, archived: true})
			.execute();
		const active = await createBuilder<ThreadListResponse>(harness, owner.token)
			.get(`/guilds/${guild.id}/threads/active`)
			.execute();
		expect(active.threads.map((thread) => thread.id)).toEqual([first.id]);
		const archived = await createBuilder<ThreadListResponse>(harness, owner.token)
			.get(`/channels/${systemChannel.id}/threads/archived/public`)
			.execute();
		expect(archived.threads.map((thread) => thread.id)).toEqual([second.id]);
		expect(archived.has_more).toBe(false);
	});

	test('deletes child threads when their parent channel is deleted', async () => {
		const owner = await createTestAccount(harness);
		const guild = await createGuild(harness, owner.token, 'Thread cleanup');
		const channel = await createBuilder<ChannelResponse>(harness, owner.token)
			.post(`/guilds/${guild.id}/channels`)
			.body({name: 'parent', type: ChannelTypes.GUILD_TEXT})
			.execute();
		const thread = await startThread(harness, owner.token, channel.id, {
			name: 'Doomed',
			type: ChannelTypes.GUILD_PUBLIC_THREAD,
		});
		await createBuilder<void>(harness, owner.token).delete(`/channels/${channel.id}`).expect(204).execute();
		await createBuilder(harness, owner.token)
			.get(`/channels/${thread.id}`)
			.expect(404, APIErrorCodes.UNKNOWN_CHANNEL)
			.execute();
	});

	test('lists thread members and leaves a thread', async () => {
		const {owner, members, systemChannel} = await setupTestGuildWithMembers(harness, 1);
		const member = members[0]!;
		const thread = await startThread(harness, owner.token, systemChannel.id, {
			name: 'Members',
			type: ChannelTypes.GUILD_PUBLIC_THREAD,
		});
		await createBuilder<void>(harness, member.token)
			.put(`/channels/${thread.id}/thread-members/@me`)
			.expect(204)
			.execute();
		const list = await createBuilder<Array<ThreadMemberResponse>>(harness, member.token)
			.get(`/channels/${thread.id}/thread-members`)
			.execute();
		expect(list.map((entry) => entry.user_id).sort()).toEqual([owner.userId, member.userId].sort());
		await createBuilder<void>(harness, member.token)
			.delete(`/channels/${thread.id}/thread-members/@me`)
			.expect(204)
			.execute();
		await createBuilder(harness, member.token)
			.get(`/channels/${thread.id}/thread-members/@me`)
			.expect(404, APIErrorCodes.UNKNOWN_THREAD_MEMBER)
			.execute();
		const invite = await createChannelInvite(harness, owner.token, systemChannel.id);
		expect(invite.code).toBeTruthy();
	});
});
