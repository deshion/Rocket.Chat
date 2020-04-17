import {
	Badge,
	Box,
	Button,
	ButtonGroup,
	CheckBox,
	Icon,
	Margins,
	Table,
	Tag,
	Throbber,
} from '@rocket.chat/fuselage';
import React, { useEffect, useState, useMemo } from 'react';
import s from 'underscore.string';

import { Page } from '../../../../client/components/basic/Page';
import { useTranslation } from '../../../../client/contexts/TranslationContext';
import { useToastMessageDispatch } from '../../../../client/contexts/ToastMessagesContext';
import {
	ProgressStep,
	ImportWaitingStates,
	ImportFileReadyStates,
	ImportPreparingStartedStates,
	ImportingStartedStates,
	ImportingErrorStates,
} from '../../lib/ImporterProgressStep';
import { ImporterWebsocketReceiver } from '../ImporterWebsocketReceiver';
import { showImporterException } from '../functions/showImporterException';
import { useRoute } from '../../../../client/contexts/RouterContext';
import { useSafely } from '../../../../client/hooks/useSafely';
import { useEndpoint } from '../../../../client/contexts/ServerContext';

const waitFor = (fn, predicate) => new Promise((resolve, reject) => {
	const callPromise = () => {
		fn().then((result) => {
			if (predicate(result)) {
				resolve(result);
				return;
			}

			setTimeout(callPromise, 1000);
		}, reject);
	};

	callPromise();
});

