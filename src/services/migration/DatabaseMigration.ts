import { db } from '@database/db';
import { showToast } from '@utils/showToast';

/**
 * Function to fix the hasTranslation column error.
 * This can be called directly from the app to resolve any database issues.
 */
export const fixTranslationColumn = async (): Promise<boolean> => {
  return new Promise(resolve => {
    try {
      console.log('Fixing hasTranslation column...');

      // Add hasTranslation column to Chapter table if it doesn't exist
      db.transaction(tx => {
        // First check if the column exists
        tx.executeSql(
          'PRAGMA table_info(Chapter)',
          [],
          (_, { rows }) => {
            const columns = rows._array;
            const hasTranslationExists = columns.some(
              col => col.name === 'hasTranslation',
            );

            if (!hasTranslationExists) {
              console.log('Adding hasTranslation column to Chapter table');
              tx.executeSql(
                'ALTER TABLE Chapter ADD COLUMN hasTranslation INTEGER DEFAULT 0',
                [],
                () => {
                  console.log('Successfully added hasTranslation column');

                  // Update existing translations if any
                  tx.executeSql(
                    `UPDATE Chapter SET hasTranslation = 1 
                     WHERE id IN (SELECT chapterId FROM Translation)`,
                    [],
                    () => {
                      console.log('Updated existing translations');
                      showToast('Database migration completed successfully!');
                      resolve(true);
                    },
                    (_, error) => {
                      console.error('Error updating translations:', error);
                      showToast(
                        'Migration partially completed. Error updating translations.',
                      );
                      resolve(false);
                      return false;
                    },
                  );
                },
                (_, error) => {
                  console.error('Error adding hasTranslation column:', error);
                  showToast('Error adding hasTranslation column to database.');
                  resolve(false);
                  return false;
                },
              );
            } else {
              console.log('hasTranslation column already exists');
              showToast('Database is already up to date.');
              resolve(true);
            }
          },
          (_, error) => {
            console.error('Error checking for hasTranslation column:', error);
            showToast('Error checking database schema.');
            resolve(false);
            return false;
          },
        );
      });
    } catch (error) {
      console.error('Migration error:', error);
      showToast(
        'Database migration failed: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      );
      resolve(false);
    }
  });
};
