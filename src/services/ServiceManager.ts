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
  DependencyMissingError,
  translateNovelMetaTask,
} from './translation/TranslationService';

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

  // Getter for parallel processing setting (legacy support)
  get isParallelProcessingEnabled() {
    return this.parallelProcessingEnabled;
  }

  // Getter for parallel downloads setting
  get isParallelDownloadsEnabled() {
    return this.parallelDownloadsEnabled;
  }

  // Getter for parallel translations setting
  get isParallelTranslationsEnabled() {
    return this.parallelTranslationsEnabled;
  }

  // Toggle parallel processing and persist the setting (legacy support)
  toggleParallelProcessing() {
    this.parallelProcessingEnabled = !this.parallelProcessingEnabled;
    setMMKVObject(this.PARALLEL_PROCESSING_KEY, this.parallelProcessingEnabled);

    // For backward compatibility, also toggle both specific settings
    this.setParallelDownloads(this.parallelProcessingEnabled);
    this.setParallelTranslations(this.parallelProcessingEnabled);

    return this.parallelProcessingEnabled;
  }

  // Toggle parallel downloads specifically
  toggleParallelDownloads() {
    this.parallelDownloadsEnabled = !this.parallelDownloadsEnabled;
    setMMKVObject(this.PARALLEL_DOWNLOADS_KEY, this.parallelDownloadsEnabled);

    // Update the general setting based on individual settings
    this.updateGeneralParallelSetting();

    return this.parallelDownloadsEnabled;
  }

  // Toggle parallel translations specifically
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

  // Set parallel downloads explicitly
  setParallelDownloads(enabled: boolean) {
    this.parallelDownloadsEnabled = enabled;
    setMMKVObject(this.PARALLEL_DOWNLOADS_KEY, this.parallelDownloadsEnabled);

    // Update the general setting
    this.updateGeneralParallelSetting();
  }

  // Set parallel translations explicitly
  setParallelTranslations(enabled: boolean) {
    this.parallelTranslationsEnabled = enabled;
    setMMKVObject(
      this.PARALLEL_TRANSLATIONS_KEY,
      this.parallelTranslationsEnabled,
    );

    // Update the general setting
    this.updateGeneralParallelSetting();
  }

  // Update the general parallel setting based on individual settings
  private updateGeneralParallelSetting() {
    // The general setting is true if either specific setting is true
    this.parallelProcessingEnabled =
      this.parallelDownloadsEnabled || this.parallelTranslationsEnabled;
    setMMKVObject(this.PARALLEL_PROCESSING_KEY, this.parallelProcessingEnabled);
  }

  // Set parallel processing explicitly (legacy support)
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
    taskList[0] = {
      ...taskList[0],
      meta: transformer(taskList[0].meta),
    };

    if (taskList[0].meta.isRunning) {
      BackgroundService.updateNotification({
        taskTitle: taskList[0].meta.name,
        taskDesc: taskList[0].meta.progressText ?? '',
        progressBar: {
          indeterminate: taskList[0].meta.progress === undefined,
          value: (taskList[0].meta.progress || 0) * 100,
          max: 100,
        },
      });
    }

    setMMKVObject(this.STORE_KEY, taskList);
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

    switch (task.task.name) {
      case 'IMPORT_EPUB':
        return importEpub(task.task.data, this.setMeta.bind(this));
      case 'UPDATE_LIBRARY':
        return updateLibrary(task.task.data || {}, this.setMeta.bind(this));
      case 'DRIVE_BACKUP':
        return createDriveBackup(task.task.data, this.setMeta.bind(this));
      case 'DRIVE_RESTORE':
        return driveRestore(task.task.data, this.setMeta.bind(this));
      case 'SELF_HOST_BACKUP':
        return createSelfHostBackup(task.task.data, this.setMeta.bind(this));
      case 'SELF_HOST_RESTORE':
        return selfHostRestore(task.task.data, this.setMeta.bind(this));
      case 'MIGRATE_NOVEL':
        return migrateNovel(task.task.data, this.setMeta.bind(this));
      case 'DOWNLOAD_CHAPTER':
        return downloadChapter(task.task.data, this.setMeta.bind(this));
      case 'TRANSLATE_CHAPTER':
        return translateChapterTask(task.task.data, this.setMeta.bind(this));
      case 'TRANSLATE_NOVEL_META':
        return translateNovelMetaTask(task.task.data, this.setMeta.bind(this));
      default:
        return;
    }
  }

  static async lauch() {
    // retrieve class instance because this is running in different context
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

  // Original sequential processing logic
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
      } finally {
        setMMKVObject(manager.STORE_KEY, manager.getTaskList().slice(1));
      }
    }
  }

  // New parallel processing logic
  private static async launchParallel(
    manager: ServiceManager,
    doneTasks: Record<string, number>,
  ) {
    // Use a map to track running tasks and their promises
    const runningTasks = new Map<string, Promise<void>>();
    const MAX_DOWNLOADS = manager.isParallelDownloadsEnabled ? 3 : 1;
    const MAX_TRANSLATIONS = manager.isParallelTranslationsEnabled ? 3 : 1;
    const MAX_OTHER = 1;

    // Helper to count active tasks of a specific type
    const getActiveTaskCount = (name: BackgroundTask['name']): number => {
      let count = 0;
      for (const taskId of runningTasks.keys()) {
        const runningTask = JSON.parse(taskId) as BackgroundTask;
        if (runningTask.name === name) {
          count++;
        }
      }
      return count;
    };

    // Helper to check if a download dependency exists (running or queued)
    const isDownloadTaskPending = (
      chapterId: number,
      currentTaskList: QueuedBackgroundTask[],
    ): boolean => {
      // Check currently executing tasks
      for (const taskId of runningTasks.keys()) {
        const runningTask = JSON.parse(taskId) as BackgroundTask;
        if (
          runningTask.name === 'DOWNLOAD_CHAPTER' &&
          runningTask.data.chapterId === chapterId
        ) {
          return true;
        }
      }
      // Check tasks still in the queue
      return currentTaskList.some(
        t =>
          t.task.name === 'DOWNLOAD_CHAPTER' &&
          t.task.data.chapterId === chapterId,
      );
    };

    while (BackgroundService.isRunning()) {
      const taskList = manager.getTaskList();
      if (taskList.length === 0 && runningTasks.size === 0) {
        break; // No tasks left
      }

      let startedNewTask = false;
      const tasksToStart: QueuedBackgroundTask[] = [];

      // --- Identify eligible tasks ---
      const currentRunningTaskIds = new Set(runningTasks.keys());
      let activeDownloadCount = getActiveTaskCount('DOWNLOAD_CHAPTER');
      let activeTranslationCount = getActiveTaskCount('TRANSLATE_CHAPTER');

      let currentOtherRunning = 0; // Count currently running non-download/translate tasks
      for (const taskId of runningTasks.keys()) {
        const runningTask = JSON.parse(taskId) as BackgroundTask;
        if (
          runningTask.name !== 'DOWNLOAD_CHAPTER' &&
          runningTask.name !== 'TRANSLATE_CHAPTER'
        ) {
          currentOtherRunning++;
        }
      }

      for (const task of taskList) {
        const taskId = JSON.stringify(task.task);
        if (currentRunningTaskIds.has(taskId)) {
          continue;
        } // Already running

        let canStart = false;
        switch (task.task.name) {
          case 'DOWNLOAD_CHAPTER':
            if (activeDownloadCount < MAX_DOWNLOADS) {
              canStart = true;
            }
            break;
          case 'TRANSLATE_CHAPTER':
          case 'TRANSLATE_NOVEL_META':
            if (
              activeTranslationCount < MAX_TRANSLATIONS &&
              (task.task.name === 'TRANSLATE_CHAPTER'
                ? !isDownloadTaskPending(task.task.data.chapterId, taskList)
                : true)
            ) {
              canStart = true;
            }
            break;
          default: // Other task types
            if (currentOtherRunning < MAX_OTHER) {
              canStart = true;
            }
            break;
        }

        if (canStart) {
          tasksToStart.push(task);
          // Increment counters *tentatively* to prevent over-scheduling in this loop iteration
          if (task.task.name === 'DOWNLOAD_CHAPTER') {
            activeDownloadCount++;
          } else if (
            task.task.name === 'TRANSLATE_CHAPTER' ||
            task.task.name === 'TRANSLATE_NOVEL_META'
          ) {
            activeTranslationCount++;
          } else {
            currentOtherRunning++;
          }
          // Limit starting only one 'OTHER' task per loop iteration to be safe
          if (
            task.task.name !== 'DOWNLOAD_CHAPTER' &&
            task.task.name !== 'TRANSLATE_CHAPTER' &&
            task.task.name !== 'TRANSLATE_NOVEL_META'
          ) {
            break;
          }
        }
      }
      // --- End of identifying eligible tasks ---

      // --- Start eligible tasks ---
      for (const taskToStart of tasksToStart) {
        const taskId = JSON.stringify(taskToStart.task);
        if (runningTasks.has(taskId)) {
          continue;
        } // Should not happen, but safety check

        startedNewTask = true;
        const taskPromise = (async () => {
          let wasDependencyError = false;
          try {
            await manager.executeTask(taskToStart);
            doneTasks[taskToStart.task.name] =
              (doneTasks[taskToStart.task.name] || 0) + 1;
          } catch (error: any) {
            wasDependencyError = error instanceof DependencyMissingError;
            if (!wasDependencyError) {
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: taskToStart.meta.name,
                  body: error?.message || String(error),
                },
                trigger: null,
              });
            } else {
              // console.debug(`Dependency error for ${taskToStart.meta.name}, will retry.`);
            }
          } finally {
            // Remove task from running map when done
            runningTasks.delete(taskId);

            // Remove task from MMKV only if it completed successfully or failed for a non-dependency reason
            if (!wasDependencyError) {
              const currentTaskList = manager.getTaskList(); // Get fresh list
              const currentIndex = currentTaskList.findIndex(
                t => JSON.stringify(t.task) === taskId,
              );
              if (currentIndex >= 0) {
                const updatedList = [...currentTaskList];
                updatedList.splice(currentIndex, 1);
                setMMKVObject(manager.STORE_KEY, updatedList);
              }
            }
          }
        })();
        runningTasks.set(taskId, taskPromise);
      }
      // --- End of starting eligible tasks ---

      // If no tasks could be started, and tasks are still running or queued, wait.
      if (!startedNewTask && (taskList.length > 0 || runningTasks.size > 0)) {
        const runningPromises = Array.from(runningTasks.values());
        try {
          if (runningPromises.length > 0) {
            await Promise.race([
              ...runningPromises,
              new Promise(resolve => setTimeout(resolve, 1500)), // Wait max 1.5 seconds
            ]);
          } else {
            // No tasks running, but queue not empty (likely due to dependencies)
            await new Promise(resolve => setTimeout(resolve, 1500)); // Wait before re-checking queue
          }
        } catch (e) {
          // Ignore errors here (like task failures), they are handled in the task execution logic's finally block
        }
      }
    } // End of while loop
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
