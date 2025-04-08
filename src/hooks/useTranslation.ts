import { useCallback, useState, useEffect } from 'react';
import { useTranslationSettings } from '@hooks/persisted/useSettings';
import {
  getTranslation,
  deleteTranslation,
} from '@database/queries/TranslationQueries';
import { ChapterInfo, NovelInfo } from '@database/types';
import FileManager from '@native/FileManager';
import { NOVEL_STORAGE } from '@utils/Storages';
import { showToast } from '@utils/showToast';
import { getString } from '@strings/translations';
import ServiceManager from '@services/ServiceManager';

export const useTranslation = (chapterId: number) => {
  const { apiKey, defaultInstruction, model } = useTranslationSettings();
  const [translationContent, setTranslationContent] = useState<string | null>(
    null,
  );
  const [showTranslation, setShowTranslation] = useState(false);

  // Safe version of getString that handles missing translations
  const safeGetString = (key: any, options?: any) => {
    try {
      // Using any type to bypass TypeScript checking for keys
      return getString(key as any, options);
    } catch (error) {
      return key.split('.').pop() || 'ERROR';
    }
  };

  const checkTranslation = useCallback(async () => {
    if (!chapterId) {
      return false;
    }

    try {
      const translation = await getTranslation(chapterId);
      if (translation && translation.content) {
        setTranslationContent(translation.content);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }, [chapterId]);

  // Reset translation state when chapterId changes
  useEffect(() => {
    // Reset translation state
    setTranslationContent(null);
    setShowTranslation(false);

    // Check if this chapter has a translation
    if (chapterId) {
      // Use the checkTranslation function via the callback
      checkTranslation().catch(_error => {
        // Silently handle error
      });
    }
  }, [chapterId, checkTranslation]);

  const translateChapter = useCallback(
    async (chapter: ChapterInfo, novel: NovelInfo) => {
      if (!apiKey) {
        showToast(safeGetString('translation.noApiKey'));
        return;
      }

      // Safety checks
      if (!chapter || !novel || !novel.pluginId || !novel.id || !chapter.id) {
        showToast(
          safeGetString('common.error') + ': Invalid chapter or novel data',
        );
        return;
      }

      // Check if chapter is downloaded *before* queueing
      const filePath = `${NOVEL_STORAGE}/${novel.pluginId}/${novel.id}/${chapter.id}/index.html`;
      const fileExists = await FileManager.exists(filePath);

      const translationTaskData = {
        chapterId: chapter.id,
        novelId: novel.id,
        pluginId: novel.pluginId,
        novelName: novel.name || 'Unknown Novel',
        chapterName: chapter.name || `Chapter ${chapter.id}`,
        apiKey: apiKey,
        model: model,
        instruction: defaultInstruction,
      };

      if (!fileExists) {
        const downloadTaskData = {
          chapterId: chapter.id,
          novelId: novel.id,
          pluginId: novel.pluginId,
          novelName: novel.name || 'Unknown Novel',
          chapterName: chapter.name || `Chapter ${chapter.id}`,
        };
        showToast(
          'Chapter not downloaded. Adding download and translation to queue.',
        );
        ServiceManager.manager.addTask([
          { name: 'DOWNLOAD_CHAPTER', data: downloadTaskData },
          { name: 'TRANSLATE_CHAPTER', data: translationTaskData },
        ]);
      } else {
        showToast('Adding translation task to queue.');
        ServiceManager.manager.addTask({
          name: 'TRANSLATE_CHAPTER',
          data: translationTaskData,
        });
      }

      // setIsTranslating(true) might be removed or changed to reflect queue status
      // No need for try/catch/finally here as the task runs in the background
    },
    [apiKey, defaultInstruction, model, safeGetString],
  );

  const toggleTranslation = useCallback(async () => {
    try {
      if (!translationContent) {
        // If we don't have a translation loaded yet, try to get it from the database
        const hasTranslation = await checkTranslation();
        if (hasTranslation) {
          setShowTranslation(true);
        } else {
          showToast(safeGetString('translation.noTranslation'));
        }
      } else {
        // Toggle between showing original and translation
        setShowTranslation(!showTranslation);
      }
    } catch (error) {
      // Silently handle error
    }
  }, [translationContent, showTranslation, checkTranslation, safeGetString]);

  const removeTranslation = useCallback(async () => {
    try {
      await deleteTranslation(chapterId);
      setTranslationContent(null);
      setShowTranslation(false);
      showToast(safeGetString('translation.deleted'));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      showToast(
        safeGetString('translation.deleteError', { error: errorMessage }),
      );
    }
  }, [chapterId, safeGetString]);

  const exportTranslation = useCallback(async () => {
    if (!translationContent) {
      showToast(safeGetString('translation.noTranslationToExport'));
      return;
    }

    try {
      const exportPath = `${NOVEL_STORAGE}/translations`;
      // Create directory if it doesn't exist
      await FileManager.mkdir(exportPath);

      // Convert HTML content to plain text for export
      const plainTextContent = translationContent
        .replace(/<br\s*\/?>/gi, '\n') // Convert <br> tags to newlines
        .replace(/&nbsp;&nbsp;/g, '  ') // Convert non-breaking spaces back to regular spaces
        .replace(/&nbsp;/g, ' ')
        .replace(/<[^>]*>/g, ''); // Remove any other HTML tags

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const exportFile = `${exportPath}/translation-${chapterId}-${timestamp}.txt`;

      await FileManager.writeFile(exportFile, plainTextContent);
      showToast(safeGetString('translation.exported', { path: exportFile }));

      // Return the export file path so it can be opened if needed
      return exportFile;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      showToast(
        safeGetString('translation.exportError', { error: errorMessage }),
      );
      return null;
    }
  }, [chapterId, translationContent, safeGetString]);

  return {
    translationContent,
    showTranslation,
    translateChapter,
    toggleTranslation,
    checkTranslation,
    removeTranslation,
    exportTranslation,
  };
};
