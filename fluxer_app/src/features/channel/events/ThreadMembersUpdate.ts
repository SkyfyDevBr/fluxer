// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';

interface ThreadMembersUpdatePayload {
	id: string;
	guild_id: string;
	member_count: number;
	added_members?: Array<{
		id: string;
		user_id: string;
		join_timestamp: string;
		flags: number;
	}>;
	removed_member_ids?: Array<string>;
}

export function handleThreadMembersUpdate(data: ThreadMembersUpdatePayload, _context: GatewayHandlerContext): void {
	Channels.handleThreadMembersUpdate({channelId: data.id, memberCount: data.member_count});
}
