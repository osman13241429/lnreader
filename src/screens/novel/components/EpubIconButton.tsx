import React, { useMemo } from 'react';
import { IconButton, Portal } from 'react-native-paper';
import ChooseEpubLocationModal from './ChooseEpubLocationModal';
import { StatusBar } from 'react-native';
import { ThemeColors } from '@theme/types';

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

  const createEpub = async (outputPath: string) => {
    try {
      showToast('Creating EPUB... This may take a while.');

      // Use the new standardized EPUB creation function
      await createNovelEpub(novel, chapters, outputPath, {
        embedImages: true,
        stylesheet: epubStyle || undefined,
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
