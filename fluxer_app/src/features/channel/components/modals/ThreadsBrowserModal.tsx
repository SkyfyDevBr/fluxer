// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {
	type ArchivedThreadMode,
	cacheThread,
	fetchActiveThreadsForChannel,
	fetchArchivedThreads,
} from '@app/features/channel/commands/ThreadCommands';
import {ThreadCreateModal} from '@app/features/channel/components/modals/ThreadCreateModal';
import styles from '@app/features/channel/components/modals/ThreadsBrowserModal.module.css';
import type {Channel} from '@app/features/channel/models/Channel';
import * as NavigationCommands from '@app/features/navigation/commands/NavigationCommands';
import Permission from '@app/features/permissions/state/Permission';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {modal} from '@app/features/ui/commands/ModalCommands';
import {Permissions} from '@fluxer/constants/src/ChannelConstants';
import type {ChannelResponse} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useEffect, useState} from 'react';

const THREADS_DESCRIPTOR = msg({
	message: 'Threads',
	comment: 'Title of the thread browser modal.',
});
const ACTIVE_DESCRIPTOR = msg({
	message: 'Active',
	comment: 'Thread browser tab that lists active threads.',
});
const ARCHIVED_DESCRIPTOR = msg({
	message: 'Archived',
	comment: 'Thread browser tab that lists archived public threads.',
});
const PRIVATE_DESCRIPTOR = msg({
	message: 'Private',
	comment: 'Thread browser tab that lists archived private threads, for moderators.',
});
const MINE_DESCRIPTOR = msg({
	message: 'Mine',
	comment: 'Thread browser tab that lists archived private threads the current user joined.',
});
const NEW_THREAD_DESCRIPTOR = msg({
	message: 'New thread',
	comment: 'Button that opens the create thread modal from the thread browser.',
});
const NO_THREADS_DESCRIPTOR = msg({
	message: 'No threads here yet.',
	comment: 'Empty state of a thread browser tab.',
});
const CLOSE_DESCRIPTOR = msg({
	message: 'Close',
	comment: 'Button that closes the thread browser modal.',
});
const LOAD_MORE_DESCRIPTOR = msg({
	message: 'Load more',
	comment: 'Button that loads the next page of archived threads.',
});

type BrowserTab = 'active' | ArchivedThreadMode;

export const ThreadsBrowserModal = observer(({channel}: {channel: Channel}) => {
	const {i18n} = useLingui();
	const [tab, setTab] = useState<BrowserTab>('active');
	const [threads, setThreads] = useState<ReadonlyArray<ChannelResponse>>([]);
	const [loading, setLoading] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const canReadHistory = Permission.can(Permissions.READ_MESSAGE_HISTORY, channel);
	const canManageThreads = Permission.can(Permissions.MANAGE_THREADS, channel);
	const canCreate = Permission.can(Permissions.CREATE_PUBLIC_THREADS, channel);
	const load = async (mode: BrowserTab, before?: string) => {
		setLoading(true);
		try {
			const response =
				mode === 'active'
					? await fetchActiveThreadsForChannel(channel.id)
					: await fetchArchivedThreads(channel.id, mode, before);
			setThreads((current) => (before ? [...current, ...response.threads] : response.threads));
			setHasMore(response.has_more === true);
		} catch {
			setThreads([]);
			setHasMore(false);
		} finally {
			setLoading(false);
		}
	};
	useEffect(() => {
		void load(tab);
	}, [channel.id, tab]);
	const tabs: Array<{id: BrowserTab; label: string}> = [{id: 'active', label: i18n._(ACTIVE_DESCRIPTOR)}];
	if (canReadHistory) {
		tabs.push({id: 'public', label: i18n._(ARCHIVED_DESCRIPTOR)});
	}
	if (canManageThreads) {
		tabs.push({id: 'private', label: i18n._(PRIVATE_DESCRIPTOR)});
	}
	tabs.push({id: 'joined_private', label: i18n._(MINE_DESCRIPTOR)});
	const openThread = (thread: ChannelResponse) => {
		const cached = cacheThread(thread);
		NavigationCommands.selectChannel(channel.guildId!, cached.id);
		ModalCommands.pop();
	};
	const oldestArchive = threads.at(-1)?.thread_metadata?.archive_timestamp ?? undefined;
	return (
		<Modal.Root size="small" centered data-flx="channel.threads-browser-modal.modal-root">
			<Modal.Header title={i18n._(THREADS_DESCRIPTOR)} data-flx="channel.threads-browser-modal.modal-header" />
			<Modal.Content contentClassName={styles.content} data-flx="channel.threads-browser-modal.modal-content">
				<div className={styles.tabs} data-flx="channel.threads-browser-modal.tabs">
					{tabs.map((entry) => (
						<button
							key={entry.id}
							type="button"
							className={entry.id === tab ? `${styles.tab} ${styles.tabSelected}` : styles.tab}
							onClick={() => {
								setThreads([]);
								setTab(entry.id);
							}}
							data-flx={`channel.threads-browser-modal.tab.${entry.id}`}
						>
							{entry.label}
						</button>
					))}
				</div>
				<div className={styles.list} data-flx="channel.threads-browser-modal.list">
					{threads.length === 0 ? (
						<div className={styles.empty} data-flx="channel.threads-browser-modal.empty">
							{loading ? '…' : i18n._(NO_THREADS_DESCRIPTOR)}
						</div>
					) : (
						threads.map((thread) => (
							<button
								key={thread.id}
								type="button"
								className={styles.row}
								onClick={() => openThread(thread)}
								data-flx="channel.threads-browser-modal.row"
							>
								<div className={styles.rowMain}>
									<span className={styles.rowName} data-flx="channel.threads-browser-modal.row-name">
										{thread.name ?? ''}
									</span>
									<span className={styles.rowMeta} data-flx="channel.threads-browser-modal.row-meta">
										{`${thread.message_count ?? 0} messages · ${thread.member_count ?? 1} members`}
									</span>
								</div>
							</button>
						))
					)}
				</div>
			</Modal.Content>
			<Modal.Footer data-flx="channel.threads-browser-modal.modal-footer">
				<Button onClick={ModalCommands.pop} variant="secondary" data-flx="channel.threads-browser-modal.button.pop">
					{i18n._(CLOSE_DESCRIPTOR)}
				</Button>
				{hasMore && oldestArchive && (
					<Button
						variant="secondary"
						onClick={() => void load(tab, oldestArchive)}
						submitting={loading}
						data-flx="channel.threads-browser-modal.button.load-more"
					>
						{i18n._(LOAD_MORE_DESCRIPTOR)}
					</Button>
				)}
				{canCreate && (
					<Button
						onClick={() =>
							ModalCommands.pushWithKey(
								modal(() => <ThreadCreateModal channel={channel} />),
								`create-thread-${channel.id}`,
							)
						}
						data-flx="channel.threads-browser-modal.button.new-thread"
					>
						{i18n._(NEW_THREAD_DESCRIPTOR)}
					</Button>
				)}
			</Modal.Footer>
		</Modal.Root>
	);
});
