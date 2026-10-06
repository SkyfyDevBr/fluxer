// SPDX-License-Identifier: AGPL-3.0-or-later

import Authentication from '@app/features/auth/state/Authentication';
import * as ChannelCommands from '@app/features/channel/commands/ChannelCommands';
import {setThreadArchived, setThreadLocked} from '@app/features/channel/commands/ThreadCommands';
import styles from '@app/features/channel/components/ThreadChannelBanner.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import Channels from '@app/features/channel/state/Channels';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import Permission from '@app/features/permissions/state/Permission';
import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import * as ContextMenuCommands from '@app/features/ui/commands/ContextMenuCommands';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {ArrowLeftIcon, ChatsCircleIcon, DotsThreeIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback} from 'react';

const BACK_TO_PARENT_DESCRIPTOR = msg({
	message: 'Back to channel',
	comment: 'Tooltip of the back button in the thread header that returns to the parent channel.',
});
const THREAD_DESCRIPTOR = msg({
	message: 'Thread',
	comment: 'Label of the thread header, followed by the thread name.',
});
const ARCHIVED_DESCRIPTOR = msg({
	message: 'Archived',
	comment: 'Badge in the thread header shown when the thread is archived.',
});
const LOCKED_DESCRIPTOR = msg({
	message: 'Locked',
	comment: 'Badge in the thread header shown when the thread is locked.',
});
const ARCHIVE_DESCRIPTOR = msg({
	message: 'Archive thread',
	comment: 'Thread header menu action that archives the thread.',
});
const UNARCHIVE_DESCRIPTOR = msg({
	message: 'Unarchive thread',
	comment: 'Thread header menu action that unarchives the thread.',
});
const LOCK_THREAD_DESCRIPTOR = msg({
	message: 'Lock thread',
	comment: 'Thread header menu action that locks the thread.',
});
const UNLOCK_THREAD_DESCRIPTOR = msg({
	message: 'Unlock thread',
	comment: 'Thread header menu action that unlocks the thread.',
});
const DELETE_THREAD_DESCRIPTOR = msg({
	message: 'Delete thread',
	comment: 'Thread header menu action that deletes the thread.',
});
const THREAD_MENU_DESCRIPTOR = msg({
	message: 'Thread actions',
	comment: 'Accessible label of the thread header menu button.',
});

export const ThreadChannelBanner = observer(({channel}: {channel: Channel}) => {
	const {i18n} = useLingui();
	const guildId = channel.guildId;
	const parent = channel.parentId ? Channels.getChannel(channel.parentId) : undefined;
	const canManageThreads = Permission.can(Permissions.MANAGE_THREADS, channel);
	const isOwner = channel.ownerId != null && channel.ownerId === Authentication.currentUserId;
	const canModify = canManageThreads || isOwner;
	const archived = channel.isArchivedThread();
	const locked = channel.isLockedThread();
	const memberCount = channel.memberCount ?? 1;
	const handleBack = useCallback(() => {
		if (guildId && parent) {
			NavigationCommands.selectChannel(guildId, parent.id);
		}
	}, [guildId, parent]);
	const handleMenu = useCallback(
		(event: React.MouseEvent<HTMLElement>) => {
			event.preventDefault();
			event.stopPropagation();
			ContextMenuCommands.openFromEvent(event, ({onClose}) => (
				<MenuGroup data-flx="channel.thread-channel-banner.menu-group">
					{canModify && (
						<MenuItem
							onClick={() => {
								onClose();
								void setThreadArchived(channel, !archived);
							}}
							data-flx="channel.thread-channel-banner.menu-item.archive"
						>
							{archived ? i18n._(UNARCHIVE_DESCRIPTOR) : i18n._(ARCHIVE_DESCRIPTOR)}
						</MenuItem>
					)}
					{canManageThreads && (
						<MenuItem
							onClick={() => {
								onClose();
								void setThreadLocked(channel, !locked);
							}}
							data-flx="channel.thread-channel-banner.menu-item.lock"
						>
							{locked ? i18n._(UNLOCK_THREAD_DESCRIPTOR) : i18n._(LOCK_THREAD_DESCRIPTOR)}
						</MenuItem>
					)}
					{canModify && (
						<MenuItem
							danger={true}
							onClick={() => {
								onClose();
								void ChannelCommands.remove(channel.id);
							}}
							data-flx="channel.thread-channel-banner.menu-item.delete"
						>
							{i18n._(DELETE_THREAD_DESCRIPTOR)}
						</MenuItem>
					)}
				</MenuGroup>
			));
		},
		[channel, archived, locked, canModify, canManageThreads, i18n.locale],
	);
	return (
		<div className={styles.banner} data-flx="channel.thread-channel-banner.banner">
			{parent && (
				<button
					type="button"
					className={styles.backButton}
					aria-label={i18n._(BACK_TO_PARENT_DESCRIPTOR)}
					onClick={handleBack}
					data-flx="channel.thread-channel-banner.back-button"
				>
					<ArrowLeftIcon size={18} data-flx="channel.thread-channel-banner.arrow-left-icon" />
				</button>
			)}
			<ChatsCircleIcon size={20} className={styles.icon} data-flx="channel.thread-channel-banner.chats-circle-icon" />
			<div className={styles.main} data-flx="channel.thread-channel-banner.main">
				<span className={styles.name} data-flx="channel.thread-channel-banner.name">
					{channel.name ?? i18n._(THREAD_DESCRIPTOR)}
				</span>
				<span className={styles.meta} data-flx="channel.thread-channel-banner.meta">
					{`${i18n._(THREAD_DESCRIPTOR)} · ${memberCount} members`}
				</span>
			</div>
			{locked ? (
				<span className={styles.chip} data-flx="channel.thread-channel-banner.chip.locked">
					{i18n._(LOCKED_DESCRIPTOR)}
				</span>
			) : archived ? (
				<span className={styles.chip} data-flx="channel.thread-channel-banner.chip.archived">
					{i18n._(ARCHIVED_DESCRIPTOR)}
				</span>
			) : null}
			<button
				type="button"
				className={styles.menuButton}
				aria-label={i18n._(THREAD_MENU_DESCRIPTOR)}
				onClick={handleMenu}
				data-flx="channel.thread-channel-banner.menu-button"
			>
				<DotsThreeIcon size={20} data-flx="channel.thread-channel-banner.dots-three-icon" />
			</button>
		</div>
	);
});
