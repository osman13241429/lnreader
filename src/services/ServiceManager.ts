import BackgroundService from 'react-native-background-actions';
import * as Notifications from 'expo-notifications';

import { getMMKVObject, setMMKVObject } from '@utils/mmkv/mmkv';
import { importEpub } from './epub/import';
import { getString } from '@strings/translations';
import { updateLibrary } from './updates';
import { DriveFile } from '@api/drive/types';
import { createDriveBackup, driveRestore } from './backup/drive';
import {
  createSelfHostBackup,
  SelfHostData,
  selfHostRestore,
} from './backup/selfhost';
import { migrateNovel, MigrateNovelData } from './migrate/migrateNovel';
import { downloadChapter } from './download/downloadChapter';
import {
  translateChapterTask,
  translateNovelMetaTask,
} from './translation/TranslationService';
import { sleep } from '@utils/sleep';

// Define constants for default parallel limits
const MAX_PARALLEL_DOWNLOADS_DEFAULT = 3;
const MAX_PARALLEL_TRANSLATIONS_DEFAULT = 3;
const MAX_PARALLEL_OTHER_DEFAULT = 1;

export type BackgroundTask =
  | {
      name: 'IMPORT_EPUB';
      data: {
        filename: string;
        uri: string;
      };
    }
  | {
      name: 'UPDATE_LIBRARY';
      data?: {
        categoryId?: number;
        categoryName?: string;
      };
    }
  | { name: 'DRIVE_BACKUP'; data: DriveFile }
  | { name: 'DRIVE_RESTORE'; data: DriveFile }
  | { name: 'SELF_HOST_BACKUP'; data: SelfHostData }
  | { name: 'SELF_HOST_RESTORE'; data: SelfHostData }
  | { name: 'MIGRATE_NOVEL'; data: MigrateNovelData }
  | DownloadChapterTask
  | TranslateChapterTask
  | TranslateNovelMetaTask;
export type DownloadChapterTask = {
  name: 'DOWNLOAD_CHAPTER';
  data: {
    chapterId: number;
    novelId: number;
    novelName: string;
    chapterName: string;
    pluginId: string;
  };
};

export type TranslateChapterTask = {
  name: 'TRANSLATE_CHAPTER';
  data: {
    chapterId: number;
    novelId: number;
    pluginId: string;
    novelName: string;
    chapterName: string;
    apiKey: string;
    model: string;
    instruction: string;
  };
};

export type TranslateNovelMetaTask = {
  name: 'TRANSLATE_NOVEL_META';
  data: {
    novelId: number;
    novelName: string;
    apiKey: string;
    model: string;
    instruction: string;
  };
};

export type BackgroundTaskMetadata = {
  name: string;
  isRunning: boolean;
  progress: number | undefined;
  progressText: string | undefined;
  error?: string | null;
};

export type QueuedBackgroundTask = {
  task: BackgroundTask;
  meta: BackgroundTaskMetadata;
};

export default class ServiceManager {
  STORE_KEY = 'APP_SERVICE';
  PARALLEL_PROCESSING_KEY = 'APP_SERVICE_PARALLEL_PROCESSING';
  PARALLEL_DOWNLOADS_KEY = 'APP_SERVICE_PARALLEL_DOWNLOADS';
  PARALLEL_TRANSLATIONS_KEY = 'APP_SERVICE_PARALLEL_TRANSLATIONS';
  private static instance?: ServiceManager;
  private parallelProcessingEnabled: boolean = false;
  private parallelDownloadsEnabled: boolean = false;
  private parallelTranslationsEnabled: boolean = false;

  private constructor() {
    // Initialize parallel processing settings from storage
    this.parallelProcessingEnabled =
      getMMKVObject<boolean>(this.PARALLEL_PROCESSING_KEY) ?? false;
    this.parallelDownloadsEnabled =
      getMMKVObject<boolean>(this.PARALLEL_DOWNLOADS_KEY) ?? false;
    this.parallelTranslationsEnabled =
      getMMKVObject<boolean>(this.PARALLEL_TRANSLATIONS_KEY) ?? false;
  }

