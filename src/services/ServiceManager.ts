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
import { translateChapterTask } from './translation/TranslationService';

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
  | TranslateChapterTask;
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
  private static instance?: ServiceManager;
  private constructor() {}
  static get manager() {
    if (!this.instance) {
      this.instance = new ServiceManager();
    }
    return this.instance;
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
      default:
        return;
    }
  }

  static async lauch() {
    // retrieve class instance because this is running in different context
    const manager = ServiceManager.manager;
    const doneTasks: Record<string, number> = {};

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
