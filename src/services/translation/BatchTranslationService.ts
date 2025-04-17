import FileManager from '@native/FileManager';
import { NOVEL_STORAGE } from '@utils/Storages';
import { showToast } from '@utils/showToast';
import ServiceManager, { BackgroundTask } from '@services/ServiceManager';
import { checkIfChapterHasTranslation } from '@database/queries/TranslationQueries';

/**
 * Queues batch translation tasks for multiple chapters.
 *
 * @param chapters Array of chapters to translate
 * @param novel Novel info
 * @param apiKey OpenRouter API key
 * @param model AI model to use
 * @param instruction Translation instruction
 * @returns Promise<number> The number of translation tasks queued.
 */
export const batchTranslateChapters = async (
  chapters: any[],
  novel: any,
  apiKey: string,
  model: string,
  instruction: string,
): Promise<number> => {
  if (!apiKey) {
    showToast('Please enter an OpenRouter API key in settings');
    return 0;
  }

  if (!chapters || chapters.length === 0) {
    showToast('No chapters selected for translation.');
    return 0;
  }

  // Normalize chapter data and filter out those already translated
  const chaptersToProcess = [];
  for (const chapter of chapters) {
    const chapterId = chapter.id || chapter.chapterId;
    if (!chapterId) {
      continue;
    }

    const hasTranslation = await checkIfChapterHasTranslation(chapterId);
    if (!hasTranslation) {
      chaptersToProcess.push({
        ...chapter,
        id: chapterId,
        chapterId: chapterId,
        pluginId: chapter.pluginId || novel.pluginId,
        novelId: novel.id,
        novelName: novel.name || 'Unknown Novel',
        chapterName:
          chapter.name || chapter.chapterName || `Chapter ${chapterId}`,
      });
    }
  }

  if (chaptersToProcess.length === 0) {
    showToast('Selected chapters are already translated.');
    return 0;
  }

  // Prepare tasks for ServiceManager
  const tasksToQueue: BackgroundTask[] = [];
  let downloadTasksCount = 0;

  for (const chapter of chaptersToProcess) {
    const filePath = `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapter.id}/index.html`;
    const fileExists = await FileManager.exists(filePath);

    // Queue download task if needed
    if (!fileExists) {
      downloadTasksCount++;
      tasksToQueue.push({
        name: 'DOWNLOAD_CHAPTER',
        data: {
          chapterId: chapter.id,
          novelId: novel.id,
          pluginId: novel.pluginId,
          novelName: novel.novelName,
          chapterName: chapter.chapterName,
        },
      });
    }

    // Always queue translation task (it will handle missing dependency)
    tasksToQueue.push({
      name: 'TRANSLATE_CHAPTER',
      data: {
        chapterId: chapter.id,
        novelId: novel.id,
        pluginId: novel.pluginId,
        novelName: novel.novelName,
        chapterName: chapter.chapterName,
        apiKey: apiKey,
        model: model,
        instruction: instruction,
      },
    });
  }

  if (tasksToQueue.length > 0) {
    ServiceManager.manager.addTask(tasksToQueue);
    const translationTasksCount = chaptersToProcess.length;
    let message = `Queued ${translationTasksCount} translation task(s).`;
    if (downloadTasksCount > 0) {
      message += ` ${downloadTasksCount} download task(s) also queued.`;
    }
    showToast(message);
    return translationTasksCount;
  } else {
    showToast('No tasks to queue.');
    return 0;
  }
};