  static get manager() {
    if (!this.instance) {
      this.instance = new ServiceManager();
    }
    return this.instance;
  }

  get isParallelProcessingEnabled() {
    return this.parallelProcessingEnabled;
  }

  get isParallelDownloadsEnabled() {
    return this.parallelDownloadsEnabled;
  }

  get isParallelTranslationsEnabled() {
    return this.parallelTranslationsEnabled;
  }

  toggleParallelProcessing() {
    this.parallelProcessingEnabled = !this.parallelProcessingEnabled;
    setMMKVObject(this.PARALLEL_PROCESSING_KEY, this.parallelProcessingEnabled);

    // For backward compatibility, also toggle both specific settings
    this.setParallelDownloads(this.parallelProcessingEnabled);
    this.setParallelTranslations(this.parallelProcessingEnabled);

    return this.parallelProcessingEnabled;
  }

  toggleParallelDownloads() {
    this.parallelDownloadsEnabled = !this.parallelDownloadsEnabled;
    setMMKVObject(this.PARALLEL_DOWNLOADS_KEY, this.parallelDownloadsEnabled);

    // Update the general setting based on individual settings
    this.updateGeneralParallelSetting();

    return this.parallelDownloadsEnabled;
  }

  toggleParallelTranslations() {
    this.parallelTranslationsEnabled = !this.parallelTranslationsEnabled;
    setMMKVObject(
      this.PARALLEL_TRANSLATIONS_KEY,
      this.parallelTranslationsEnabled,
    );

    // Update the general setting based on individual settings
    this.updateGeneralParallelSetting();

    return this.parallelTranslationsEnabled;
  }

  setParallelDownloads(enabled: boolean) {
    this.parallelDownloadsEnabled = enabled;
    setMMKVObject(this.PARALLEL_DOWNLOADS_KEY, this.parallelDownloadsEnabled);

    // Update the general setting
    this.updateGeneralParallelSetting();
  }

  setParallelTranslations(enabled: boolean) {
    this.parallelTranslationsEnabled = enabled;
    setMMKVObject(
      this.PARALLEL_TRANSLATIONS_KEY,
      this.parallelTranslationsEnabled,
    );

    // Update the general setting
    this.updateGeneralParallelSetting();
  }

  private updateGeneralParallelSetting() {
    // The general setting is true if either specific setting is true
    this.parallelProcessingEnabled =
      this.parallelDownloadsEnabled || this.parallelTranslationsEnabled;
    setMMKVObject(this.PARALLEL_PROCESSING_KEY, this.parallelProcessingEnabled);
  }

  setParallelProcessing(enabled: boolean) {
    this.parallelProcessingEnabled = enabled;
    setMMKVObject(this.PARALLEL_PROCESSING_KEY, this.parallelProcessingEnabled);

    // For backward compatibility, also set both specific settings
    this.setParallelDownloads(enabled);
    this.setParallelTranslations(enabled);
  }

  get isRunning() {
    return BackgroundService.isRunning();
  }
  isMultiplicableTask(task: BackgroundTask) {
    return (
      [
        'DOWNLOAD_CHAPTER',
        'IMPORT_EPUB',
        'MIGRATE_NOVEL',
        'TRANSLATE_CHAPTER',
        'TRANSLATE_NOVEL_META',
      ] as Array<BackgroundTask['name']>
    ).includes(task.name);
  }
  start() {
    if (!this.isRunning) {
      BackgroundService.start(ServiceManager.lauch, {
        taskName: 'app_services',
        taskTitle: 'App Service',
        taskDesc: getString('common.preparing'),
        taskIcon: { name: 'notification_icon', type: 'drawable' },
        color: '#00adb5',
        linkingURI: 'lnreader://',
      }).catch(error => {
        Notifications.scheduleNotificationAsync({
          content: {
            title: getString('backupScreen.drive.backupInterruped'),
            body: error.message,
          },
          trigger: null,
        });
        BackgroundService.stop();
      });
    }
  }

