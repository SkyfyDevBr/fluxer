// SPDX-License-Identifier: AGPL-3.0-or-later

import {ThreadCreateModal} from '@app/features/channel/components/modals/ThreadCreateModal';
import {ThreadsBrowserModal} from '@app/features/channel/components/modals/ThreadsBrowserModal';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import Permission from '@app/features/permissions/state/Permission';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';

function isThreadableChannel(channel: Channel): boolean {
	return (
		channel.type === ChannelTypes.GUILD_TEXT ||
		channel.type === ChannelTypes.GUILD_ANNOUNCEMENT ||
		channel.type === ChannelTypes.GUILD_ANNOUNCEMENT_THREAD
	);
}

export function canCreateThreadFromMessage(message: Message): boolean {
	const channel = Channels.getChannel(message.channelId);
	if (!channel?.guildId || channel.isThread() || !isThreadableChannel(channel)) {
		return false;
	}
	return (
		Permission.can(Permissions.SEND_MESSAGES, channel) && Permission.can(Permissions.CREATE_PUBLIC_THREADS, channel)
	);
}

export function openCreateThreadFromMessage(message: Message): void {
	const channel = Channels.getChannel(message.channelId);
	if (!channel || !canCreateThreadFromMessage(message)) {
		return;
	}
	ModalCommands.pushWithKey(
		modal(() => <ThreadCreateModal channel={channel} message={message} />),
		`create-thread-${message.id}`,
	);
}

export function openCreateThread(channel: Channel): void {
	if (!channel.guildId || !isThreadableChannel(channel)) {
		return;
	}
	ModalCommands.pushWithKey(
		modal(() => <ThreadCreateModal channel={channel} />),
		`create-thread-${channel.id}`,
	);
}

export function openThreadsBrowser(channel: Channel): void {
	if (!channel.guildId || channel.isThread()) {
		return;
	}
	ModalCommands.pushWithKey(
		modal(() => <ThreadsBrowserModal channel={channel} />),
		`threads-browser-${channel.id}`,
	);
}
