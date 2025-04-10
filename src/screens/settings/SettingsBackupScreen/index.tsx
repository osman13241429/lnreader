import React, { useState } from 'react';
import { ScreenContainer } from '@components/Common';
import { useTheme } from '@hooks/persisted';
import { Appbar, List } from '@components';
import { Portal } from 'react-native-paper';
import { useBoolean } from '@hooks';
import { BackupSettingsScreenProps } from '@navigators/types';
import GoogleDriveModal from './Components/GoogleDriveModal';
import SelfHostModal from './Components/SelfHostModal';
import {
  createBackup as deprecatedCreateBackup,
  restoreBackup as deprecatedRestoreBackup,
} from '@services/backup/legacy';
import { ScrollView } from 'react-native-gesture-handler';
import { getString } from '@strings/translations';
import { showToast } from '@utils/showToast';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system';
import { Alert, View, Modal as RNModal, Text, StyleSheet } from 'react-native';
import { Checkbox, Button, overlay } from 'react-native-paper';

// Import backup/restore functions
import {
  gatherBackupData,
  restoreFromBackupData,
} from '@services/backup/localBackup';

const BackupSettings = ({ navigation }: BackupSettingsScreenProps) => {
  const theme = useTheme();
  const {
    value: googleDriveModalVisible,
    setFalse: closeGoogleDriveModal,
    setTrue: openGoogleDriveModal,
  } = useBoolean();

  const {
    value: selfHostModalVisible,
    setFalse: closeSelfHostModal,
    setTrue: openSelfHostModal,
  } = useBoolean();

  const {
    value: optionsModalVisible,
    setTrue: openOptionsModal,
    setFalse: closeOptionsModal,
  } = useBoolean();

  const [backupOptions, setBackupOptions] = useState({
    includeLibrary: true,
    includeSettings: true,
    includeHistory: true,
    excludeApiKeys: true, // Default to NOT backing up API keys
  });

  const handleOptionChange = (option: keyof typeof backupOptions) => {
    setBackupOptions(prev => ({ ...prev, [option]: !prev[option] }));
  };

  const exportBackup = async () => {
    closeOptionsModal(); // Close modal before starting export
    try {
      showToast(getString('backupScreen.preparingBackup'));

      showToast(getString('backupScreen.gatheringData'));
      const backupData = await gatherBackupData(backupOptions);
      const backupJson = JSON.stringify(backupData, null, 2);

      showToast(getString('backupScreen.requestingPermission'));
      const permissions =
        await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) {
        showToast(getString('backupScreen.permissionDenied'));
        return;
      }

      showToast(getString('backupScreen.creatingFile'));
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `lnreader_backup_${timestamp}.json`;

      const uri = await StorageAccessFramework.createFileAsync(
        permissions.directoryUri,
        fileName,
        'application/json',
      );
      await FileSystem.writeAsStringAsync(uri, backupJson, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      showToast(getString('backupScreen.writingFileComplete'));

      showToast(getString('backupScreen.backupExported', { fileName }));
    } catch (error: any) {
      showToast(
        getString('backupScreen.backupExportError', {
          message: error.message,
        }),
      );
    }
  };

  const importBackup = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      showToast(getString('backupScreen.readingFile'));

      if (
        result.canceled === true ||
        !result.assets ||
        result.assets.length === 0
      ) {
        showToast(getString('backupScreen.importCancelled'));
        return;
      }

      const fileAsset = result.assets[0];
      const fileUri = fileAsset.uri;

      const backupJson = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      showToast(getString('backupScreen.parsingFile'));
      const backupData = JSON.parse(backupJson);

      let confirmationMessage = getString('backupScreen.confirmGenericImport');
      if (backupData.settings && backupData.novels) {
        confirmationMessage = getString('backupScreen.confirmImport');
      } else if (backupData.settings) {
        confirmationMessage = getString('backupScreen.confirmSettingsImport');
      }

      Alert.alert(
        getString('common.confirm'),
        confirmationMessage,
        [
          {
            text: getString('common.cancel'),
            style: 'cancel',
          },
          {
            text: getString('common.restore'),
            onPress: async () => {
              try {
                showToast(getString('backupScreen.restoringBackup'));
                await restoreFromBackupData(backupData);
                showToast(getString('backupScreen.restoreCompleted'));
              } catch (restoreError: any) {
                showToast(
                  getString('backupScreen.restoreError', {
                    message: restoreError.message,
                  }),
                );
              }
            },
          },
        ],
        { cancelable: true },
      );
    } catch (error: any) {
      if (error instanceof SyntaxError) {
        showToast(getString('backupScreen.invalidBackupFile'));
      } else {
        showToast(
          getString('backupScreen.importError', { message: error.message }),
        );
      }
    }
  };

  return (
    <>
      <ScreenContainer theme={theme}>
        <Appbar
          title={getString('common.backup')}
          handleGoBack={() => navigation.goBack()}
          theme={theme}
        />
        <ScrollView style={{ paddingBottom: 40 }}>
          <List.Section>
            <List.SubHeader theme={theme}>
              {getString('backupScreen.remoteBackup')}
            </List.SubHeader>
            <List.Item
              title={getString('backupScreen.selfHost')}
              description={getString('backupScreen.selfHostDesc')}
              theme={theme}
              onPress={openSelfHostModal}
            />

            <List.Item
              title={getString('backupScreen.googeDrive')}
              description={getString('backupScreen.googeDriveDesc')}
              theme={theme}
              onPress={openGoogleDriveModal}
            />
            <List.SubHeader theme={theme}>
              {getString('backupScreen.localBackup')}
            </List.SubHeader>
            <List.Item
              title={getString('backupScreen.exportBackup')}
              description={getString('backupScreen.exportBackupDesc')}
              onPress={openOptionsModal}
              theme={theme}
            />
            <List.Item
              title={getString('backupScreen.importBackup')}
              description={getString('backupScreen.importBackupDesc')}
              onPress={importBackup}
              theme={theme}
            />
            <List.SubHeader theme={theme}>
              {getString('backupScreen.legacyBackup')}
            </List.SubHeader>
            <List.Item
              title={`${getString('backupScreen.createBackup')} (${getString(
                'common.deprecated',
              )})`}
              description={getString('backupScreen.createBackupDesc')}
              onPress={deprecatedCreateBackup}
              theme={theme}
            />
            <List.Item
              title={`${getString('backupScreen.restoreBackup')} (${getString(
                'common.deprecated',
              )})`}
              description={getString('backupScreen.restoreBackupDesc')}
              onPress={() => deprecatedRestoreBackup()}
              theme={theme}
            />
            <List.InfoItem
              title={getString('backupScreen.restoreLargeBackupsWarning')}
              icon="information-outline"
              theme={theme}
            />
            <List.InfoItem
              title={getString('backupScreen.createBackupWarning')}
              icon="information-outline"
              theme={theme}
            />
          </List.Section>
        </ScrollView>
      </ScreenContainer>
      <Portal>
        <GoogleDriveModal
          visible={googleDriveModalVisible}
          theme={theme}
          closeModal={closeGoogleDriveModal}
        />
        <SelfHostModal
          theme={theme}
          visible={selfHostModalVisible}
          closeModal={closeSelfHostModal}
        />
        <RNModal
          visible={optionsModalVisible}
          onDismiss={closeOptionsModal}
          transparent={true}
          animationType="fade"
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContainer,
                { backgroundColor: overlay(2, theme.surface) },
              ]}
            >
              <Text style={[styles.modalTitle, { color: theme.onSurface }]}>
                {getString('backupScreen.backupOptions')}
              </Text>

              <Checkbox.Item
                label={getString('backupScreen.optLibrary')}
                status={backupOptions.includeLibrary ? 'checked' : 'unchecked'}
                onPress={() => handleOptionChange('includeLibrary')}
                labelStyle={{ color: theme.onSurface }}
                theme={theme}
              />
              <Checkbox.Item
                label={getString('backupScreen.optSettings')}
                status={backupOptions.includeSettings ? 'checked' : 'unchecked'}
                onPress={() => handleOptionChange('includeSettings')}
                labelStyle={{ color: theme.onSurface }}
                theme={theme}
              />
              <Checkbox.Item
                disabled={!backupOptions.includeSettings}
                label={getString('backupScreen.optApiKeys')}
                status={!backupOptions.excludeApiKeys ? 'checked' : 'unchecked'}
                onPress={() => handleOptionChange('excludeApiKeys')}
                labelStyle={{
                  color: !backupOptions.includeSettings
                    ? theme.onSurfaceDisabled
                    : theme.onSurface,
                }}
                theme={theme}
              />
              <Checkbox.Item
                label={getString('backupScreen.optHistory')}
                status={backupOptions.includeHistory ? 'checked' : 'unchecked'}
                onPress={() => handleOptionChange('includeHistory')}
                labelStyle={{ color: theme.onSurface }}
                theme={theme}
              />

              <View style={styles.modalActions}>
                <Button onPress={closeOptionsModal}>
                  {getString('common.cancel')}
                </Button>
                <Button onPress={exportBackup}>
                  {getString('backupScreen.exportSelected')}
                </Button>
              </View>
            </View>
          </View>
        </RNModal>
      </Portal>
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    margin: 30,
    paddingHorizontal: 24,
    paddingVertical: 32,
    borderRadius: 28,
    width: '80%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 24,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 24,
  },
});

export default BackupSettings;