  setMeta(
    transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
  ) {
    let taskList = [...this.getTaskList()];
    if (!taskList[0]) {
      return;
    } // Guard against empty list

    const currentTask = taskList[0];
    const newMeta = transformer(currentTask.meta);

    // Only update if meta actually changed to avoid unnecessary writes
    if (JSON.stringify(currentTask.meta) !== JSON.stringify(newMeta)) {
      taskList[0] = {
        ...currentTask,
        meta: newMeta,
      };

      // Update notification only if the task is running
      if (newMeta.isRunning) {
        BackgroundService.updateNotification({
          taskTitle: newMeta.name,
          taskDesc: newMeta.progressText ?? '',
          progressBar: {
            indeterminate: newMeta.progress === undefined,
            value: (newMeta.progress || 0) * 100,
            max: 100,
          },
        });
      }

      setMMKVObject(this.STORE_KEY, taskList);
    }
  }

  private _executeImportEpub(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return importEpub(data, setMeta);
  }

  private _executeUpdateLibrary(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return updateLibrary(data || {}, setMeta);
  }

  private _executeDriveBackup(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return createDriveBackup(data, setMeta);
  }

  private _executeDriveRestore(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return driveRestore(data, setMeta);
  }

  private _executeSelfHostBackup(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return createSelfHostBackup(data, setMeta);
  }

  private _executeSelfHostRestore(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return selfHostRestore(data, setMeta);
  }

  private _executeMigrateNovel(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return migrateNovel(data, setMeta);
  }

  private _executeDownloadChapter(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return downloadChapter(data, setMeta);
  }

  private _executeTranslateChapter(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return translateChapterTask(data, setMeta);
  }

  private _executeTranslateNovelMeta(
    data: any,
    setMeta: (
      transformer: (meta: BackgroundTaskMetadata) => BackgroundTaskMetadata,
    ) => void,
  ) {
    return translateNovelMetaTask(data, setMeta);
  }

  async executeTask(task: QueuedBackgroundTask) {
    await BackgroundService.updateNotification({
      taskTitle: task.meta.name,
      taskDesc: task.meta.progressText ?? '',
      progressBar: {
        indeterminate: true,
        max: 100,
        value: 0,
      },
    });

    const boundSetMeta = this.setMeta.bind(this);

    switch (task.task.name) {
      case 'IMPORT_EPUB':
        return this._executeImportEpub(task.task.data, boundSetMeta);
      case 'UPDATE_LIBRARY':
        return this._executeUpdateLibrary(task.task.data, boundSetMeta);
      case 'DRIVE_BACKUP':
        return this._executeDriveBackup(task.task.data, boundSetMeta);
      case 'DRIVE_RESTORE':
        return this._executeDriveRestore(task.task.data, boundSetMeta);
      case 'SELF_HOST_BACKUP':
        return this._executeSelfHostBackup(task.task.data, boundSetMeta);
      case 'SELF_HOST_RESTORE':
        return this._executeSelfHostRestore(task.task.data, boundSetMeta);
      case 'MIGRATE_NOVEL':
        return this._executeMigrateNovel(task.task.data, boundSetMeta);
      case 'DOWNLOAD_CHAPTER':
        return this._executeDownloadChapter(task.task.data, boundSetMeta);
      case 'TRANSLATE_CHAPTER':
        return this._executeTranslateChapter(task.task.data, boundSetMeta);
      case 'TRANSLATE_NOVEL_META':
        return this._executeTranslateNovelMeta(task.task.data, boundSetMeta);
      default:
        console.warn('Unknown background task:', task.task.name);
        return Promise.resolve();
    }
  }

