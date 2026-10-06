// SPDX-License-Identifier: AGPL-3.0-or-later

import joinStyles from '@app/features/channel/components/GuildJoinMessage.module.css';
import {SystemMessage} from '@app/features/channel/components/SystemMessage';
import {SystemMessageUsername} from '@app/features/channel/components/SystemMessageUsername';
import {useSystemMessageData} from '@app/features/messaging/hooks/useSystemMessageData';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import styles from '@app/features/theme/styles/Message.module.css';
import {Trans} from '@lingui/react/macro';
import {ChatsCircleIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';

interface ThreadCreatedMessageProps {
	message: Message;
}

export const ThreadCreatedMessage = observer(({message}: ThreadCreatedMessageProps) => {
	const {author, guild} = useSystemMessageData(message);
	const messageContent = (
		<Trans comment="System message shown in a channel after someone starts a thread. The quoted text is the thread name.">
			<SystemMessageUsername
				key={author.id}
				author={author}
				guild={guild}
				message={message}
				data-flx="channel.thread-created-message.system-message-username"
			/>{' '}
			started a thread: <span className={styles.systemMessageLink}>{message.content}</span>
		</Trans>
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
