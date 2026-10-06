// SPDX-License-Identifier: AGPL-3.0-or-later

import joinStyles from '@app/features/channel/components/GuildJoinMessage.module.css';
import {SystemMessage} from '@app/features/channel/components/SystemMessage';
import {SystemMessageUsername} from '@app/features/channel/components/SystemMessageUsername';
import Channels from '@app/features/channel/state/Channels';
import {useSystemMessageData} from '@app/features/messaging/hooks/useSystemMessageData';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import styles from '@app/features/theme/styles/Message.module.css';
import {Trans} from '@lingui/react/macro';
import {ChatsCircleIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import {useCallback} from 'react';

interface ThreadCreatedMessageProps {
	message: Message;
}

export const ThreadCreatedMessage = observer(({message}: ThreadCreatedMessageProps) => {
	const {author, guild} = useSystemMessageData(message);
	const referencedChannelId = message.messageReference?.channel_id ?? null;
	const parentChannel = Channels.getChannel(message.channelId);
	const fallbackThread = referencedChannelId
		? undefined
		: Channels.getActiveThreads(message.channelId).find((thread) => thread.name === message.content);
	const threadId = referencedChannelId ?? fallbackThread?.id ?? null;
	const guildId =
		message.messageReference?.guild_id ??
		Channels.getChannel(threadId ?? '')?.guildId ??
		parentChannel?.guildId ??
		null;
	const handleOpenThread = useCallback(() => {
		if (!threadId || !guildId) {
			return;
		}
		NavigationCommands.selectChannel(guildId, threadId);
	}, [threadId, guildId]);
	const threadName = message.content ?? '';
	const threadNameContent =
		threadId && guildId ? (
			<button
				type="button"
				className={styles.systemMessageLink}
				onClick={handleOpenThread}
				data-flx="channel.thread-created-message.thread-link"
			>
				{threadName}
			</button>
		) : (
			<span className={styles.systemMessageLink} data-flx="channel.thread-created-message.thread-name">
				{threadName}
			</span>
		);
	const messageContent = (
		<>
			<SystemMessageUsername
				key={author.id}
				author={author}
				guild={guild}
				message={message}
				data-flx="channel.thread-created-message.system-message-username"
			/>{' '}
			<Trans comment="System message shown in a channel after someone starts a thread. The thread name follows as a link.">
				started a thread:
			</Trans>{' '}
			{threadNameContent}
		</>
	);
	return (
		<SystemMessage
			icon={ChatsCircleIcon}
			iconWeight="bold"
			iconClassname={joinStyles.icon}
			message={message}
			messageContent={messageContent}
			data-flx="channel.thread-created-message.system-message"
		/>
	);
});
