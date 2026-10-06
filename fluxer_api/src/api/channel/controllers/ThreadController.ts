// SPDX-License-Identifier: AGPL-3.0-or-later

import {createChannelID, createGuildID, createMessageID, createUserID} from '@app/api/BrandedTypes';
import {LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp} from '@app/api/types/HonoEnv';
import {Validator} from '@app/api/Validator';
import {
	GetThreadMemberQuery,
	ThreadCreateFromMessageRequest,
	ThreadCreateRequest,
	ThreadListArchivedQuery,
	ThreadListMembersQuery,
} from '@fluxer/schema/src/domains/channel/ChannelRequestSchemas';
import {
	ChannelResponse,
	ThreadListResponse,
	ThreadMemberListResponse,
	ThreadMemberResponse,
} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {
	ChannelIdMessageIdParam,
	ChannelIdParam,
	ChannelIdUserIdParam,
	GuildIdParam,
} from '@fluxer/schema/src/domains/common/CommonParamSchemas';

export function ThreadController(app: HonoApp) {
	app.post(
		'/channels/:channel_id/messages/:message_id/threads',
		RateLimitMiddleware(RateLimitConfigs.THREAD_CREATE),
		LoginRequired,
		Validator('param', ChannelIdMessageIdParam),
		Validator('json', ThreadCreateFromMessageRequest),
		OpenAPI({
			operationId: 'start_thread_from_message',
			summary: 'Start a thread from a message',
			description:
				'Creates a public thread from an existing message. The message becomes the thread starter and a thread created notice is posted in the parent channel.',
			responseSchema: ChannelResponse,
			statusCode: 201,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id, message_id} = ctx.req.valid('param');
			const data = ctx.req.valid('json');
			const channelService = ctx.get('channelService');
			const response = await channelService.threads.createThreadFromMessage({
				user,
				parentChannelId: createChannelID(channel_id),
				messageId: createMessageID(message_id),
				data,
				requestCache: ctx.get('requestCache'),
			});
			return ctx.json(response, 201);
		},
	);
	app.post(
		'/channels/:channel_id/threads',
		RateLimitMiddleware(RateLimitConfigs.THREAD_CREATE),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('json', ThreadCreateRequest),
		OpenAPI({
			operationId: 'start_thread',
			summary: 'Start a thread without a message',
			description:
				'Creates a public or private thread in a text channel. Private threads are only visible to their members until the owner makes them public, which is not supported.',
			responseSchema: ChannelResponse,
			statusCode: 201,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const data = ctx.req.valid('json');
			const channelService = ctx.get('channelService');
			const response = await channelService.threads.createThread({
				user,
				parentChannelId: createChannelID(channel_id),
				data,
				requestCache: ctx.get('requestCache'),
			});
			return ctx.json(response, 201);
		},
	);
	app.get(
		'/channels/:channel_id/threads/active',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'list_active_threads',
			summary: 'List active threads in a channel',
			description:
				'Returns the active (non-archived) threads whose parent is this channel, with the caller thread memberships.',
			responseSchema: ThreadListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const channelId = createChannelID(channel_id);
			const channelService = ctx.get('channelService');
			const channel = await channelService.channelData.operations.getPublicChannelData(channelId);
			if (!channel.guildId) {
				return ctx.json({threads: [], members: []});
			}
			return ctx.json(
				await channelService.threads.listActiveThreads({
					userId: user.id,
					guildId: channel.guildId,
					parentChannelId: channelId,
					requestCache: ctx.get('requestCache'),
				}),
			);
		},
	);
	app.get(
		'/guilds/:guild_id/threads/active',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', GuildIdParam),
		OpenAPI({
			operationId: 'list_guild_active_threads',
			summary: 'List active threads in a guild',
			description:
				'Returns all active threads in the guild that the current user can view, with their thread memberships.',
			responseSchema: ThreadListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {guild_id} = ctx.req.valid('param');
			const channelService = ctx.get('channelService');
			return ctx.json(
				await channelService.threads.listActiveThreads({
					userId: user.id,
					guildId: createGuildID(guild_id),
					requestCache: ctx.get('requestCache'),
				}),
			);
		},
	);
	app.get(
		'/channels/:channel_id/threads/archived/public',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('query', ThreadListArchivedQuery),
		OpenAPI({
			operationId: 'list_public_archived_threads',
			summary: 'List public archived threads',
			description: 'Returns archived public threads whose parent is this channel, paginated by archive timestamp.',
			responseSchema: ThreadListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const query = ctx.req.valid('query');
			const channelService = ctx.get('channelService');
			return ctx.json(
				await channelService.threads.listArchivedThreads({
					userId: user.id,
					channelId: createChannelID(channel_id),
					mode: 'public',
					before: query.before,
					limit: query.limit,
					requestCache: ctx.get('requestCache'),
				}),
			);
		},
	);
	app.get(
		'/channels/:channel_id/threads/archived/private',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('query', ThreadListArchivedQuery),
		OpenAPI({
			operationId: 'list_private_archived_threads',
			summary: 'List private archived threads',
			description: 'Returns archived private threads whose parent is this channel. Requires MANAGE_THREADS.',
			responseSchema: ThreadListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const query = ctx.req.valid('query');
			const channelService = ctx.get('channelService');
			return ctx.json(
				await channelService.threads.listArchivedThreads({
					userId: user.id,
					channelId: createChannelID(channel_id),
					mode: 'private',
					before: query.before,
					limit: query.limit,
					requestCache: ctx.get('requestCache'),
				}),
			);
		},
	);
	app.get(
		'/channels/:channel_id/users/@me/threads/archived/private',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('query', ThreadListArchivedQuery),
		OpenAPI({
			operationId: 'list_joined_private_archived_threads',
			summary: 'List joined private archived threads',
			description: 'Returns archived private threads the current user is a member of, whose parent is this channel.',
			responseSchema: ThreadListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const query = ctx.req.valid('query');
			const channelService = ctx.get('channelService');
			return ctx.json(
				await channelService.threads.listArchivedThreads({
					userId: user.id,
					channelId: createChannelID(channel_id),
					mode: 'joined_private',
					before: query.before,
					limit: query.limit,
					requestCache: ctx.get('requestCache'),
				}),
			);
		},
	);
	app.get(
		'/channels/:channel_id/thread-members',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('query', ThreadListMembersQuery),
		OpenAPI({
			operationId: 'list_thread_members',
			summary: 'List thread members',
			description:
				'Returns the members of a thread, optionally including their guild member objects when called by a bot.',
			responseSchema: ThreadMemberListResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const query = ctx.req.valid('query');
			const channelService = ctx.get('channelService');
			return ctx.json(
				await channelService.threads.listThreadMembers({
					userId: user.id,
					channelId: createChannelID(channel_id),
					withMember: query.with_member === true && user.isBot,
					after: query.after,
					limit: query.limit,
				}),
			);
		},
	);
	app.get(
		'/channels/:channel_id/thread-members/@me',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', ChannelIdParam),
		Validator('query', GetThreadMemberQuery),
		OpenAPI({
			operationId: 'get_self_thread_member',
			summary: 'Get the current thread member',
			description: 'Returns the thread member object for the current user.',
			responseSchema: ThreadMemberResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const query = ctx.req.valid('query');
			const channelService = ctx.get('channelService');
			return ctx.json(
				await channelService.threads.getThreadMember({
					userId: user.id,
					channelId: createChannelID(channel_id),
					targetUserId: user.id,
					withMember: query.with_member === true && user.isBot,
				}),
			);
		},
	);
	app.get(
		'/channels/:channel_id/thread-members/:user_id',
		RateLimitMiddleware(RateLimitConfigs.THREAD_LIST),
		LoginRequired,
		Validator('param', ChannelIdUserIdParam),
		Validator('query', GetThreadMemberQuery),
		OpenAPI({
			operationId: 'get_thread_member',
			summary: 'Get a thread member',
			description: 'Returns the thread member object for the specified user.',
			responseSchema: ThreadMemberResponse,
			statusCode: 200,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id, user_id} = ctx.req.valid('param');
			const query = ctx.req.valid('query');
			const channelService = ctx.get('channelService');
			return ctx.json(
				await channelService.threads.getThreadMember({
					userId: user.id,
					channelId: createChannelID(channel_id),
					targetUserId: createUserID(user_id),
					withMember: query.with_member === true && user.isBot,
				}),
			);
		},
	);
	app.put(
		'/channels/:channel_id/thread-members/@me',
		RateLimitMiddleware(RateLimitConfigs.THREAD_MEMBER_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'join_thread',
			summary: 'Join a thread',
			description: 'Adds the current user to a public thread.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const channelService = ctx.get('channelService');
			await channelService.threads.joinThread({
				userId: user.id,
				channelId: createChannelID(channel_id),
				requestCache: ctx.get('requestCache'),
			});
			return ctx.body(null, 204);
		},
	);
	app.put(
		'/channels/:channel_id/thread-members/:user_id',
		RateLimitMiddleware(RateLimitConfigs.THREAD_MEMBER_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdUserIdParam),
		OpenAPI({
			operationId: 'add_thread_member',
			summary: 'Add a thread member',
			description: 'Adds another guild member to a thread.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id, user_id} = ctx.req.valid('param');
			const channelService = ctx.get('channelService');
			await channelService.threads.addThreadMember({
				requesterId: user.id,
				channelId: createChannelID(channel_id),
				targetUserId: createUserID(user_id),
				requestCache: ctx.get('requestCache'),
			});
			return ctx.body(null, 204);
		},
	);
	app.delete(
		'/channels/:channel_id/thread-members/@me',
		RateLimitMiddleware(RateLimitConfigs.THREAD_MEMBER_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdParam),
		OpenAPI({
			operationId: 'leave_thread',
			summary: 'Leave a thread',
			description: 'Removes the current user from a thread.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id} = ctx.req.valid('param');
			const channelService = ctx.get('channelService');
			await channelService.threads.leaveThread({
				userId: user.id,
				channelId: createChannelID(channel_id),
				requestCache: ctx.get('requestCache'),
			});
			return ctx.body(null, 204);
		},
	);
	app.delete(
		'/channels/:channel_id/thread-members/:user_id',
		RateLimitMiddleware(RateLimitConfigs.THREAD_MEMBER_UPDATE),
		LoginRequired,
		Validator('param', ChannelIdUserIdParam),
		OpenAPI({
			operationId: 'remove_thread_member',
			summary: 'Remove a thread member',
			description: 'Removes another user from a thread. Requires MANAGE_THREADS.',
			responseSchema: null,
			statusCode: 204,
			security: ['botToken', 'bearerToken', 'sessionToken'],
			tags: 'Threads',
		}),
		async (ctx) => {
			const user = ctx.get('user');
			const {channel_id, user_id} = ctx.req.valid('param');
			const channelService = ctx.get('channelService');
			await channelService.threads.removeThreadMember({
				requesterId: user.id,
				channelId: createChannelID(channel_id),
				targetUserId: createUserID(user_id),
				requestCache: ctx.get('requestCache'),
			});
			return ctx.body(null, 204);
		},
	);
}
