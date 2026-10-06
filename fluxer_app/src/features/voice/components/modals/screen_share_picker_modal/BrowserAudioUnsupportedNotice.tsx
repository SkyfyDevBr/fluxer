// SPDX-License-Identifier: AGPL-3.0-or-later

import {DESKTOP_DOWNLOAD_URL, PRODUCT_NAME} from '@app/features/app/config/I18nDisplayConstants';
import {Button} from '@app/features/ui/button/Button';
import {openExternalUrl} from '@app/features/ui/utils/NativeUtils';
import styles from '@app/features/voice/components/modals/ScreenSharePickerModal.module.css';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import type React from 'react';

const BROWSER_SCREEN_AUDIO_UNSUPPORTED_TITLE_DESCRIPTOR = msg({
	message: "Screen audio isn't available in this browser.",
	comment:
		'Inline notice in the web screen-share picker when the browser cannot capture screen audio, such as Firefox on any platform.',
});
const BROWSER_SCREEN_AUDIO_UNSUPPORTED_BODY_DESCRIPTOR = msg({
	message:
		'Firefox cannot capture your screen audio. Use the {productName} desktop app to share your screen with sound.',
	comment: 'Inline notice body explaining why screen audio is unavailable in Firefox and pointing at the desktop app.',
});
const GET_THE_DESKTOP_APP_DESCRIPTOR = msg({
	message: 'Get the desktop app',
	comment: 'CTA button label in the screen-share picker. Opens the desktop download page.',
});

export const BrowserAudioUnsupportedNotice: React.FC = () => {
	const {i18n} = useLingui();
	return (
		<div className={styles.osNotice} role="status" data-flx="voice.screen-share-picker-modal.browser-audio-notice">
			<strong data-flx="voice.screen-share-picker-modal.browser-audio-notice.title">
				{i18n._(BROWSER_SCREEN_AUDIO_UNSUPPORTED_TITLE_DESCRIPTOR)}
			</strong>{' '}
			{i18n._(BROWSER_SCREEN_AUDIO_UNSUPPORTED_BODY_DESCRIPTOR, {productName: PRODUCT_NAME})}
			<div className={styles.noticeActions} data-flx="voice.screen-share-picker-modal.browser-audio-notice.actions">
				<Button
					variant="secondary"
					onClick={() => void openExternalUrl(DESKTOP_DOWNLOAD_URL)}
					data-flx="voice.screen-share-picker-modal.browser-audio-notice.button"
				>
					{i18n._(GET_THE_DESKTOP_APP_DESCRIPTOR)}
				</Button>
			</div>
		</div>
	);
};
