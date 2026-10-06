// SPDX-License-Identifier: AGPL-3.0-or-later

import {handleChannelDelete} from '@app/features/channel/events/ChannelDelete';
import type {GatewayHandlerContext} from '@app/features/gateway/events/EventRouter';
import type {Channel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';

export function handleThreadDelete(
	data: Partial<Channel> & {id: string; type: number},
	context: GatewayHandlerContext,
): void {
	handleChannelDelete(data, context);
}
