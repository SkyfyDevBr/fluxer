// SPDX-License-Identifier: AGPL-3.0-or-later

import {ChannelTypes} from '@fluxer/constants/src/ChannelConstants';
import type {Channel as WireChannel} from '@fluxer/schema/src/domains/channel/ChannelSchemas';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/app/state/RuntimeConfig', () => ({default: {localInstanceDomain: 'fluxer.test'}}));
vi.mock('@app/features/theme/fonts/ScriptFontLoader', () => ({noteText: () => {}}));
vi.mock('@app/features/user/state/Users', () => ({
	default: {cacheUsers: () => {}, getUser: () => undefined},
}));
vi.mock('@app/features/user/state/UserPinnedDM', () => ({default: {pinnedDMs: []}}));

const {Channel} = await import('@app/features/channel/models/Channel');

function threadWireChannel(overrides: Partial<WireChannel> = {}): WireChannel {
	return {
		id: '1500000000000000001',
		guild_id: '1400000000000000000',
		type: ChannelTypes.GUILD_PUBLIC_THREAD,
		name: 'Release notes',
		parent_id: '1450000000000000000',
		owner_id: '1410000000000000000',
		thread_metadata: {
			archived: false,
			auto_archive_duration: 1440,
			archive_timestamp: '2026-01-01T00:00:00.000Z',
			locked: false,
			invitable: true,
			create_timestamp: '2025-12-31T23:59:00.000Z',
		},
		member_count: 3,
		message_count: 12,
		total_message_sent: 15,
		...overrides,
	} as WireChannel;
}

describe('Channel thread model', () => {
	it('classifies thread channel types', () => {
		const publicThread = new Channel(threadWireChannel());
		expect(publicThread.isThread()).toBe(true);
		expect(publicThread.isPublicThread()).toBe(true);
		expect(publicThread.isPrivateThread()).toBe(false);
		expect(publicThread.isArchivedThread()).toBe(false);
		expect(publicThread.isLockedThread()).toBe(false);

		const privateThread = new Channel(threadWireChannel({type: ChannelTypes.GUILD_PRIVATE_THREAD}));
		expect(privateThread.isThread()).toBe(true);
		expect(privateThread.isPrivateThread()).toBe(true);
		expect(privateThread.isPublicThread()).toBe(false);

		const announcementThread = new Channel(threadWireChannel({type: ChannelTypes.GUILD_ANNOUNCEMENT_THREAD}));
		expect(announcementThread.isPublicThread()).toBe(true);

		const textChannel = new Channel(threadWireChannel({type: ChannelTypes.GUILD_TEXT, thread_metadata: null}));
		expect(textChannel.isThread()).toBe(false);
		expect(textChannel.isMessageable()).toBe(true);
	});

	it('exposes thread metadata and counters', () => {
		const thread = new Channel(threadWireChannel());
		expect(thread.threadMetadata?.auto_archive_duration).toBe(1440);
		expect(thread.memberCount).toBe(3);
		expect(thread.messageCount).toBe(12);
		expect(thread.totalMessageSent).toBe(15);
		expect(thread.parentId).toBe('1450000000000000000');
		expect(thread.ownerId).toBe('1410000000000000000');
	});

	it('preserves thread metadata through withUpdates and detects archive changes', () => {
		const thread = new Channel(threadWireChannel());
		const updated = thread.withUpdates({
			thread_metadata: {
				...thread.threadMetadata!,
				archived: true,
				locked: true,
				archive_timestamp: '2026-02-01T00:00:00.000Z',
			},
			member_count: 5,
		});
		expect(updated.isArchivedThread()).toBe(true);
		expect(updated.isLockedThread()).toBe(true);
		expect(updated.memberCount).toBe(5);
		expect(updated.messageCount).toBe(12);
		expect(updated.equals(thread)).toBe(false);
		const roundTripped = new Channel(updated.toJSON());
		expect(roundTripped.threadMetadata?.archived).toBe(true);
		expect(roundTripped.threadMetadata?.locked).toBe(true);
		expect(roundTripped.memberCount).toBe(5);
	});
});
