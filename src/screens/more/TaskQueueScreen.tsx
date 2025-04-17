import React, { useEffect, useState, useCallback } from 'react';
import {
  FlatList,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  FAB,
  ProgressBar,
  Appbar as MaterialAppbar,
  Menu,
  overlay,
  Checkbox,
  IconButton,
  Switch,
} from 'react-native-paper';

import { useTheme } from '@hooks/persisted';

import { showToast } from '../../utils/showToast';
import { getString } from '@strings/translations';
import { Appbar, EmptyView } from '@components';
import { TaskQueueScreenProps } from '@navigators/types';
import ServiceManager, { QueuedBackgroundTask } from '@services/ServiceManager';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMMKVObject } from 'react-native-mmkv';

const ParallelProcessingWarnings = {
  downloads:
    'WARNING: Parallel downloads may cause the source website to block your IP address due to ' +
    'excessive requests. Use with caution, especially with large numbers of chapters.',
  translations:
    'WARNING: Parallel translations may trigger API rate limits, leading to failed requests or ' +
    'extra charges. Translation APIs typically have strict rate limiting.',
};

const DownloadQueue = ({ navigation }: TaskQueueScreenProps) => {
  const theme = useTheme();
  const { bottom } = useSafeAreaInsets();
  const [tasks, setTasks] = useState<QueuedBackgroundTask[]>([]);
  const [taskQueueMMKV] = useMMKVObject<QueuedBackgroundTask[]>(
    ServiceManager.manager.STORE_KEY,
  );
  const [isRunning, setIsRunning] = useState(ServiceManager.manager.isRunning);
  const [visible, setVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(),
  );
  const [parallelDownloads, setParallelDownloads] = useState(
    ServiceManager.manager.isParallelDownloadsEnabled,
  );
  const [parallelTranslations, setParallelTranslations] = useState(
    ServiceManager.manager.isParallelTranslationsEnabled,
  );

  const openMenu = () => setVisible(true);
  const closeMenu = () => setVisible(false);

  useEffect(() => {
    setTasks(taskQueueMMKV || []);
    if ((taskQueueMMKV || []).length === 0) {
      setIsRunning(false);
      setSelectionMode(false);
      setSelectedIndices(new Set());
    }
  }, [taskQueueMMKV]);

  const toggleParallelDownloads = useCallback(() => {
    const newValue = !parallelDownloads;

    if (newValue) {
      // Show warning when enabling
      Alert.alert(
        'Enable Parallel Downloads',
        ParallelProcessingWarnings.downloads,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Enable Anyway',
            onPress: () => {
              ServiceManager.manager.toggleParallelDownloads();
              setParallelDownloads(true);
              showToast('Parallel downloads enabled');
            },
            style: 'destructive',
          },
        ],
      );
    } else {
      // Just disable without warning
      ServiceManager.manager.toggleParallelDownloads();
      setParallelDownloads(false);
      showToast('Parallel downloads disabled');
    }
  }, [parallelDownloads]);

  const toggleParallelTranslations = useCallback(() => {
    const newValue = !parallelTranslations;

    if (newValue) {
      // Show warning when enabling
      Alert.alert(
        'Enable Parallel Translations',
        ParallelProcessingWarnings.translations,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Enable Anyway',
            onPress: () => {
              ServiceManager.manager.toggleParallelTranslations();
              setParallelTranslations(true);
              showToast('Parallel translations enabled');
            },
            style: 'destructive',
          },
        ],
      );
    } else {
      // Just disable without warning
      ServiceManager.manager.toggleParallelTranslations();
      setParallelTranslations(false);
      showToast('Parallel translations disabled');
    }
  }, [parallelTranslations]);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => !prev);
    setSelectedIndices(new Set());
  }, []);

  const toggleItemSelection = useCallback((index: number) => {
    setSelectedIndices(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(index)) {
        newSelection.delete(index);
      } else {
        newSelection.add(index);
      }
      return newSelection;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIndices(new Set(tasks.map((_, index) => index)));
  }, [tasks]);

  const selectNone = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const cancelSingleTask = useCallback((index: number) => {
    ServiceManager.manager.removeTaskAtIndex(index);
    showToast('Task cancelled');
  }, []);

  const cancelSelectedTasks = useCallback(() => {
    const indicesToDelete = Array.from(selectedIndices);
    if (indicesToDelete.length > 0) {
      ServiceManager.manager.removeTasksAtIndexes(indicesToDelete);
      showToast(`${indicesToDelete.length} tasks cancelled`);
      setSelectionMode(false);
      setSelectedIndices(new Set());
    }
  }, [selectedIndices]);

  const renderItem = ({
    item,
    index,
  }: {
    item: QueuedBackgroundTask;
    index: number;
  }) => (
    <TouchableOpacity
      onPress={() => selectionMode && toggleItemSelection(index)}
      style={[
        styles.taskItem,
        selectedIndices.has(index) && styles.selectedItem,
      ]}
    >
      {selectionMode && (
        <Checkbox
          status={selectedIndices.has(index) ? 'checked' : 'unchecked'}
          onPress={() => toggleItemSelection(index)}
        />
      )}
      <View style={styles.taskDetails}>
        <Text style={{ color: theme.onSurface }}>{item.meta.name}</Text>
        {item.meta.progressText ? (
          <Text style={{ color: theme.onSurfaceVariant, fontSize: 12 }}>
            {item.meta.progressText}
          </Text>
        ) : null}
        {item.meta.error ? (
          <Text style={{ color: theme.error, fontSize: 12, marginTop: 8 }}>
            Error: {item.meta.error}
          </Text>
        ) : item.meta.isRunning ? (
          <ProgressBar
            indeterminate={item.meta.progress === undefined}
            progress={item.meta.progress}
            color={theme.primary}
            style={{ marginTop: 8, backgroundColor: theme.surface2 }}
          />
        ) : (
          <View style={styles.placeholderProgressBar} />
        )}
      </View>
      {!selectionMode && (
        <IconButton
          icon="close-circle-outline"
          iconColor={theme.outline}
          size={20}
          onPress={() => cancelSingleTask(index)}
          style={styles.cancelButton}
        />
      )}
    </TouchableOpacity>
  );

  return (
    <>
      <Appbar
        title={
          selectionMode ? `${selectedIndices.size} selected` : 'Task Queue'
        }
        handleGoBack={selectionMode ? toggleSelectionMode : navigation.goBack}
        theme={theme}
      >
        {selectionMode ? (
          <>
            <MaterialAppbar.Action
              icon="select-all"
              iconColor={theme.onSurface}
              onPress={selectAll}
            />
            <MaterialAppbar.Action
              icon="select-off"
              iconColor={theme.onSurface}
              onPress={selectNone}
            />
            <MaterialAppbar.Action
              icon="delete-outline"
              iconColor={theme.onSurface}
              onPress={cancelSelectedTasks}
              disabled={selectedIndices.size === 0}
            />
          </>
        ) : (
          <>
            <Menu
              visible={visible}
              onDismiss={closeMenu}
              anchor={
                <MaterialAppbar.Action
                  icon="dots-vertical"
                  iconColor={theme.onSurface}
                  onPress={openMenu}
                />
              }
              contentStyle={{
                backgroundColor: overlay(2, theme.surface),
                minWidth: 250,
              }}
            >
              <View style={styles.menuHeader}>
                <Text style={{ color: theme.onSurface, fontWeight: 'bold' }}>
                  Parallel Processing
                </Text>
              </View>

              <Menu.Item
                title="Downloads"
                leadingIcon="download"
                titleStyle={{ color: theme.onSurface }}
                trailingIcon={() => (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <IconButton
                      icon="information-outline"
                      iconColor={theme.onSurfaceVariant}
                      size={18}
                      style={{ margin: 0 }}
                      onPress={() => {
                        closeMenu();
                        Alert.alert(
                          'Parallel Downloads',
                          ParallelProcessingWarnings.downloads,
                        );
                      }}
                    />
                    <Switch
                      value={parallelDownloads}
                      onValueChange={() => {
                        closeMenu();
                        toggleParallelDownloads();
                      }}
                      color={theme.primary}
                    />
                  </View>
                )}
              />

              <Menu.Item
                title="Translations"
                leadingIcon="translate"
                titleStyle={{ color: theme.onSurface }}
                trailingIcon={() => (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <IconButton
                      icon="information-outline"
                      iconColor={theme.onSurfaceVariant}
                      size={18}
                      style={{ margin: 0 }}
                      onPress={() => {
                        closeMenu();
                        Alert.alert(
                          'Parallel Translations',
                          ParallelProcessingWarnings.translations,
                        );
                      }}
                    />
                    <Switch
                      value={parallelTranslations}
                      onValueChange={() => {
                        closeMenu();
                        toggleParallelTranslations();
                      }}
                      color={theme.primary}
                    />
                  </View>
                )}
              />

              {tasks.length > 0 && (
                <>
                  <View style={styles.divider} />
                  <Menu.Item
                    onPress={() => {
                      ServiceManager.manager.stop();
                      setIsRunning(false);
                      showToast('All tasks cancelled');
                      closeMenu();
                    }}
                    title={'Cancel All Tasks'}
                    titleStyle={{ color: theme.onSurface }}
                    leadingIcon="cancel"
                  />
                </>
              )}
            </Menu>

            <MaterialAppbar.Action
              icon="checkbox-marked-circle-outline"
              iconColor={theme.onSurface}
              onPress={toggleSelectionMode}
              disabled={tasks.length === 0}
            />
          </>
        )}
      </Appbar>
      <FlatList
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 100 }}
        keyExtractor={(item, index) => 'task_' + index + item.task.name}
        data={tasks}
        renderItem={renderItem}
        extraData={selectedIndices}
        ListEmptyComponent={
          <EmptyView
            icon="(･o･;)"
            description={'No running tasks'}
            theme={theme}
          />
        }
      />
      {!selectionMode && tasks.length > 0 ? (
        <FAB
          style={[styles.fab, { backgroundColor: theme.primary, bottom }]}
          color={theme.onPrimary}
          label={
            isRunning ? getString('common.pause') : getString('common.resume')
          }
          uppercase={false}
          icon={isRunning ? 'pause' : 'play'}
          onPress={() => {
            if (isRunning) {
              ServiceManager.manager.pause();
              setIsRunning(false);
            } else {
              ServiceManager.manager.resume();
              setIsRunning(true);
            }
          }}
        />
      ) : null}
    </>
  );
};

export default DownloadQueue;

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    margin: 16,
    right: 0,
    bottom: 16,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  selectedItem: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  taskDetails: {
    flex: 1,
    marginLeft: 8,
  },
  cancelButton: {
    marginLeft: 8,
  },
  placeholderProgressBar: {
    height: 4,
    marginTop: 8,
    backgroundColor: 'transparent',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  menuHeader: {
    padding: 12,
    paddingBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    marginVertical: 4,
  },
});
