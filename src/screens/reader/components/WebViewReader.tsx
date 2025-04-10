import React, { useEffect, useMemo, useCallback } from 'react';
import { NativeEventEmitter, NativeModules, StatusBar } from 'react-native';
import WebView from 'react-native-webview';
import color from 'color';
import { getBatteryLevelSync } from 'react-native-device-info';

import { useTheme } from '@hooks/persisted';
import { ChapterInfo } from '@database/types';
import { getString } from '@strings/translations';
import { getPlugin } from '@plugins/pluginManager';
import { MMKVStorage, getMMKVObject } from '@utils/mmkv/mmkv';
import {
  CHAPTER_GENERAL_SETTINGS,
  CHAPTER_READER_SETTINGS,
  ChapterGeneralSettings,
  ChapterReaderSettings,
  initialChapterGeneralSettings,
  initialChapterReaderSettings,
} from '@hooks/persisted/useSettings';
import { PLUGIN_STORAGE } from '@utils/Storages';
import { useChapterContext } from '../ChapterContext';
import { useWebViewTTS } from '@hooks/useWebViewTTS';

type WebViewPostEvent = {
  type: string;
  data?: string | number | { [key: string]: string | number } | null;
};

type WebViewReaderProps = {
  html: string;
  translatedHtml?: string | null;
  showTranslation?: boolean;
  nextChapter?: ChapterInfo;
  webViewRef: React.RefObject<WebView>;
  saveProgress(percentage: number): void;
  onPress(): void;
  navigateChapter(position: 'NEXT' | 'PREV'): void;
};

const { RNDeviceInfo } = NativeModules;
const deviceInfoEmitter = new NativeEventEmitter(RNDeviceInfo);

const assetsUriPrefix = __DEV__
  ? 'http://localhost:8081/assets'
  : 'file:///android_asset';