function PrepareImportPage() {
	const t = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();

	const [isPreparing, setPreparing] = useSafely(useState(true));
	const [progressRate, setProgressRate] = useSafely(useState(null));
	const [status, setStatus] = useSafely(useState(null));
	const [messageCount, setMessageCount] = useSafely(useState(0));
	const [users, setUsers] = useSafely(useState([]));
	const [channels, setChannels] = useSafely(useState([]));
	const [isImporting, setImporting] = useSafely(useState(false));

	const usersCount = useMemo(() => users.filter(({ do_import }) => do_import).length, [users]);
	const channelsCount = useMemo(() => channels.filter(({ do_import }) => do_import).length, [channels]);

	const importHistoryRoute = useRoute('admin-import');
	const newImportRoute = useRoute('admin-import-new');
	const importProgressRoute = useRoute('admin-import-progress');

	const getImportFileData = useEndpoint('GET', 'getImportFileData');
	const getCurrentImportOperation = useEndpoint('GET', 'getCurrentImportOperation');
	const startImport = useEndpoint('POST', 'startImport');

	useEffect(() => {
		const handleProgressUpdated = ({ rate }) => {
			setProgressRate(rate);
		};

		ImporterWebsocketReceiver.registerCallback(handleProgressUpdated);

		return () => {
			ImporterWebsocketReceiver.unregisterCallback(handleProgressUpdated);
		};
	}, []);

	useEffect(() => {
		const loadImportFileData = async () => {
			try {
				const data = await waitFor(getImportFileData, (data) => data && !data.waiting);

				if (!data) {
					dispatchToastMessage({ type: 'error', message: t('Importer_not_setup') });
					importHistoryRoute.push();
					return;
				}

				if (data.step) {
					dispatchToastMessage({ type: 'error', message: t('Failed_To_Load_Import_Data') });
					importHistoryRoute.push();
					return;
				}

				setMessageCount(data.message_count);
				setUsers(data.users.map((user) => ({ ...user, do_import: true })));
				setChannels(data.channels.map((channel) => ({ ...channel, do_import: true })));
				setPreparing(false);
				setProgressRate(null);
			} catch (error) {
				showImporterException(error, 'Failed_To_Load_Import_Data');
				importHistoryRoute.push();
			}
		};

		const loadCurrentOperation = async () => {
			try {
				const { operation } = await waitFor(getCurrentImportOperation, ({ operation }) =>
					operation.valid && !ImportWaitingStates.includes(operation.status));

				if (!operation.valid) {
					newImportRoute.push();
					return;
				}

				if (ImportingStartedStates.includes(operation.status)) {
					importProgressRoute.push();
					return;
				}

				if (operation.status === ProgressStep.USER_SELECTION
					|| ImportPreparingStartedStates.includes(operation.status)
					|| ImportFileReadyStates.includes(operation.status)) {
					setStatus(operation.status);
					loadImportFileData();
					return;
				}

				if (ImportingErrorStates.includes(operation.status)) {
					dispatchToastMessage({ type: 'error', message: t('Import_Operation_Failed') });
					importHistoryRoute.push();
					return;
				}

				if (operation.status === ProgressStep.DONE) {
					importHistoryRoute.push();
					return;
				}

				dispatchToastMessage({ type: 'error', message: t('Unknown_Import_State') });
				importHistoryRoute.push();
			} catch (error) {
				dispatchToastMessage({ type: 'error', message: t('Failed_To_Load_Import_Data') });
				importHistoryRoute.push();
			}
		};

		loadCurrentOperation();
	}, []);

	const handleBackToImportsButtonClick = () => {
		importHistoryRoute.push();
	};

	const handleStartButtonClick = async () => {
		setImporting(true);

		try {
			await startImport({ input: { users, channels } });
			importProgressRoute.push();
		} catch (error) {
			showImporterException(error, 'Failed_To_Start_Import');
			importHistoryRoute.push();
		}
	};

	return <Page>
		<Page.Header title={t('Importing_Data')}>
			<ButtonGroup>
				<Button ghost onClick={handleBackToImportsButtonClick}>
					<Icon name='back' /> {t('Back_to_imports')}
				</Button>
				<Button primary disabled={isImporting} onClick={handleStartButtonClick}>
					{t('Importer_Prepare_Start_Import')}
				</Button>
			</ButtonGroup>
		</Page.Header>

		<Page.ContentShadowScroll>
			<Box marginInline='auto' marginBlock='neg-x24' width='full' maxWidth='x580'>
				<Margins block='x24'>
					{isPreparing && <>
						{progressRate
							? <Box display='flex' justifyContent='center' textStyle='p1' textColor='default'>
								<Box is='progress' value={(progressRate * 10).toFixed(0)} max='1000' marginInlineEnd='x24' />
								<Box is='span'>{s.numberFormat(progressRate, 0) }%</Box>
							</Box>
							: <Throbber justifyContent='center' />}
					</>}

					{!isPreparing && <>
						<Box is='h2' textStyle='p2' textColor='default'>{status && t(status.replace('importer_', 'importer_status_'))}</Box>

						<Box is='p' textStyle='p1' textColor='default'>{t('Messages')} <Badge is='span'>{messageCount}</Badge></Box>

						<Box is='p' textStyle='p1' textColor='default'>{t('Users')} <Badge is='span'>{usersCount}</Badge></Box>

						{users.length && <Table>
							<Table.Head>
								<Table.Row>
									<Table.Cell width='x36'>
										<CheckBox
											checked={usersCount > 0}
											indeterminate={usersCount > 0 && usersCount !== users.length}
											onChange={() => {
												setUsers((users) => {
													const hasCheckedDeletedUsers = users.some(({ is_deleted, do_import }) => is_deleted && do_import);
													const isChecking = usersCount === 0;

													if (isChecking) {
														return users.map((user) => ({ ...user, do_import: true }));
													}

													if (hasCheckedDeletedUsers) {
														return users.map((user) => (user.is_deleted ? { ...user, do_import: false } : user));
													}

													return users.map((user) => ({ ...user, do_import: false }));
												});
											}}
										/>
									</Table.Cell>
									<Table.Cell is='th'>{t('Username')}</Table.Cell>
									<Table.Cell is='th'>{t('Email')}</Table.Cell>
									<Table.Cell is='th'></Table.Cell>
								</Table.Row>
							</Table.Head>
							<Table.Body>
								{users.map((user) => <Table.Row key={user.user_id}>
									<Table.Cell width='x36'>
										<CheckBox
											checked={user.do_import}
											onChange={(event) => {
												const { checked } = event.currentTarget;
												setUsers((users) =>
													users.map((_user) => (_user === user ? { ..._user, do_import: checked } : _user)));
											}}
										/>
									</Table.Cell>
									<Table.Cell>{user.username}</Table.Cell>
									<Table.Cell>{user.email}</Table.Cell>
									<Table.Cell align='end'>{user.is_deleted && <Tag variant='danger'>{t('Deleted')}</Tag>}</Table.Cell>
								</Table.Row>)}
							</Table.Body>
						</Table>}

						<Box is='p' textStyle='p1' textColor='default'>{t('Channels')} <Badge is='span'>{channelsCount}</Badge></Box>

						{channels.length && <Table>
							<Table.Head>
								<Table.Row>
									<Table.Cell width='x36'>
										<CheckBox
											checked={channelsCount > 0}
											indeterminate={channelsCount > 0 && channelsCount !== channels.length}
											onChange={() => {
												setChannels((channels) => {
													const hasCheckedArchivedChannels = channels.some(({ is_archived, do_import }) => is_archived && do_import);
													const isChecking = channelsCount === 0;

													if (isChecking) {
														return channels.map((channel) => ({ ...channel, do_import: true }));
													}

													if (hasCheckedArchivedChannels) {
														return channels.map((channel) => (channel.is_deleted ? { ...channel, do_import: false } : channel));
													}

													return channels.map((channel) => ({ ...channel, do_import: false }));
												});
											}}
										/>
									</Table.Cell>
									<Table.Cell is='th'>{t('Name')}</Table.Cell>
									<Table.Cell is='th' align='end'></Table.Cell>
								</Table.Row>
							</Table.Head>
							<Table.Body>
								{channels.map((channel) => <Table.Row key={channel.channel_id}>
									<Table.Cell width='x36'>
										<CheckBox
											checked={channel.do_import}
											onChange={(event) => {
												const { checked } = event.currentTarget;
												setChannels((channels) =>
													channels.map((_channel) => (_channel === channel ? { ..._channel, do_import: checked } : _channel)));
											}}
										/>
									</Table.Cell>
									<Table.Cell>{channel.name}</Table.Cell>
									<Table.Cell align='end'>{channel.is_archived && <Tag variant='danger'>{t('Importer_Archived')}</Tag>}</Table.Cell>
								</Table.Row>)}
							</Table.Body>
						</Table>}
					</>}
				</Margins>
			</Box>
		</Page.ContentShadowScroll>
	</Page>;
}

export default PrepareImportPage;