  static async lauch() {
    const manager = ServiceManager.manager;
    const doneTasks: Record<string, number> = {};

    // Check if parallel processing is enabled
    if (manager.isParallelProcessingEnabled) {
      // Parallel processing implementation
      await ServiceManager.launchParallel(manager, doneTasks);
    } else {
      // Original sequential processing implementation
      await ServiceManager.launchSequential(manager, doneTasks);
    }

    if (manager.getTaskList().length === 0) {
      const summary = Object.keys(doneTasks)
        .filter(key => doneTasks[key] > 0)
        .map(key => `${key}: ${doneTasks[key]}`)
        .join('\n');

      if (summary) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Background tasks done',
            body: summary,
          },
          trigger: null,
        });
      }
    }
  }

  private static async launchSequential(
    manager: ServiceManager,
    doneTasks: Record<string, number>,
  ) {
    while (BackgroundService.isRunning()) {
      const currentTask = manager.getTaskList()[0];
      if (!currentTask) {
        break;
      }
      try {
        await manager.executeTask(currentTask);
        doneTasks[currentTask.task.name] =
          (doneTasks[currentTask.task.name] || 0) + 1;
      } catch (error: any) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: currentTask.meta.name,
            body: error?.message || String(error),
          },
          trigger: null,
        });
        // Update metadata with error information
        manager.setMeta(meta => ({
          ...meta,
          isRunning: false,
          progress: undefined,
          error: error?.message || String(error),
        }));
      } finally {
        // This is the sequential logic's way of removing the task
        // We need a different mechanism for parallel
        setMMKVObject(manager.STORE_KEY, manager.getTaskList().slice(1));
      }
    }
  }

  private static async launchParallel(
    manager: ServiceManager,
    doneTasks: Record<string, number>,
  ) {
    // Use a map to track running tasks and their promises
    // Key: Unique task identifier (e.g., index in original queue or a generated UUID if needed)
    // Value: { task: QueuedBackgroundTask; promise: Promise<void> }
    const runningTasks = new Map<
      string,
      { task: QueuedBackgroundTask; promise: Promise<void> }
    >();

    const MAX_DOWNLOADS = manager.isParallelDownloadsEnabled
      ? MAX_PARALLEL_DOWNLOADS_DEFAULT
      : 1;
    const MAX_TRANSLATIONS = manager.isParallelTranslationsEnabled
      ? MAX_PARALLEL_TRANSLATIONS_DEFAULT
      : 1;
    const MAX_OTHER = MAX_PARALLEL_OTHER_DEFAULT;

    const getActiveTaskCount = (name: BackgroundTask['name']): number => {
      let count = 0;
      for (const runningTaskInfo of runningTasks.values()) {
        if (runningTaskInfo.task.task.name === name) {
          count++;
        }
      }
      return count;
    };

    const isDownloadTaskPending = (
      chapterId: number,
      currentTaskList: QueuedBackgroundTask[],
    ): boolean => {
      // Check currently executing tasks
      for (const runningTaskInfo of runningTasks.values()) {
        const runningTask = runningTaskInfo.task.task;
        if (
          runningTask.name === 'DOWNLOAD_CHAPTER' &&
          (runningTask as DownloadChapterTask).data.chapterId === chapterId // Assert type for data access
        ) {
          return true;
        }
      }
      // Check tasks still in the queue
      return currentTaskList.some(
        t =>
          t.task.name === 'DOWNLOAD_CHAPTER' &&
          (t.task as DownloadChapterTask).data.chapterId === chapterId, // Assert type for data access
      );
    };

    while (BackgroundService.isRunning()) {
      const taskList = manager.getTaskList();
      if (taskList.length === 0 && runningTasks.size === 0) {
        break; // No tasks left
      }

      let startedNewTask = false;
      const runningTaskIdentifiers = new Set(runningTasks.keys()); // Keep track of which tasks are running via ID

      // --- Identify eligible tasks ---
      let activeDownloadCount = getActiveTaskCount('DOWNLOAD_CHAPTER');
      let activeTranslationCount =
        getActiveTaskCount('TRANSLATE_CHAPTER') +
        getActiveTaskCount('TRANSLATE_NOVEL_META'); // Combine counts

      let currentOtherRunning = 0;
      for (const runningTaskInfo of runningTasks.values()) {
        const taskName = runningTaskInfo.task.task.name;
        if (
          taskName !== 'DOWNLOAD_CHAPTER' &&
          taskName !== 'TRANSLATE_CHAPTER' &&
          taskName !== 'TRANSLATE_NOVEL_META'
        ) {
          currentOtherRunning++;
        }
      }

      // Find the next task in the list that isn't already running
      let taskToStart: QueuedBackgroundTask | undefined;
      let taskIndex = -1;
      for (let i = 0; i < taskList.length; i++) {
        // Use index as a simple unique ID for this run
        const taskIdentifier = `task_${i}`;
        if (!runningTaskIdentifiers.has(taskIdentifier)) {
          taskToStart = taskList[i];
          taskIndex = i;
          break;
        }
      }

      if (taskToStart) {
        let canStart = false;
        const taskIdentifier = `task_${taskIndex}`; // ID for the task we might start

        switch (taskToStart.task.name) {
          case 'DOWNLOAD_CHAPTER':
            if (activeDownloadCount < MAX_DOWNLOADS) {
              canStart = true;
              activeDownloadCount++; // Increment potential count
            }
            break;
          case 'TRANSLATE_CHAPTER':
          case 'TRANSLATE_NOVEL_META':
            const isChapterTranslation =
              taskToStart.task.name === 'TRANSLATE_CHAPTER';
            const chapterIdToCheck = isChapterTranslation
              ? (taskToStart.task as TranslateChapterTask).data.chapterId
              : undefined;

            if (
              activeTranslationCount < MAX_TRANSLATIONS &&
              (!chapterIdToCheck ||
                !isDownloadTaskPending(chapterIdToCheck, taskList))
            ) {
              canStart = true;
              activeTranslationCount++; // Increment potential count
            }
            break;
          default: // Other task types
            if (currentOtherRunning < MAX_OTHER) {
              canStart = true;
              currentOtherRunning++; // Increment potential count
            }
            break;
        }

        if (canStart) {
          startedNewTask = true;
          // Use the index-based identifier
          const currentTaskToStart = taskToStart; // Capture variable for closure
          const currentTaskIdentifier = taskIdentifier;

          // Update metadata immediately on start
          manager.setMeta(meta => ({
            ...meta,
            isRunning: true,
            progress: undefined,
            progressText: 'Starting...',
            error: null,
          }));

          const taskPromise = manager
            .executeTask(currentTaskToStart)
            .then(() => {
              doneTasks[currentTaskToStart.task.name] =
                (doneTasks[currentTaskToStart.task.name] || 0) + 1;
            })
            .catch((error: any) => {
              Notifications.scheduleNotificationAsync({
                content: {
                  title: currentTaskToStart.meta.name,
                  body: error?.message || String(error),
                },
                trigger: null,
              });
            })
            .finally(() => {
              // Task finished (success or failure)
              runningTasks.delete(currentTaskIdentifier);

              // Remove the completed/failed task from the MMKV list by matching task data
              // This is less efficient but necessary if indices change
              const currentList = manager.getTaskList();
              const taskDataToMatch = JSON.stringify(currentTaskToStart.task);
              const updatedList = currentList.filter(
                t => JSON.stringify(t.task) !== taskDataToMatch,
              );
              setMMKVObject(manager.STORE_KEY, updatedList);
            });

          runningTasks.set(currentTaskIdentifier, {
            task: currentTaskToStart,
            promise: taskPromise,
          });
        }
      }

      // Wait logic
      if (!startedNewTask && (runningTasks.size > 0 || taskList.length > 0)) {
        if (runningTasks.size > 0) {
          // Wait for any running task to finish
          await Promise.race(
            Array.from(runningTasks.values()).map(v => v.promise),
          );
        } else {
          // Nothing running, but tasks exist (likely waiting for dependencies)
          await sleep(500);
        }
      }
    }
  }
  getTaskName(task: BackgroundTask) {
    switch (task.name) {
      case 'DOWNLOAD_CHAPTER':
        return (
          'Download ' + task.data.novelName + ' - ' + task.data.chapterName
        );
      case 'TRANSLATE_CHAPTER':
        return (
          'Translate ' + task.data.novelName + ' - ' + task.data.chapterName
        );
      case 'TRANSLATE_NOVEL_META':
        return 'Translate Novel Meta: ' + task.data.novelName;
      case 'IMPORT_EPUB':
        return 'Import Epub ' + task.data.filename;
      case 'MIGRATE_NOVEL':
        return 'Migrate Novel ' + task.data.fromNovel.name;
      case 'UPDATE_LIBRARY':
        if (task.data !== undefined) {
          return 'Update Category ' + task.data.categoryName;
        }
        return 'Update Library';
      case 'DRIVE_BACKUP':
        return 'Drive Backup';
      case 'DRIVE_RESTORE':
        return 'Drive Restore';
      case 'SELF_HOST_BACKUP':
        return 'Self Host Backup';
      case 'SELF_HOST_RESTORE':
        return 'Self Host Restore';
      default:
        return 'Unknown Task';
    }
  }
  getTaskList() {
    return getMMKVObject<Array<QueuedBackgroundTask>>(this.STORE_KEY) || [];
  }
  addTask(tasks: BackgroundTask | BackgroundTask[]) {
    const currentTasks = this.getTaskList();
    const addableTasks = (Array.isArray(tasks) ? tasks : [tasks]).filter(
      task =>
        this.isMultiplicableTask(task) ||
        !currentTasks.some(_t => _t.task.name === task.name),
    );
    if (addableTasks.length) {
      let newTasks: QueuedBackgroundTask[] = addableTasks.map(task => ({
        task,
        meta: {
          name: this.getTaskName(task),
          isRunning: false,
          progress: undefined,
          progressText: undefined,
        },
      }));

      const updatedTaskList = currentTasks.concat(newTasks);
      setMMKVObject(this.STORE_KEY, updatedTaskList);
      this.start();
    }
  }
  removeTaskAtIndex(index: number) {
    const taskList = this.getTaskList();
    if (index < 0 || index >= taskList.length) {
      return;
    }

    if (index === 0 && this.isRunning) {
      this.pause();
      const newList = [...taskList];
      newList.splice(index, 1);
      setMMKVObject(this.STORE_KEY, newList);
      if (newList.length > 0) {
        this.resume();
      }
    } else {
      const newList = [...taskList];
      newList.splice(index, 1);
      setMMKVObject(this.STORE_KEY, newList);
    }
  }
  removeTasksAtIndexes(indices: number[]) {
    if (!indices || indices.length === 0) {
      return;
    }

    const taskList = this.getTaskList();
    const sortedIndices = indices.sort((a, b) => b - a);

    let needsPauseResume = false;
    if (sortedIndices.includes(0) && this.isRunning) {
      needsPauseResume = true;
      this.pause();
    }

    const newList = [...taskList];
    for (const index of sortedIndices) {
      if (index >= 0 && index < newList.length) {
        newList.splice(index, 1);
      }
    }

    setMMKVObject(this.STORE_KEY, newList);

    if (needsPauseResume && newList.length > 0) {
      this.resume();
    } else if (needsPauseResume && newList.length === 0) {
      this.stop();
    }
  }
  removeTasksByName(name: BackgroundTask['name']) {
    const taskList = this.getTaskList();
    if (taskList[0]?.task?.name === name) {
      this.pause();
      setMMKVObject(
        this.STORE_KEY,
        taskList.filter(t => t.task.name !== name),
      );
      if (taskList.length > 0) {
        this.resume();
      } else {
        this.stop();
      }
    } else {
      setMMKVObject(
        this.STORE_KEY,
        taskList.filter(t => t.task.name !== name),
      );
    }
  }
  clearTaskList() {
    setMMKVObject(this.STORE_KEY, []);
  }
  pause() {
    BackgroundService.stop();
  }
  resume() {
    this.start();
  }
  stop() {
    BackgroundService.stop();
    this.clearTaskList();
  }
}
