// SPDX-License-Identifier: AGPL-3.0-or-later

import Channels from '@app/features/channel/state/Channels';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import GuildReadState from '@app/features/guild/state/GuildReadState';
import Permission from '@app/features/permissions/state/Permission';
import QuickSwitcher from '@app/features/search/state/QuickSwitcher';
import type {Channel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';

type ThreadUpdatePayload = Partial<Channel> & {
	id: string;
	type: number;
};

export function handleThreadUpdate(data: ThreadUpdatePayload, _context: GatewayHandlerContext): void {
	const existing = Channels.getChannel(data.id);
	const channel = existing != null ? existing.withUpdates(data) : (data as Channel);
	Channels.handleThreadUpdate({channel});
	Permission.handleChannelUpdate(data.id);
	GuildReadState.handleGenericUpdate(data.id);
	QuickSwitcher.recomputeIfOpen();
}