const WebViewReader: React.FC<WebViewReaderProps> = ({
  html,
  translatedHtml = null,
  showTranslation = false,
  webViewRef,
  nextChapter,
  saveProgress,
  onPress,
  navigateChapter,
}): React.ReactElement => {
  const { novel, chapter } = useChapterContext();
  const theme = useTheme();

  const { injectTTSLogic, processTTSMessage, stopTTSAndClearState } =
    useWebViewTTS(webViewRef, nextChapter, navigateChapter, chapter?.id);

  const readerSettings = useMemo(
    () =>
      getMMKVObject<ChapterReaderSettings>(CHAPTER_READER_SETTINGS) ||
      initialChapterReaderSettings,
    [],
  );

  const batteryLevel = useMemo(getBatteryLevelSync, []);
  const plugin = getPlugin(novel?.pluginId);
  const pluginCustomJS = plugin?.id
    ? `file://${PLUGIN_STORAGE}/${plugin.id}/custom.js`
    : '';
  const pluginCustomCSS = plugin?.id
    ? `file://${PLUGIN_STORAGE}/${plugin.id}/custom.css`
    : '';

  const displayContent =
    showTranslation && translatedHtml ? translatedHtml : html;

  const handleWebViewLoad = useCallback(() => {
    injectTTSLogic();
  }, [injectTTSLogic]);

  useEffect(() => {
    const mmkvListener = MMKVStorage.addOnValueChangedListener(key => {
      let settingsKey: string | undefined;
      let jsVariable: string | undefined;

      if (key === CHAPTER_READER_SETTINGS) {
        settingsKey = CHAPTER_READER_SETTINGS;
        jsVariable = 'reader.readerSettings.val';
      } else if (key === CHAPTER_GENERAL_SETTINGS) {
        settingsKey = CHAPTER_GENERAL_SETTINGS;
        jsVariable = 'reader.generalSettings.val';
      }

      if (settingsKey && jsVariable) {
        const settingsString = MMKVStorage.getString(settingsKey);
        if (settingsString) {
          webViewRef.current?.injectJavaScript(
            `${jsVariable} = ${settingsString}`,
          );
        }
      }
    });

    return () => mmkvListener.remove();
  }, [webViewRef]);

  useEffect(() => {
    const subscription = deviceInfoEmitter.addListener(
      'RNDeviceInfo_batteryLevelDidChange',
      (level: number) => {
        webViewRef.current?.injectJavaScript(
          `reader.batteryLevel.val = ${level}`,
        );
      },
    );
    return () => subscription.remove();
  }, [webViewRef]);

  const handleMessage = useCallback(
    async (ev: { nativeEvent: { data: string } }) => {
      let event: WebViewPostEvent;
      try {
        event = JSON.parse(ev.nativeEvent.data);
      } catch (e) {
        console.error('Error parsing WebView message:', e);
        return;
      }

      const ttsHandled = await processTTSMessage(event);
      if (ttsHandled) {
        return;
      }

      switch (event.type) {
        case 'hide':
          onPress();
          break;
        case 'next':
        case 'prev':
          stopTTSAndClearState();
          navigateChapter(event.type === 'next' ? 'NEXT' : 'PREV');
          break;
        case 'save':
          if (typeof event.data === 'number') {
            saveProgress(event.data);
          }
          break;
      }
    },
    [
      onPress,
      navigateChapter,
      saveProgress,
      processTTSMessage,
      stopTTSAndClearState,
    ],
  );

  const webViewSource = useMemo(() => {
    const currentGeneralSettings =
      getMMKVObject<ChapterGeneralSettings>(CHAPTER_GENERAL_SETTINGS) ||
      initialChapterGeneralSettings;

    const stringsConfig = {
      finished: `${getString('readerScreen.finished')}: ${
        chapter.name?.trim() ?? ''
      }`,
      nextChapter: getString('readerScreen.nextChapter', {
        name: nextChapter?.name ?? '',
      }),
      noNextChapter: getString('readerScreen.noNextChapter'),
    };

    return {
      baseUrl: !chapter.isDownloaded ? plugin?.site : undefined,
      headers: plugin?.imageRequestInit?.headers,
      method: plugin?.imageRequestInit?.method,
      body: plugin?.imageRequestInit?.body,
      html: `
      <!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
            <link rel="stylesheet" href="${assetsUriPrefix}/css/index.css">
            <style>
            :root {
              --StatusBar-currentHeight: ${StatusBar.currentHeight}px;
              --readerSettings-theme: ${readerSettings.theme};
              --readerSettings-padding: ${readerSettings.padding}px;
              --readerSettings-textSize: ${readerSettings.textSize}px;
              --readerSettings-textColor: ${readerSettings.textColor};
              --readerSettings-textAlign: ${readerSettings.textAlign};
              --readerSettings-lineHeight: ${readerSettings.lineHeight};
              --readerSettings-fontFamily: ${readerSettings.fontFamily};
              --theme-primary: ${theme.primary};
              --theme-onPrimary: ${theme.onPrimary};
              --theme-secondary: ${theme.secondary};
              --theme-tertiary: ${theme.tertiary};
              --theme-onTertiary: ${theme.onTertiary};
              --theme-onSecondary: ${theme.onSecondary};
              --theme-surface: ${theme.surface};
              --theme-surface-0-9: ${color(theme.surface)
                .alpha(0.9)
                .toString()};
              --theme-onSurface: ${theme.onSurface};
              --theme-surfaceVariant: ${theme.surfaceVariant};
              --theme-onSurfaceVariant: ${theme.onSurfaceVariant};
              --theme-outline: ${theme.outline};
              --theme-rippleColor: ${theme.rippleColor};
            }
            @font-face {
              font-family: ${readerSettings.fontFamily};
              src: url("file:///android_asset/fonts/${
                readerSettings.fontFamily
              }.ttf");
            }
            .translated-content { white-space: pre-wrap; }
            </style>
            ${
              pluginCustomCSS
                ? `<link rel="stylesheet" href="${pluginCustomCSS}">`
                : ''
            }
            <style>${readerSettings.customCSS}</style>
          </head>
          <body class="${
            currentGeneralSettings.pageReader ? 'page-reader' : ''
          }">
            <div id="LNReader-chapter" class="${
              showTranslation && translatedHtml ? 'translated-content' : ''
            }">
              ${displayContent}
            </div>
            <div id="reader-ui"></div>
          </body>
          <script>
            // Pass config to WebView JS
            var initialReaderConfig = ${JSON.stringify({
              readerSettings,
              chapterGeneralSettings: currentGeneralSettings,
              novel,
              chapter,
              nextChapter,
              batteryLevel,
              autoSaveInterval: 2222,
              DEBUG: __DEV__,
              isTranslated: !!(showTranslation && translatedHtml),
              strings: stringsConfig,
            })}
          </script>
          <script src="${assetsUriPrefix}/js/icons.js"></script>
          <script src="${assetsUriPrefix}/js/van.js"></script>
          <script src="${assetsUriPrefix}/js/text-vibe.js"></script>
          <script src="${assetsUriPrefix}/js/core.js"></script>
          <script src="${assetsUriPrefix}/js/index.js"></script>
          ${pluginCustomJS ? `<script src="${pluginCustomJS}"></script>` : ''}
          <script>${readerSettings.customJS}</script>
        </html>
        `,
    };
  }, [
    readerSettings,
    chapter.isDownloaded,
    chapter.name,
    plugin?.site,
    plugin?.id,
    plugin?.imageRequestInit,
    theme,
    displayContent,
    showTranslation,
    translatedHtml,
    novel,
    nextChapter,
    batteryLevel,
    pluginCustomCSS,
    pluginCustomJS,
    assetsUriPrefix,
    chapter,
  ]);

  return (
    <WebView
      ref={webViewRef}
      style={{ backgroundColor: readerSettings.theme }}
      allowFileAccess={true}
      originWhitelist={['*']}
      scalesPageToFit={true}
      showsVerticalScrollIndicator={false}
      javaScriptEnabled={true}
      onLoad={handleWebViewLoad}
      onMessage={handleMessage}
      source={webViewSource}
      onError={syntheticEvent => {
        const { nativeEvent } = syntheticEvent;
        console.warn('WebView error: ', nativeEvent);
      }}
    />
  );
};

export default WebViewReader;
