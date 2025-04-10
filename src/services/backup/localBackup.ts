import { version } from '../../../package.json';
import {
  _restoreNovelAndChapters,
  getAllNovels,
} from '@database/queries/NovelQueries';
import { getNovelChapters } from '@database/queries/ChapterQueries';
import {
  _restoreCategory,
  getAllNovelCategories,
  getCategoriesFromDb,
} from '@database/queries/CategoryQueries';
import { backupMMKVData, restoreMMKVData } from './utils';
import { BackupNovel, BackupCategory } from '@database/types';
import { APP_STORAGE_URI } from './utils';
import { History } from '@database/types';
import {
  getHistoryFromDb,
  insertHistory,
  deleteAllHistory,
} from '@database/queries/HistoryQueries';
import { db } from '@database/db';
import { noop } from 'lodash-es';

// Interface for the combined backup data structure
interface LocalBackupData {
  type: 'full' | 'settings'; // Keep type for import logic
  version: string;
  settings?: Record<string, any>; // Optional
  novels?: BackupNovel[]; // Optional
  categories?: BackupCategory[]; // Optional
  history?: History[]; // Optional
}

// Options for gathering backup data
export interface GatherBackupOptions {
  includeLibrary?: boolean;
  includeSettings?: boolean;
  includeHistory?: boolean;
  excludeApiKeys?: boolean;
}

/**
 * Gathers necessary data for a local backup based on options.
 * @param options Options specifying which data to include.
 * @returns A promise that resolves to the combined backup data object.
 */
export const gatherBackupData = async (
  options: GatherBackupOptions = {
    includeLibrary: true,
    includeSettings: true,
    includeHistory: true,
    excludeApiKeys: true,
  },
): Promise<Partial<LocalBackupData>> => {
  const backupData: Partial<LocalBackupData> = {
    type: 'full',
    version: version,
  };

  const appVersion = version;
  backupData.version = appVersion;

  if (options.includeSettings) {
    const settings = backupMMKVData(options.excludeApiKeys);
    backupData.settings = settings;
  }

  if (options.includeLibrary) {
    const novels = await getAllNovels();
    const backupNovels: BackupNovel[] = [];
    for (const novel of novels) {
      const chapters = await getNovelChapters(novel.id);
      const chaptersBackup = chapters.map(chapter => ({
        ...chapter,
        isDownloaded: false,
        hasTranslation: false,
      }));
      backupNovels.push({
        ...novel,
        chapters: chaptersBackup,
        cover: novel.cover?.startsWith(APP_STORAGE_URI)
          ? novel.cover.replace(APP_STORAGE_URI, '')
          : novel.cover,
      });
    }
    backupData.novels = backupNovels;

    const dbCategories = await getCategoriesFromDb();
    const novelCategories = await getAllNovelCategories();
    const backupCategories: BackupCategory[] = dbCategories.map(category => ({
      ...category,
      novelIds: novelCategories
        .filter(nc => nc.categoryId === category.id)
        .map(nc => nc.novelId),
    }));
    backupData.categories = backupCategories;
  }

  if (options.includeHistory) {
    const history = await getHistoryFromDb();
    backupData.history = history;
  }

  return backupData;
};

/**
 * Restores app data from a local backup object.
 * @param data The combined backup data object.
 */
export const restoreFromBackupData = async (
  data: Partial<LocalBackupData>,
): Promise<void> => {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid backup data format.');
  }

  if (data.version && data.version !== version) {
    console.warn('[Restore] Backup version differs from app version.');
  }

  if (data.settings) {
    restoreMMKVData(data.settings);
  }

  // 1. Restore Categories
  if (data.categories && Array.isArray(data.categories)) {
    for (const category of data.categories) {
      await _restoreCategory(category); // Ensure this ONLY inserts category details
    }
  }

  // 2. Restore Novels and their Chapters
  if (data.novels && Array.isArray(data.novels)) {
    for (const novel of data.novels) {
      if (novel.cover && !novel.cover.startsWith('http')) {
        novel.cover = APP_STORAGE_URI + novel.cover;
      }
      await _restoreNovelAndChapters(novel);
    }
  }

  // 3. Restore NovelCategory links
  if (data.categories && Array.isArray(data.categories)) {
    // Check if categories exist in backup
    db.transaction(tx => {
      for (const category of data.categories) {
        // Check if novelIds exist for the category in the backup
        if (category.novelIds && Array.isArray(category.novelIds)) {
          for (const novelId of category.novelIds) {
            tx.executeSql(
              'INSERT OR IGNORE INTO NovelCategory (categoryId, novelId) VALUES (?, ?)',
              [category.id, novelId],
              noop, // Use imported noop
              (txObj, error) => {
                console.error(
                  `Error linking category ${category.id} to novel ${novelId}:`,
                  error,
                );
                return false;
              },
            );
          }
        }
      }
    });
  }

  // 4. Restore History
  if (data.history && Array.isArray(data.history)) {
    await deleteAllHistory();
    for (const historyEntry of data.history) {
      if (historyEntry.id) {
        await insertHistory(historyEntry.id);
      } else {
        console.warn(
          '[Restore] History entry missing chapter ID:',
          historyEntry,
        );
      }
    }
  }
};
