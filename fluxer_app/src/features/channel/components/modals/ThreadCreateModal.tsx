// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {useFormSubmit} from '@app/features/app/hooks/useFormSubmit';
import {createThread, createThreadFromMessage} from '@app/features/channel/commands/ThreadCommands';
import type {Channel} from '@app/features/channel/models/Channel';
import {CANCEL_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import type {Message} from '@app/features/messaging/models/MessagingMessage';
import Permission from '@app/features/permissions/state/Permission';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Form} from '@app/features/ui/components/form/Form';
import {Input} from '@app/features/ui/components/form/FormInput';
import {RadioGroup} from '@app/features/ui/radio_group/RadioGroup';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {observer} from 'mobx-react-lite';
import {useState} from 'react';
import {Controller, useForm} from 'react-hook-form';

const CREATE_THREAD_DESCRIPTOR = msg({
	message: 'Create thread',
	comment: 'Title of the modal that creates a thread, and label of its submit button.',
});
const THREAD_NAME_DESCRIPTOR = msg({
	message: 'Thread name',
	comment: 'Short label for the thread name field in the create thread modal.',
});
const THREAD_VISIBILITY_DESCRIPTOR = msg({
	message: 'Thread visibility',
	comment: 'Label above the public/private choice in the create thread modal.',
});
const PUBLIC_THREAD_DESCRIPTOR = msg({
	message: 'Public',
	comment: 'Thread visibility option that grants access to everyone who can view the parent channel.',
});
const PRIVATE_THREAD_DESCRIPTOR = msg({
	message: 'Private',
	comment: 'Thread visibility option that only invites selected members.',
});

interface ThreadCreateFormInputs {
	name: string;
	type: string;
}

export const ThreadCreateModal = observer(({channel, message}: {channel: Channel; message?: Message}) => {
	const {i18n} = useLingui();
	const [submitError, setSubmitError] = useState<string | null>(null);
	const form = useForm<ThreadCreateFormInputs>({
		defaultValues: {
			name: '',
			type: String(ChannelTypes.GUILD_PUBLIC_THREAD),
		},
	});
	const onSubmit = async (data: ThreadCreateFormInputs) => {
		setSubmitError(null);
		try {
			if (message) {
				await createThreadFromMessage(channel.id, message.id, {name: data.name.trim()});
			} else {
				await createThread(channel.id, {
					name: data.name.trim(),
					type:
						Number(data.type) === ChannelTypes.GUILD_PRIVATE_THREAD
							? ChannelTypes.GUILD_PRIVATE_THREAD
							: ChannelTypes.GUILD_PUBLIC_THREAD,
				});
			}
			ModalCommands.pop();
		} catch (error) {
			setSubmitError(error instanceof Error ? error.message : String(error));
		}
	};
	const {handleSubmit} = useFormSubmit({form, onSubmit, defaultErrorField: 'name'});
	const canCreatePrivate = Permission.can(Permissions.CREATE_PRIVATE_THREADS, channel);
	const visibilityOptions = canCreatePrivate
		? [
				{value: ChannelTypes.GUILD_PUBLIC_THREAD, name: i18n._(PUBLIC_THREAD_DESCRIPTOR)},
				{value: ChannelTypes.GUILD_PRIVATE_THREAD, name: i18n._(PRIVATE_THREAD_DESCRIPTOR)},
			]
		: [{value: ChannelTypes.GUILD_PUBLIC_THREAD, name: i18n._(PUBLIC_THREAD_DESCRIPTOR)}];
	return (
		<Modal.Root size="small" centered data-flx="channel.thread-create-modal.modal-root">
			<Form form={form} onSubmit={handleSubmit} data-flx="channel.thread-create-modal.form.submit">
				<Modal.Header title={i18n._(CREATE_THREAD_DESCRIPTOR)} data-flx="channel.thread-create-modal.modal-header" />
				<Modal.Content data-flx="channel.thread-create-modal.modal-content">
					<Input
						{...form.register('name', {required: true})}
						autoComplete="off"
						autoFocus={true}
						error={form.formState.errors.name?.message ?? submitError ?? undefined}
						label={i18n._(THREAD_NAME_DESCRIPTOR)}
						maxLength={100}
						minLength={1}
						required={true}
						data-flx="channel.thread-create-modal.input"
					/>
					{!message && (
						<Controller
							name="type"
							control={form.control}
							render={({field}) => (
								<RadioGroup
									aria-label={i18n._(THREAD_VISIBILITY_DESCRIPTOR)}
									value={Number(field.value)}
									onChange={(value) => field.onChange(String(value))}
									options={visibilityOptions}
									data-flx="channel.thread-create-modal.radio-group.change"
								/>
							)}
							data-flx="channel.thread-create-modal.controller"
						/>
					)}
				</Modal.Content>
				<Modal.Footer data-flx="channel.thread-create-modal.modal-footer">
					<Button onClick={ModalCommands.pop} variant="secondary" data-flx="channel.thread-create-modal.button.pop">
						{i18n._(CANCEL_DESCRIPTOR)}
					</Button>
					<Button
						type="submit"
						submitting={form.formState.isSubmitting}
						data-flx="channel.thread-create-modal.button.submit"
					>
						{i18n._(CREATE_THREAD_DESCRIPTOR)}
					</Button>
				</Modal.Footer>
			</Form>
		</Modal.Root>
	);
});
