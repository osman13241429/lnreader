import React, { useMemo } from 'react';
import { IconButton, Portal } from 'react-native-paper';
import ChooseEpubLocationModal from './ChooseEpubLocationModal';
import { StatusBar } from 'react-native';
import { ThemeColors } from '@theme/types';
import FileManager from '@native/FileManager';

import { ChapterInfo, NovelInfo } from '@database/types';
import { useChapterReaderSettings } from '@hooks/persisted';
import { useBoolean } from '@hooks/index';
import { showToast } from '@utils/showToast';
import { createNovelEpub } from '@utils/epubUtils';

interface EpubIconButtonProps {
  theme: ThemeColors;
  novel: NovelInfo;
  chapters: ChapterInfo[];
}

// Define type for settings received from modal
interface EpubExportSettings {
  uri: string;
  useTranslatedContent: boolean;
  useChapterNumberOnlyTitle: boolean;
}

const EpubIconButton: React.FC<EpubIconButtonProps> = ({
  theme,
  novel,
  chapters,
}) => {
  const {
    value: isVisible,
    setTrue: showModal,
    setFalse: hideModal,
  } = useBoolean(false);
  const readerSettings = useChapterReaderSettings();
  const { epubUseAppTheme = false, epubUseCustomCSS = false } =
    useChapterReaderSettings();

  const epubStyle = useMemo(
    () =>
      `${
        epubUseAppTheme
          ? `
              html {
                scroll-behavior: smooth;
                overflow-x: hidden;
                padding-top: ${StatusBar.currentHeight}px;
                word-wrap: break-word;
              }
              body {
                padding-left: ${readerSettings.padding}%;
                padding-right: ${readerSettings.padding}%;
                padding-bottom: 40px;
                font-size: ${readerSettings.textSize}px;
                color: ${readerSettings.textColor};
                text-align: ${readerSettings.textAlign};
                line-height: ${readerSettings.lineHeight};
                font-family: "${readerSettings.fontFamily}";
                background-color: "${readerSettings.theme}";
              }
              hr {
                margin-top: 20px;
                margin-bottom: 20px;
              }
              a {
                color: ${theme.primary};
              }
              img {
                display: block;
                width: auto;
                height: auto;
                max-width: 100%;
            }`
          : ''
      }
      ${
        epubUseCustomCSS
          ? readerSettings.customCSS
              .replace(
                RegExp(`#sourceId-${novel.pluginId}\\s*\\{`, 'g'),
                'body {',
              )
              .replace(
                RegExp(`#sourceId-${novel.pluginId}[^\\.\#A-Z]*`, 'gi'),
                '',
              )
          : ''
      }`,
    [novel, epubUseAppTheme, readerSettings, epubUseCustomCSS, theme.primary],
  );

  const createEpub = async (settings: EpubExportSettings) => {
    try {
      showToast('Creating EPUB... This may take a while.');

      // Sanitize novel name for filename
      const sanitizedNovelName = novel.name.replace(/[/\\?%*:|"<>]/g, '-');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${sanitizedNovelName}-${timestamp}.epub`;

      // Define the standard output directory
      const baseDir = '/storage/emulated/0/Download/LNReader';
      const novelDir = `${baseDir}/${sanitizedNovelName}`;

      // Create directories
      await FileManager.mkdir(baseDir);
      await FileManager.mkdir(novelDir);

      // Construct the final output path
      const finalOutputPath = `${novelDir}/${filename}`;

      // Use the new standardized EPUB creation function with the correct path and translation setting
      await createNovelEpub(novel, chapters, finalOutputPath, {
        embedImages: true,
        stylesheet: epubStyle || undefined,
        useTranslatedContent: settings.useTranslatedContent,
        useChapterNumberOnlyTitle: settings.useChapterNumberOnlyTitle,
      });
    } catch (error) {
      showToast(
        `Failed to create EPUB: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  };

  return (
    <>
      <IconButton
        icon="book-arrow-down-outline"
        iconColor={theme.onBackground}
        size={21}
        onPress={showModal}
      />
      <Portal>
        <ChooseEpubLocationModal
          isVisible={isVisible}
          hideModal={hideModal}
          onSubmit={createEpub}
        />
      </Portal>
    </>
  );
};
export default EpubIconButton;
