import { translateText } from './TranslationService';
import { saveTranslation } from '@database/queries/TranslationQueries';
import FileManager from '@native/FileManager';
import { NOVEL_STORAGE } from '@utils/Storages';
import { showToast } from '@utils/showToast';
import { getString } from '@strings/translations';
import { Alert } from 'react-native';
import { downloadChapter } from '@services/download/downloadChapter';
import ServiceManager, { DownloadChapterTask } from '@services/ServiceManager';
import { db } from '@database/db';

/**
 * Batch translate multiple chapters
 * 
 * @param chapters Array of chapters to translate
 * @param novel Novel info
 * @param apiKey OpenRouter API key
 * @param model AI model to use
 * @param instruction Translation instruction
 * @returns Promise with number of successfully translated chapters
 */
export const batchTranslateChapters = async (
  chapters: any[],
  novel: any,
  apiKey: string,
  model: string,
  instruction: string
): Promise<number> => {
  if (!apiKey) {
    showToast('Please enter an OpenRouter API key in settings');
    return 0;
  }

  // Add more detailed logging of exactly what we received from the caller
  console.log(`🔥 [BATCH API] RECEIVED ${chapters.length} CHAPTERS FOR PROCESSING`);
  chapters.forEach((chapter, idx) => {
    console.log(`🔥 [BATCH API] Chapter ${idx+1} details:`, {
      id: chapter.id,
      chapterId: chapter.chapterId,
      novelId: chapter.novelId,
      pluginId: chapter.pluginId || novel.pluginId,
      isDownloaded: chapter.isDownloaded
    });
  });

  // Debug log the chapters and novel data
  console.log('🔍 [BATCH API] Processing chapters:', chapters.map(c => ({
    id: c.id, 
    chapterId: c.chapterId,
    isDownloaded: c.isDownloaded,
    novelId: c.novelId,
    pluginId: c.pluginId || novel.pluginId
  })));
  console.log('🔍 [BATCH API] Novel data:', {id: novel.id, pluginId: novel.pluginId, name: novel.name});

  // Make sure all chapters have necessary IDs
  const normalizedChapters = chapters.map(chapter => ({
    ...chapter,
    id: chapter.id || chapter.chapterId,
    chapterId: chapter.chapterId || chapter.id,
    pluginId: chapter.pluginId || novel.pluginId
  }));

  console.log('🔍 [BATCH API] Normalized chapters:', normalizedChapters.map(c => ({
    id: c.id, 
    chapterId: c.chapterId
  })));

  // SIMPLIFIED APPROACH: Download ALL chapters regardless of status
  return new Promise((resolve) => {
    Alert.alert(
      'Download & Translate',
      `All ${chapters.length} chapter(s) will be downloaded (if needed) and then translated. Continue?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => resolve(0),
        },
        {
          text: 'Proceed',
          onPress: async () => {
            try {
              // Check which chapters need to be downloaded
              const chapterFilePaths = normalizedChapters.map(chapter => {
                return `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapter.id}/index.html`;
              });
              
              console.log(`🔍 [BATCH API] Checking which chapters need downloading...`);
              const fileExistsPromises = chapterFilePaths.map(filePath => FileManager.exists(filePath));
              const existsResults = await Promise.all(fileExistsPromises);
              
              const chaptersToDownload = normalizedChapters.filter((chapter, index) => !existsResults[index]);
              const alreadyDownloaded = normalizedChapters.filter((chapter, index) => existsResults[index]);
              
              console.log(`🔍 [BATCH API] Need to download ${chaptersToDownload.length} chapters, ${alreadyDownloaded.length} already downloaded`);
              
              // Only show download toast if there are chapters to download
              if (chaptersToDownload.length > 0) {
                showToast(`Downloading ${chaptersToDownload.length} chapters...`);
                
                // First download attempt
                await attemptDownloadChapters(chaptersToDownload, novel);
                
                // After wait completes, proceed with translation
                showToast('Processing translations...');
              } else {
                console.log(`🔍 [BATCH API] All chapters already downloaded, proceeding to translation`);
                showToast('Processing translations...');
              }
              
              // Verify files exist before translation and collect all chapters that are now downloaded
              const readyForTranslation = [];
              
              // Check all chapters to make sure they're downloaded now
              for (const chapter of normalizedChapters) {
                const chapterId = chapter.id || chapter.chapterId;
                const filePath = `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapterId}/index.html`;
                const exists = await FileManager.exists(filePath);
                console.log(`🔍 [BATCH API] Chapter ${chapterId} file exists: ${exists}`);
                
                if (exists) {
                  readyForTranslation.push(chapter);
                } else {
                  console.log(`🔍 [BATCH API] Warning: Chapter ${chapterId} still not downloaded, will skip translation`);
                }
              }
              
              console.log(`🔍 [BATCH API] Proceeding with translations for ${readyForTranslation.length} chapters`);
              const translatedCount = await processTranslations(readyForTranslation, novel, apiKey, model, instruction);
              resolve(translatedCount);
            } catch (error) {
              console.error('🔍 [BATCH API] Error in download/translate process:', error);
              showToast('Error during download/translation process');
              resolve(0);
            }
          },
        },
      ],
      { cancelable: true }
    );
  });
};

// Helper function to process translations after ensuring chapters are downloaded
const processTranslations = async (
  chapters: any[],
  novel: any,
  apiKey: string,
  model: string,
  instruction: string
): Promise<number> => {
  let successCount = 0;
  
  console.log(`🔍 [BATCH TRANSLATE] Processing ${chapters.length} chapters for translation`);
  
  // Process chapters sequentially to avoid rate limiting
  for (const chapter of chapters) {
    try {
      // Handle both id and chapterId properties
      const chapterId = chapter.id || chapter.chapterId;
      if (!chapterId) {
        console.error('🔍 [BATCH TRANSLATE] Cannot translate chapter without ID:', chapter);
        continue;
      }
      
      console.log(`🔍 [BATCH TRANSLATE] Processing chapter ${chapterId}`);
      
      // Check if chapter already has a translation
      const hasTranslation = await checkIfChapterHasTranslation(chapterId);
      if (hasTranslation) {
        console.log(`🔍 [BATCH TRANSLATE] Chapter ${chapterId} already has a translation, skipping`);
        continue;
      }
      
      const filePath = `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapterId}/index.html`;
      
      console.log(`🔍 [BATCH TRANSLATE] Checking file for translation: ${filePath}`);
      const fileExists = await FileManager.exists(filePath);
      if (!fileExists) {
        console.log(`🔍 [BATCH TRANSLATE] Skipping chapter ${chapterId} as it's not downloaded (file doesn't exist)`);
        continue; // Skip non-downloaded chapters
      }

      // Read the chapter content
      console.log(`🔍 [BATCH TRANSLATE] Reading file content for chapter ${chapterId}`);
      const chapterContent = await FileManager.readFile(filePath);
      
      if (!chapterContent || chapterContent.trim() === '') {
        console.warn(`🔍 [BATCH TRANSLATE] Chapter ${chapterId} content is empty, skipping`);
        continue;
      }
      
      // Translate the content
      console.log(`🔍 [BATCH TRANSLATE] Translating chapter ${chapterId} (content length: ${chapterContent.length})`);
      
      try {
        const translationResult = await translateText(
          apiKey,
          chapterContent,
          model,
          instruction
        );

        // Process the translated content to preserve line breaks
        console.log(`🔍 [BATCH TRANSLATE] Processing translated content for chapter ${chapterId}`);
        const processedContent = translationResult.content
          .replace(/\n/g, '<br/>') // Replace newlines with <br/> tags
          .replace(/  /g, '&nbsp;&nbsp;'); // Replace double spaces with non-breaking spaces

        // Save the translation to the database
        console.log(`🔍 [BATCH TRANSLATE] Saving translation for chapter ${chapterId} to database`);
        await saveTranslation(
          chapterId,
          processedContent,
          translationResult.model,
          translationResult.instruction
        );
        
        // Update the hasTranslation flag in the Chapter table
        console.log(`🔍 [BATCH TRANSLATE] Updating hasTranslation flag for chapter ${chapterId}`);
        db.transaction(tx => {
          tx.executeSql(
            'UPDATE Chapter SET hasTranslation = 1 WHERE id = ?',
            [chapterId],
            () => {
              console.log(`🔍 [BATCH TRANSLATE] Successfully updated hasTranslation flag for chapter ${chapterId}`);
            },
            (_: any, error: any) => {
              console.error(`🔍 [BATCH TRANSLATE] Error updating hasTranslation flag:`, error);
              return false;
            }
          );
        });

        console.log(`🔍 [BATCH TRANSLATE] Successfully translated chapter ${chapterId}`);
        successCount++;
      } catch (translationError) {
        // Handle translation-specific errors
        console.error(`🔍 [BATCH TRANSLATE] Translation API error for chapter ${chapterId}:`, translationError);
        
        // Check for rate limit errors
        const errorMessage = translationError instanceof Error ? translationError.message : 'Unknown error';
        if (errorMessage.includes('Rate limit exceeded') || errorMessage.includes('Quota exceeded')) {
          showToast(`Translation stopped: ${errorMessage}`);
          // Break out of the loop to stop trying more translations
          break;
        } else {
          // For other errors, just skip this chapter and continue with the next
          showToast(`Error translating chapter ${chapter.name || chapterId}: ${errorMessage}`);
        }
      }
    } catch (error) {
      console.error(`🔍 [BATCH TRANSLATE] Error processing chapter:`, error, chapter);
    }
  }

  console.log(`🔍 [BATCH TRANSLATE] Completed translation of ${successCount}/${chapters.length} chapters`);
  
  if (successCount > 0) {
    showToast(`Translation complete: ${successCount} of ${chapters.length} chapters translated`);
  } else {
    showToast('No chapters were translated. Please check the logs for errors.');
  }

  return successCount;
};

// Helper function to check if a chapter already has a translation
const checkIfChapterHasTranslation = async (chapterId: number): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT hasTranslation FROM Chapter WHERE id = ?',
        [chapterId],
        (_, result) => {
          if (result.rows.length > 0) {
            const hasTranslation = result.rows.item(0).hasTranslation === 1;
            resolve(hasTranslation);
          } else {
            resolve(false);
          }
        },
        (_, error) => {
          console.error('Error checking if chapter has translation:', error);
          resolve(false);
          return false;
        }
      );
    });
  });
};

// Helper function to handle downloading chapters with retry logic
const attemptDownloadChapters = async (chaptersToDownload: any[], novel: any, retryAttempt: number = 0): Promise<void> => {
  if (chaptersToDownload.length === 0) {
    return;
  }
  
  const MAX_RETRIES = 2;
  const POLL_INTERVAL = 3000; // Check every 3 seconds
  const MAX_WAIT_TIME = 60000; // 1 minute max

  // Queue chapters for download
  const chapterIdsBeingDownloaded: number[] = [];
  const chapterFilePaths: {id: number, path: string}[] = [];
  
  for (const chapter of chaptersToDownload) {
    try {
      // Get appropriate chapter ID
      const chapterId = chapter.id || chapter.chapterId;
      if (!chapterId) {
        console.error('🔍 [BATCH API] Cannot download chapter without ID:', chapter);
        continue;
      }
      
      const filePath = `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapterId}/index.html`;
      chapterFilePaths.push({id: chapterId, path: filePath});
      
      console.log(`🔍 [BATCH API] Queuing download for chapter ${chapterId} (attempt ${retryAttempt + 1})`);
      chapterIdsBeingDownloaded.push(chapterId);
      
      // Add the download task to ServiceManager
      ServiceManager.manager.addTask({
        name: 'DOWNLOAD_CHAPTER',
        data: {
          chapterId: chapterId,
          novelName: novel.name || 'Unknown Novel',
          chapterName: chapter.name || chapter.chapterName || `Chapter ${chapterId}`
        }
      });
    } catch (error) {
      console.error(`🔍 [BATCH API] Error queueing chapter download:`, error, chapter);
    }
  }
  
  if (chapterIdsBeingDownloaded.length === 0) {
    return; // Nothing to download
  }
  
  console.log(`🔍 [BATCH API] Queued ${chapterIdsBeingDownloaded.length} chapters for download (attempt ${retryAttempt + 1})`);
  
  // Wait for downloads to complete by monitoring the task queue
  console.log(`🔍 [BATCH API] Waiting for downloads to complete...`);
  
  const startTime = Date.now();
  try {
    let queueEmpty = false;
    
    // Wait until all downloads are out of the queue
    while (!queueEmpty && (Date.now() - startTime < MAX_WAIT_TIME)) {
      // Check if any of our chapters are still in the download queue
      const pendingDownloads = await areChaptersStillDownloading(chapterIdsBeingDownloaded);
      
      if (!pendingDownloads) {
        console.log(`🔍 [BATCH API] All downloads have been processed by the queue`);
        queueEmpty = true;
        break;
      }
      
      // Wait for a bit before checking again
      console.log(`🔍 [BATCH API] Found ${pendingDownloads} download tasks in queue, waiting...`);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
    
    if (!queueEmpty) {
      console.log(`🔍 [BATCH API] Maximum wait time exceeded, proceeding anyway`);
    }
    
    // Additional verification: check if files actually exist after download queue is clear
    console.log(`🔍 [BATCH API] Verifying downloads succeeded by checking files...`);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Short delay to ensure filesystem is updated
    
    // Check which files successfully downloaded
    const failedDownloads: any[] = [];
    for (const chapter of chaptersToDownload) {
      const chapterId = chapter.id || chapter.chapterId;
      const filePath = `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapterId}/index.html`;
      
      const exists = await FileManager.exists(filePath);
      console.log(`🔍 [BATCH API] Chapter ${chapterId} download status: ${exists ? 'SUCCESS' : 'FAILED'}`);
      
      if (!exists) {
        failedDownloads.push(chapter);
      }
    }
    
    // If any downloads failed and we haven't exceeded max retries, try again
    if (failedDownloads.length > 0 && retryAttempt < MAX_RETRIES) {
      console.log(`🔍 [BATCH API] ${failedDownloads.length} downloads failed, retrying...`);
      showToast(`Retrying ${failedDownloads.length} failed downloads...`);
      await attemptDownloadChapters(failedDownloads, novel, retryAttempt + 1);
    } else if (failedDownloads.length > 0) {
      console.log(`🔍 [BATCH API] ${failedDownloads.length} downloads failed after all retries`);
      showToast(`${failedDownloads.length} chapters failed to download`);
    }
  } catch (error) {
    console.error(`🔍 [BATCH API] Error while waiting for downloads:`, error);
  }
};

// Helper function to check if any of our chapters are still in the download queue
const areChaptersStillDownloading = async (chapterIds: number[]): Promise<number> => {
  const taskList = ServiceManager.manager.getTaskList();
  
  // Look for any download tasks for our chapter IDs
  const pendingDownloads = taskList.filter((task) => {
    if (task.task.name === 'DOWNLOAD_CHAPTER') {
      const downloadTask = task.task as DownloadChapterTask;
      return chapterIds.includes(downloadTask.data.chapterId);
    }
    return false;
  });
  
  return pendingDownloads.length;
}; 