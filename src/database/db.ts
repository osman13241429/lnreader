import * as SQLite from 'expo-sqlite';
import {
  createCategoriesTableQuery,
  createCategoryDefaultQuery,
  createCategoryTriggerQuery,
} from './tables/CategoryTable';
import { createNovelTableQuery } from './tables/NovelTable';
import { createNovelCategoryTableQuery } from './tables/NovelCategoryTable';
import {
  createChapterTableQuery,
  createChapterNovelIdIndexQuery,
} from './tables/ChapterTable';
import { dbTxnErrorCallback } from './utils/helpers';
import { noop } from 'lodash-es';
import { createRepositoryTableQuery } from './tables/RepositoryTable';
import { createTranslationTableQuery } from './tables/TranslationTable';

const dbName = 'lnreader.db';

export const db = SQLite.openDatabase(dbName);

export const createTables = () => {
  db.exec([{ sql: 'PRAGMA foreign_keys = ON', args: [] }], false, () => {});
  db.transaction(tx => {
    tx.executeSql(createNovelTableQuery);
    tx.executeSql(createCategoriesTableQuery);
    tx.executeSql(createCategoryDefaultQuery);
    tx.executeSql(createCategoryTriggerQuery);
    tx.executeSql(createNovelCategoryTableQuery);
    tx.executeSql(createChapterTableQuery);
    tx.executeSql(createChapterNovelIdIndexQuery);
  });

  db.transaction(tx => {
    tx.executeSql(createRepositoryTableQuery);
    tx.executeSql(createTranslationTableQuery);
  });

  // Run migrations
  migrateDatabase();
};

/**
 * Database migration to handle schema changes
 */
export const migrateDatabase = () => {
  let didRunMigration = false;

  db.transaction(tx => {
    tx.executeSql(
      'PRAGMA table_info(Chapter)',
      [],
      (_, { rows }) => {
        const columns = rows._array;
        const hasTranslationExists = columns.some(
          col => col.name === 'hasTranslation',
        );
        const translatedNameExistsChapter = columns.some(
          col => col.name === 'translatedName',
        ); // Check for Chapter.translatedName

        if (!hasTranslationExists || !translatedNameExistsChapter) {
          // Only log once if any migration happens in this block
          if (!didRunMigration) {
            console.log('Running database migrations...');
            didRunMigration = true;
          }
        }

        if (!hasTranslationExists) {
          tx.executeSql(
            'ALTER TABLE Chapter ADD COLUMN hasTranslation INTEGER DEFAULT 0',
            [],
            () => {
              // Update existing chapter content translations if any
              tx.executeSql(
                `UPDATE Chapter SET hasTranslation = 1 
                 WHERE id IN (SELECT chapterId FROM Translation)`,
                [],
                (_, error) => {
                  return error ? false : true;
                },
              );
            },
            (_, error) => {
              return error ? false : true;
            },
          );
        }

        // Migration: Add translatedName to Chapter table
        if (!translatedNameExistsChapter) {
          tx.executeSql(
            'ALTER TABLE Chapter ADD COLUMN translatedName TEXT',
            [],
            (_, error) => {
              return error ? false : true;
            },
          );
        }
      },
      (_, error) => {
        return error ? false : true;
      },
    );

    // Migration: Add translatedName and translatedSummary to Novel table
    tx.executeSql(
      'PRAGMA table_info(Novel)',
      [],
      (_, { rows }) => {
        const columns = rows._array;
        const translatedNameExists = columns.some(
          col => col.name === 'translatedName',
        );
        const translatedSummaryExists = columns.some(
          col => col.name === 'translatedSummary',
        );

        if (!translatedNameExists || !translatedSummaryExists) {
          // Only log once if any migration happens in this block
          if (!didRunMigration) {
            console.log('Running database migrations...');
            didRunMigration = true;
          }
        }

        if (!translatedNameExists) {
          tx.executeSql(
            'ALTER TABLE Novel ADD COLUMN translatedName TEXT',
            [],
            (_, error) => {
              return error ? false : true;
            },
          );
        }

        if (!translatedSummaryExists) {
          tx.executeSql(
            'ALTER TABLE Novel ADD COLUMN translatedSummary TEXT',
            [],
            (_, error) => {
              return error ? false : true;
            },
          );
        }
      },
      (_, error) => {
        return error ? false : true;
      },
    );
  });

  return didRunMigration;
};

/**
 * For Testing
 */
export const deleteDatabase = async () => {
  db.transaction(
    tx => {
      tx.executeSql('DROP TABLE Category');
      tx.executeSql('DROP TABLE Novel');
      tx.executeSql('DROP TABLE NovelCategory');
      tx.executeSql('DROP TABLE Chapter');
      tx.executeSql('DROP TABLE Download');
      tx.executeSql('DROP TABLE Repository');
    },
    dbTxnErrorCallback,
    noop,
  );
};
